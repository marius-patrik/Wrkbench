export {};
const port = Number(process.env.CANVAS_PORT);
if (!Number.isInteger(port) || port < 1) throw new Error("Missing CANVAS_PORT");
const marker = "RSCODE_NATIVE_TERMINAL_OK";
const url = `ws://127.0.0.1:${port}/api/terminal/spawn?paneId=distribution-probe&cwd=${encodeURIComponent(process.cwd())}`;
const result = await new Promise<string>((resolve, reject) => {
  const ws = new WebSocket(url);
  let output = "";
  const timeout = setTimeout(() => { ws.close(); reject(new Error(`Terminal timeout: ${output.slice(-500)}`)); }, 12000);
  // Split the marker in the input so a terminal that merely echoes the
  // command cannot pass acceptance without executing it.
  const input = process.platform === "win32"
    ? "set RSCODE_TERMINAL_PROBE_JOIN=TERMINAL_OK\r\necho RSCODE_NATIVE_%RSCODE_TERMINAL_PROBE_JOIN%\r\nexit\r\n"
    : "printf 'RSCODE_NATIVE_%s\\n' TERMINAL_OK\nexit\n";
  ws.onopen = () => ws.send(JSON.stringify({ type: "input", data: input }));
  ws.onmessage = (event) => {
    output += String(event.data);
    if (output.includes(marker)) {
      clearTimeout(timeout);
      ws.close();
      resolve(output);
    }
  };
  ws.onerror = () => { clearTimeout(timeout); reject(new Error(`Terminal WebSocket failed: ${output}`)); };
  ws.onclose = () => {
    if (!output.includes(marker)) {
      clearTimeout(timeout);
      reject(new Error(`Terminal closed before sentinel: ${output}`));
    }
  };
});
if (!result.includes(marker)) throw new Error("Sentinel missing");
console.log(JSON.stringify({ terminalPty: "PASS" }));
