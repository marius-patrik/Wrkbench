import type { Result } from "../domain/errors";
import type { JsonObject, WorkspaceId, WorkspaceRecord } from "../domain/types";
import type { Profile } from "../profiles";
import { isCanvasView, type CanvasView } from "../views";
import { createCanvasPersistence } from "./indexeddb";
import { asJsonObject, asWorkspaceId } from "./validation";

export type ProfileDirectory = { profiles: Profile[]; currentId: string };
const KIND = "canvas-profile-directory-v1";
const LEGACY_KEY = "canvas-profiles-v1";
const storage = createCanvasPersistence();

function requireResult<T>(result: Result<T>, message: string): T {
  if (!result.ok) throw new Error(`${message}: ${result.error.code}: ${result.error.message}`);
  return result.value;
}

const legacyViews = new Set([
  "overview",
  "projects",
  "agents",
  "graph",
  "roadmap",
  "artifacts",
  "context",
]);
function convertView(candidate: unknown): CanvasView {
  if (candidate === "monaco" || candidate === "notepad") return "editor";
  if (typeof candidate === "string" && legacyViews.has(candidate)) return "canvas";
  if (typeof candidate === "string" && isCanvasView(candidate)) return candidate;
  throw new Error("Unrecognized prior profile view; preserve original profile bytes for review.");
}
function normalizeRoute(value: unknown): string {
  if (value === undefined) return "/";
  if (typeof value !== "string" || !value.startsWith("/"))
    throw new Error("Invalid saved route; original profile data was preserved.");
  if (value === "/") return value;
  const name = value.slice(1).split("?")[0];
  return `/${convertView(name)}`;
}
function normalizeDirectory(value: unknown): ProfileDirectory {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Profile directory must be a JSON object.");
  const data = value as Record<string, unknown>;
  if (!Array.isArray(data.profiles) || data.profiles.length < 1 || data.profiles.length > 50)
    throw new Error("Profile directory has invalid profile count; raw source is retained.");
  const ids = new Set<string>();
  const profiles: Profile[] = data.profiles.map((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Invalid profile record in preserved directory.");
    const row = input as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      row.id.length < 1 ||
      row.id.length >= 100 ||
      row.id.includes("\0") ||
      ids.has(row.id) ||
      typeof row.name !== "string" ||
      row.name.length < 1 ||
      row.name.length > 48
    )
      throw new Error("Invalid or duplicated profile identity; refusing lossy migration.");
    ids.add(row.id);
    if (row.note !== undefined && (typeof row.note !== "string" || row.note.length > 100000))
      throw new Error("Profile note exceeds supported bounds; raw source is preserved.");
    if (
      row.selectedDocument !== undefined &&
      (typeof row.selectedDocument !== "string" || row.selectedDocument.length > 300)
    )
      throw new Error("Invalid selected document; raw source is preserved.");
    if (row.pinned !== undefined && !Array.isArray(row.pinned))
      throw new Error("Invalid pinned views; raw source is preserved.");
    const pins = new Set<CanvasView>();
    for (const pin of (row.pinned ?? []) as unknown[]) {
      pins.add(convertView(pin));
      if (pins.size > 20) throw new Error("Too many pinned views in profile.");
    }
    if (
      row.drafts !== undefined &&
      (!row.drafts || typeof row.drafts !== "object" || Array.isArray(row.drafts))
    )
      throw new Error("Invalid profile draft dictionary; raw source is preserved.");
    const draftEntries = Object.entries(row.drafts ?? {});
    if (draftEntries.length > 64)
      throw new Error("More than 64 profile drafts require manual recovery.");
    const drafts: Record<string, string> = Object.create(null);
    for (const [path, text] of draftEntries) {
      if (path.length < 1 || path.length > 300 || typeof text !== "string")
        throw new Error("Invalid profile draft; raw source is preserved.");
      drafts[path] = text;
    }
    return {
      id: row.id,
      name: row.name,
      route: normalizeRoute(row.route),
      pinned: [...pins],
      note: (row.note ?? "") as string,
      selectedDocument: (row.selectedDocument ?? "") as string,
      drafts,
    };
  });
  if (typeof data.currentId !== "string" || !ids.has(data.currentId))
    throw new Error("Profile selection is not owned by an existing profile.");
  const candidate = { profiles, currentId: data.currentId };
  requireResult(asJsonObject(candidate), "Validate canonical directory JSON");
  return candidate;
}

function readRecord(row: WorkspaceRecord): ProfileDirectory {
  if (row.data.kind !== KIND)
    throw new Error("Canonical profile UUID belongs to another domain; refusing data reuse.");
  return normalizeDirectory(row.data.directory);
}

/** A stable namespaced UUID without repurposing Canvas's profile IDs. */
async function directoryId(): Promise<WorkspaceId> {
  if (!globalThis.crypto?.subtle) throw new Error("Secure UUID derivation is unavailable.");
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode("canvas:profile-directory:v1")),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return requireResult(
    asWorkspaceId(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    ),
    "Derive profile directory identity",
  );
}

class LiveProfileDirectory {
  private loading: Promise<ProfileDirectory | null> | null = null;
  private ready: Promise<void> | null = null;
  private revision: number | null | undefined;
  private queue: Promise<void> = Promise.resolve();

  private initialize(): Promise<void> {
    if (!this.ready) {
      this.ready = storage
        .initialize()
        .then((result) => {
          requireResult(result, "Initialize profile IndexedDB");
        })
        .catch((error) => {
          this.ready = null;
          throw error;
        });
    }
    return this.ready;
  }

  load(): Promise<ProfileDirectory | null> {
    if (!this.loading) {
      this.loading = this.loadOnce().catch((reason) => {
        this.loading = null;
        throw reason;
      });
    }
    return this.loading;
  }

  private async loadOnce(): Promise<ProfileDirectory | null> {
    await this.initialize();
    const id = await directoryId();
    const present = requireResult(
      await storage.readWorkspace(id),
      "Read canonical profile directory",
    );
    if (present) {
      const value = readRecord(present);
      this.revision = present.revision;
      return value;
    }
    const values = requireResult(
      storage.readLegacyValues([LEGACY_KEY]),
      "Read original profile directory",
    );
    const raw = values[0].raw;
    if (raw === null) {
      this.revision = null;
      return null;
    }
    const prior = requireResult(
      await storage.readMigration(LEGACY_KEY),
      "Read profile migration lease",
    );
    if (prior)
      throw new Error(
        `Prior profile migration is ${prior.status}; original backup requires review.`,
      );
    // Preserve the exact source BEFORE attempting any JSON parse or conversion.
    const lease = requireResult(
      await storage.beginLegacyMigration(LEGACY_KEY),
      "Back up original Zustand profile data",
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("Legacy profile JSON is malformed; exact original backup was preserved.");
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { version?: unknown }).version !== 1
    )
      throw new Error("Unsupported profile state version; exact original bytes were preserved.");
    const directory = normalizeDirectory((parsed as { state?: unknown }).state);
    const commit = await storage.commit({
      mutations: [
        {
          kind: "createWorkspace",
          id,
          expectedRevision: null,
          data: { kind: KIND, directory: directory as unknown as JsonObject },
        },
      ],
      migration: { key: LEGACY_KEY, expectedRevision: lease.revision },
    });
    if (!commit.ok) {
      const winner = requireResult(
        await storage.readWorkspace(id),
        "Resolve concurrent profile import",
      );
      if (winner) {
        const existing = readRecord(winner);
        this.revision = winner.revision;
        return existing;
      }
      throw new Error(
        `Profile import not committed: ${commit.error.code}: ${commit.error.message}`,
      );
    }
    this.revision = 0;
    return directory;
  }

  /** The rendered state is optimistic; writes are serialized and each state
   * receives a durable C01 transaction acknowledgement. Any stale other-tab
   * revision fails closed rather than overwriting that tab's edits.
   */
  save(next: ProfileDirectory): Promise<void> {
    const directory = normalizeDirectory(next);
    const attempt = this.queue
      .catch(() => {})
      .then(async () => {
        await this.load();
        if (this.revision === undefined)
          throw new Error("Cannot save an unhydrated profile directory.");
        const id = await directoryId();
        const existing = requireResult(await storage.readWorkspace(id), "Check profile revision");
        if (existing) readRecord(existing);
        if ((existing?.revision ?? null) !== this.revision)
          throw new Error(
            "Another window changed the profile directory; export or reload before overwriting.",
          );
        const result = await storage.commit({
          mutations: [
            existing
              ? {
                  kind: "updateWorkspace" as const,
                  id,
                  expectedRevision: existing.revision,
                  data: { kind: KIND, directory: directory as unknown as JsonObject },
                }
              : {
                  kind: "createWorkspace" as const,
                  id,
                  expectedRevision: null,
                  data: { kind: KIND, directory: directory as unknown as JsonObject },
                },
          ],
        });
        requireResult(result, "Commit profile directory");
        this.revision = (this.revision ?? -1) + 1;
      });
    this.queue = attempt;
    return attempt;
  }
}

export const liveProfileDirectory = new LiveProfileDirectory();
