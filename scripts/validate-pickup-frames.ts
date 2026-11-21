// Warm one full arena, alternate pickups off/on, and retain every desktop sample.
// Run from the checkout root; profiles, screenshots and raw measurements stay in .evidence/79/.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createServer, type ViteDevServer } from "vite";
import { MAX_BUGS, MAX_EVENTS, MAX_GLOBS, MAX_PICKUPS, MAX_PLAYERS, MAX_SHOTS } from "../src/shared/arena/constants";
import { PICKUP_KINDS } from "../src/shared/arena/pickups/registry";

const repo = process.cwd(), evidence = join(repo, ".evidence/79/send-back");
mkdirSync(evidence, { recursive: true });
const root = mkdtempSync(join(repo, ".evidence/79/frames-")), home = join(root, "home"), temp = join(root, "tmp");
for (const p of [home, temp, join(home, "AppData/Local"), join(home, "AppData/Roaming")]) mkdirSync(p, { recursive: true });
for (const key of ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]) process.env[key] = home;
process.env.TEMP = process.env.TMP = temp;
process.env.APPDATA = join(home, "AppData/Roaming"); process.env.LOCALAPPDATA = join(home, "AppData/Local");
const chromePath = process.env.CHROME_PATH ?? [join(process.env.ProgramFiles ?? "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
if (!chromePath) throw new Error("Set CHROME_PATH to Chrome, then run from the checkout root.");
console.log(`Evidence: ${root}`);
let vite: ViteDevServer | undefined, chrome: ReturnType<typeof Bun.spawn> | undefined, socket: WebSocket | undefined;
let interrupted = false, serial = 0;
const interrupt = () => { interrupted = true; };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const report: any = { viewport: { width: 1280, height: 800 }, warmSeconds: 12, settleSeconds: 4, rounds: [] };
async function until(fn: () => any, timeout = 30000): Promise<any> {
  const end = performance.now() + timeout;
  while (performance.now() < end) {
    if (interrupted) throw new Error("Frame validation interrupted");
    const value = await fn(); if (value) return value; await Bun.sleep(50);
  }
  throw new Error("Frame validation timed out");
}
function call(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(session: string, expression: string) {
  const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try {
  vite = await createServer({ configFile: false, root: repo, cacheDir: join(root, "vite-cache"),
    server: { host: "127.0.0.1", port: 0, watch: { ignored: ["**/.evidence/**"] } } });
  await vite.listen();
  const address = vite.httpServer!.address(); assert(address && typeof address !== "string");
  chrome = Bun.spawn([chromePath, "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
    `--user-data-dir=${join(root, "profile").replaceAll("\\", "/")}`, "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"],
  { stdout: "ignore", stderr: Bun.file(join(root, "chrome.log")), env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "CHROME_CRASHPAD_PIPE_NAME")) });
  await until(() => existsSync(join(root, "profile/DevToolsActivePort")));
  const port = readFileSync(join(root, "profile/DevToolsActivePort"), "utf8").split("\n")[0];
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); report.browser = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket!.onopen = resolve; socket!.onerror = reject; });
  socket.onmessage = event => {
    const m = JSON.parse(String(event.data)), p = pending.get(m.id);
    if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
  await call("Emulation.setDeviceMetricsOverride", { ...report.viewport, deviceScaleFactor: 1, mobile: false }, sessionId);
  await call("Page.navigate", { url: `http://127.0.0.1:${address.port}/scripts/arena-benchmark.html` }, sessionId);
  await until(() => evaluate(sessionId, "!!window.arenaBenchmark && !!document.querySelector('canvas')?.dataset.fps"));
  await Bun.sleep(report.warmSeconds * 1000);
  // ABBA repeated: both conditions run early and late against the same warmed renderer.
  for (const enabled of [false, true, true, false, false, true, true, false]) {
    await evaluate(sessionId, `window.arenaBenchmark.setPickups(${enabled})`);
    await Bun.sleep(report.settleSeconds * 1000);
    const population = await evaluate(sessionId, "window.arenaBenchmark.population()");
    assert.deepEqual(population, { players: MAX_PLAYERS, bugs: MAX_BUGS, globs: MAX_GLOBS, shots: MAX_SHOTS,
      impactSlots: MAX_EVENTS, pickups: enabled ? MAX_PICKUPS : 0, effects: enabled ? MAX_PLAYERS * PICKUP_KINDS.length : 0 });
    const round = { pickups: enabled, population, samples: [] as any[] }; report.rounds.push(round);
    let previous = await evaluate(sessionId, "Number(document.querySelector('canvas').dataset.sample)");
    for (let i = 0; i < 5; i++) {
      const sample = await until(async () => {
        const data = await evaluate(sessionId, "({...document.querySelector('canvas').dataset})");
        return Number(data.sample) > previous ? data : null;
      });
      previous = Number(sample.sample); round.samples.push({ fps: Number(sample.fps), frameMs: Number(sample.frameMs) });
    }
    const screenshot = await call("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(join(root, `round-${report.rounds.length}-${enabled ? "on" : "off"}.png`), Buffer.from(screenshot.data, "base64"));
    console.log(JSON.stringify(round));
  }
  report.passed = report.rounds.every((r: any) => r.samples.every((s: any) => s.fps >= 59));
  assert(report.passed, "Desktop fell below 59 FPS; all samples are retained in report.json");
} finally {
  await Bun.write(join(root, "report.json"), JSON.stringify(report, null, 2));
  if (socket?.readyState === WebSocket.OPEN) await call("Browser.close").catch(() => {});
  socket?.close(); if (chrome?.exitCode === null) chrome.kill(); await chrome?.exited;
  await vite?.close(); process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
}
