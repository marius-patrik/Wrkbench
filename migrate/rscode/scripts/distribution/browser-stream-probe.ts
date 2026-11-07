// Installed, real-server WebSocket acceptance (not a mocked CDP or source-checkout UI).
// Executed by the extracted distribution's bundled Bun against its own server.
import { Buffer } from "node:buffer";

type BrowserMessage = {
  type: string;
  url?: string;
  image?: string;
  width?: number;
  height?: number;
  title?: string;
  message?: string;
};

const mode = process.argv[2];
if (mode !== "first" && mode !== "restart") throw new Error("Expected first or restart mode");
const port = Number(process.env.CANVAS_PORT);
const workspaceId = process.env.RSCODE_PROBE_WORKSPACE_ID;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !workspaceId) {
  throw new Error("Expected CANVAS_PORT and RSCODE_PROBE_WORKSPACE_ID");
}
const paneId = "browser:native-server-stream";
const origin = `http://127.0.0.1:${port}`;
const remote = `ws://127.0.0.1:${port}/api/browser/stream?workspaceId=${encodeURIComponent(workspaceId)}&paneId=${encodeURIComponent(paneId)}`;
const pageUrl = `data:text/html,${encodeURIComponent("<!doctype html><html><head><title>Native Stream Proof</title></head><body style='background:#14395d'><h1>installed native browser</h1></body></html>")}`;

async function api<T>(name: string, body: unknown): Promise<T> {
  const response = await fetch(`${origin}/api/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Native API ${name} responded ${response.status}: ${(await response.text()).slice(0,200)}`);
  return response.json() as Promise<T>;
}

type WorkspaceResponse = { workspace: {
  id: string;
  panes: Array<{ id: string; type: string }>;
  [key: string]: unknown;
} };

const { workspace } = await api<WorkspaceResponse>("workspace.get", { id: workspaceId });
if (mode === "first") {
  if (workspace.panes.some((pane) => pane.id === paneId)) throw new Error("Native browser probe pane already exists");
  const timestamp = new Date().toISOString();
  const pane = {
    id: paneId,
    title: "Browser",
    type: "browser",
    placement: "tiled",
    rect: { x: 120, y: 96, width: 800, height: 600 },
    z: workspace.panes.length,
    url: "about:blank",
    history: ["about:blank"],
    historyIndex: 0,
    sessionId: "native-distribution-stream",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await api("workspace.save", {
    workspace: {
      ...workspace,
      panes: [...workspace.panes, pane],
      activePaneId: paneId,
    },
  });
} else if (!workspace.panes.some((pane) => pane.id === paneId && pane.type === "browser")) {
  throw new Error("Native browser pane was not persisted across installed server restart");
}

const messages: BrowserMessage[] = [];
const socket = new WebSocket(remote);
socket.addEventListener("message", (event) => {
  try {
    const parsed: unknown = JSON.parse(String(event.data));
    if (parsed && typeof parsed === "object" && "type" in parsed) {
      messages.push(parsed as BrowserMessage);
    }
  } catch {
    // Malformed server frames fail the eventual typed-message acceptance below.
  }
});
await new Promise<void>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Native browser WebSocket never opened")), 15_000);
  socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
  socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Native browser WebSocket failed")); }, { once: true });
});

function assertPNG(frame: BrowserMessage, width?: number, height?: number): void {
  if (frame.type !== "frame" || !frame.image?.startsWith("data:image/png;base64,")) {
    throw new Error("Native stream did not return a PNG frame");
  }
  const png = Buffer.from(frame.image.slice("data:image/png;base64,".length), "base64");
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      png.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Native stream frame is not an actual PNG");
  }
  const imageWidth = png.readUInt32BE(16);
  const imageHeight = png.readUInt32BE(20);
  if (frame.width !== imageWidth || frame.height !== imageHeight) {
    throw new Error(`Native stream lied about dimensions: ${frame.width}x${frame.height} != ${imageWidth}x${imageHeight}`);
  }
  if ((width !== undefined && imageWidth !== width) ||
      (height !== undefined && imageHeight !== height)) {
    throw new Error(`Native stream resize mismatch: ${imageWidth}x${imageHeight}`);
  }
}

async function waitForFrame(predicate: (m: BrowserMessage) => boolean, label: string, timeoutMs = 25_000): Promise<BrowserMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const error = messages.find((m) => m.type === "error");
    if (error) throw new Error(`Native browser server error: ${error.message ?? "unknown"}`);
    const frame = messages.find(predicate);
    if (frame) return frame;
    if (socket.readyState !== WebSocket.OPEN) throw new Error(`WebSocket closed while waiting for ${label}`);
    await Bun.sleep(40);
  }
  throw new Error(`Timed out waiting for ${label}; observed messages: ${messages.map((x) => x.type).join(",")}`);
}

try {
  const initial = await waitForFrame((m) => m.type === "frame", "initial native Chromium frame");
  assertPNG(initial);
  messages.length = 0;
  socket.send(JSON.stringify({ type: "viewport", width: 427, height: 311 }));
  const resized = await waitForFrame((m) => m.type === "frame" && m.width === 427 && m.height === 311, "actual resized Chromium PNG");
  assertPNG(resized, 427, 311);
  messages.length = 0;
  socket.send(JSON.stringify({ type: "navigate", url: pageUrl }));
  await waitForFrame((m) => m.type === "state" && m.title === "Native Stream Proof", "rendered page title after navigation");
  const navigated = await waitForFrame((m) => m.type === "frame" && m.url === pageUrl, "navigated native Chromium frame");
  assertPNG(navigated);
  console.log(JSON.stringify({ mode, serverChromium: "PASS", webSocket: "PASS", png: "VALID", resize: "427x311", navigation: "PASS", workspaceId, paneId }));
} finally {
  socket.close(1000, "native acceptance complete");
}
