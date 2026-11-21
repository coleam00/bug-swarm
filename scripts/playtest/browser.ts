import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchEnv } from "./options";

export async function bounded<T>(promise: Promise<T>, ms: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(`${label} timed out after ${ms} ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}

export async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean = Boolean, timeout = 10000, label = "condition"): Promise<T> {
  const end = performance.now() + timeout;
  while (performance.now() < end) { const value = await read(); if (accept(value)) return value; await Bun.sleep(50); }
  throw Error(`Timed out: ${label} (${timeout} ms)`);
}
export function chromeExecutable() {
  const executable = process.env.CHROME_PATH ?? [
    join(process.env.ProgramFiles ?? "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].find(existsSync);
  if (!executable || !existsSync(executable)) throw Error("Chrome missing: set CHROME_PATH to factory Chrome");
  return executable;
}
export class Browser {
  private serial = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private socket?: WebSocket;
  private process?: Bun.Subprocess;
  readonly errors: { session?: string; error: unknown }[] = [];
  metadata: unknown;
  async start(root: string) {
    const executable = chromeExecutable();
    const flags = ["--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${join(root, "p").replaceAll("\\", "/")}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"];
    this.process = Bun.spawn([executable, ...flags], { env: scratchEnv(root), stdout: "ignore", stderr: Bun.file(join(root, "chrome.log")) });
    await until(async () => existsSync(join(root, "p", "DevToolsActivePort")), Boolean, 25000, "Chrome startup");
    const port = readFileSync(join(root, "p", "DevToolsActivePort"), "utf8").split("\n")[0];
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) })).json() as { webSocketDebuggerUrl: string };
    this.metadata = { executable, flags, version };
    const socket = this.socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.onmessage = event => {
      const m = JSON.parse(String(event.data)), p = this.pending.get(m.id);
      if (p) { clearTimeout(p.timer); this.pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      else if (m.method === "Runtime.exceptionThrown" || m.method === "Inspector.targetCrashed" || m.method === "Runtime.consoleAPICalled" && m.params.type === "error") this.errors.push({ session: m.sessionId, error: m.params });
    };
    socket.onclose = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error("Chrome CDP disconnected")); } this.pending.clear(); };
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(Error("CDP connection timed out")), 5000); socket.onopen = () => { clearTimeout(timer); resolve(); }; socket.onerror = () => { clearTimeout(timer); reject(Error("CDP connection failed")); }; });
  }
  call(method: string, params: object = {}, sessionId?: string): Promise<any> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`${method} timed out`)); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  async evaluate<T>(session: string, expression: string): Promise<T> {
    const r = await this.call("Runtime.evaluate", { expression, returnByValue: true }, session);
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  }
  async page(url: string, width = 1280, height = 720, touch = false) {
    const { browserContextId } = await this.call("Target.createBrowserContext");
    const { targetId } = await this.call("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await this.call("Target.attachToTarget", { targetId, flatten: true });
    await this.call("Page.enable", {}, sessionId); await this.call("Runtime.enable", {}, sessionId);
    // Each isolated player remains focused even when another target receives input.
    // Otherwise Chrome's single foreground tab blurs peers and the game's real
    // blur handler correctly releases their held keys/buttons.
    await this.call("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
    await this.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: touch }, sessionId);
    if (touch) await this.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 }, sessionId);
    await this.call("Page.navigate", { url }, sessionId);
    return { session: sessionId as string, context: browserContextId as string, width, height, touch };
  }
  async screenshot(session: string, path: string) { const r = await this.call("Page.captureScreenshot", { format: "png" }, session); writeFileSync(path, Buffer.from(r.data, "base64")); }
  async close() {
    if (this.socket?.readyState === WebSocket.OPEN) await this.call("Browser.close").catch(() => {});
    this.socket?.close();
    if (this.process) {
      await bounded(this.process.exited, 2000, "Chrome exit").catch(() => {});
      if (this.process.exitCode === null) this.process.kill();
      await this.process.exited;
    }
  }
}
