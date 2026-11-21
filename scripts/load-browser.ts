import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const [origin, evidence] = process.argv.slice(2) as [string, string];
const profile = join(evidence, "chrome-profile"); mkdirSync(profile, { recursive: true });
const chromePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
if (!chromePath) throw Error("Set CHROME_PATH to factory Chrome");
const env = { ...process.env }; delete env.CHROME_CRASHPAD_PIPE_NAME;
const chrome = Bun.spawn([chromePath, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", "--user-data-dir=" + profile.replaceAll("\\", "/"), "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "about:blank"], { env, stdout: "ignore", stderr: Bun.file(join(evidence, "chrome.log")) });
let socket: WebSocket | undefined, serial = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const report: any = { samples: [], populations: [], errors: [] };
let stopping = false;
const harnessClosed = Bun.stdin.text().then(() => { stopping = true; });
async function until(fn: () => any, timeout = 15000) { const end = performance.now() + timeout; while (performance.now() < end) { if (stopping) throw Error("Harness stopped browser validation"); const value = await fn(); if (value) return value; await Bun.sleep(50); } throw Error("Browser condition timed out"); }
function call(method: string, params: any = {}, sessionId?: string): Promise<any> {
  const id = ++serial;
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(Error(method + " timed out")); }, 10000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
}
async function evaluate(session: string, expression: string) { const value = await call("Runtime.evaluate", { expression, returnByValue: true }, session); if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; }
async function key(session: string, code: string, down: boolean) { await call("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", code, key: code === "Enter" ? "Enter" : code.replace("Key", ""), windowsVirtualKeyCode: code === "Enter" ? 13 : code.replace("Key", "").charCodeAt(0) }, session); }
async function shot(session: string, name: string) { const r = await call("Page.captureScreenshot", { format: "png" }, session); await Bun.write(join(evidence, name + ".png"), Buffer.from(r.data, "base64")); }
try {
  await until(() => existsSync(join(profile, "DevToolsActivePort")), 30000);
  const port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0];
  const version = await (await fetch("http://127.0.0.1:" + port + "/json/version")).json(); report.browser = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket!.onopen = resolve; socket!.onerror = reject; });
  socket.onmessage = event => { const message = JSON.parse(String(event.data)), p = pending.get(message.id); if (p) { clearTimeout(p.timer); pending.delete(message.id); if (message.error) p.reject(Error(JSON.stringify(message.error))); else p.resolve(message.result); } };
  const { browserContextId } = await call("Target.createBrowserContext"), { targetId } = await call("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId: session } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, session); await call("Runtime.enable", {}, session);
  await call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, session);
  const observer = await Bun.build({ entrypoints: [join(import.meta.dir, "load-observer.ts")], target: "browser", format: "iife" }); assert(observer.success);
  await call("Page.addScriptToEvaluateOnNewDocument", { source: await observer.outputs[0]!.text() }, session);
  await call("Page.navigate", { url: origin }, session);
  await until(() => evaluate(session, "!!document.querySelector('#name')"));
  await evaluate(session, "document.querySelector('#name').focus()"); await call("Input.insertText", { text: "LoadPilot" }, session);
  await evaluate(session, "document.querySelector('.entry-teams button').click()");
  await until(() => evaluate(session, "window.loadEvidence.snapshot?.players.length===20"));
  report.welcome = await evaluate(session, "window.loadEvidence.welcome");
  await key(session, "KeyF", true); await key(session, "KeyF", false);
  await Bun.sleep(5000);
  await evaluate(session, "window.loadEvidence.gaps=[];window.loadEvidence.cadence=[]");
  let held = "";
  const started = performance.now();
  for (let i = 0; i < 65; i++) {
    if (stopping) throw Error("Harness stopped browser validation");
    const sample = await evaluate(session, "({at:performance.now(),frame:{...document.querySelector('canvas').dataset},players:window.loadEvidence.snapshot.players.length,own:window.loadEvidence.snapshot.players.find(p=>p.id===window.loadEvidence.welcome.playerId),bugs:window.loadEvidence.snapshot.bugs.length,shots:window.loadEvidence.snapshot.shots.length})");
    report.samples.push(sample); assert.equal(sample.players, 20);
    const stats = await (await fetch(origin + "/api/arena/stats")).json(); report.populations.push({ at: sample.at, total: stats.totalPlayers, arenas: stats.arenas });
    assert.equal(stats.totalPlayers, 201); assert.equal(stats.arenas.length, 11); assert.equal(stats.arenas.find((a: any) => a.id === report.welcome.arenaId).players, 20);
    if (held) await key(session, held, false);
    if (sample.own.status === "out") { await key(session, "Enter", true); await key(session, "Enter", false); held = ""; }
    else { held = ["KeyD", "KeyS", "KeyA", "KeyW"][Math.floor(i / 2) % 4]!; await key(session, held, true); }
    await call("Input.dispatchMouseEvent", { type: i ? "mouseMoved" : "mousePressed", x: 850 + Math.cos(i) * 150, y: 350 + Math.sin(i) * 150, button: i ? "none" : "left", buttons: 1, clickCount: i ? 0 : 1 }, session);
    if (i === 10 || i === 40 || i === 64) await shot(session, "full-room-F-" + i);
    if (i === 20) for (let frame = 0; frame < 12; frame++) { await shot(session, "motion-" + String(frame).padStart(2, "0")); await Bun.sleep(100); }
    await Bun.sleep(Math.max(1, started + (i + 1) * 1000 - performance.now()));
  }
  report.observations = await evaluate(session, "({gaps:window.loadEvidence.gaps,cadence:window.loadEvidence.cadence,errors:window.loadEvidence.errors,warnings:window.loadEvidence.warnings})");
  assert.equal(report.observations.errors.length, 0); assert.equal(report.observations.warnings.length, 0);
  const fps = report.samples.map((s: any) => Number(s.frame.fps)).sort((a: number, b: number) => a - b);
  report.fps = { min: fps[0], median: fps[Math.floor(fps.length / 2)], max: fps.at(-1) };
  const gaps = [...report.observations.gaps].sort((a: number, b: number) => a - b);
  report.frameGaps = { samples: gaps.length, p50: gaps[Math.ceil(gaps.length * .5) - 1], p95: gaps[Math.ceil(gaps.length * .95) - 1], max: gaps.at(-1), above50: gaps.filter((n: number) => n > 50).length };
  assert(report.fps.median >= 58); assert(report.frameGaps.p95 < 20); assert(report.frameGaps.above50 === 0);
  report.passed = true;
  // Keep Chrome connected until the measured bot window and report retrieval
  // finish. Closing it earlier would measure intentional teardown traffic.
  await harnessClosed;
} catch (error) { report.errors.push(String(error)); process.exitCode = 1; }
finally {
  await Bun.write(join(evidence, "browser.json"), JSON.stringify(report, null, 2));
  if (socket?.readyState === WebSocket.OPEN) { await call("Browser.close").catch(() => {}); socket.close(); }
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error("Browser closed")); } pending.clear();
  if (chrome.exitCode === null) chrome.kill(); await chrome.exited;
}
