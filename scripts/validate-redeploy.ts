import { mkdirSync, mkdtempSync, readFileSync, existsSync, appendFileSync, symlinkSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
// Run from a clean checkout after bun install. Every generated file stays in
// this checkout; the owned Chrome/server processes never use an operator profile.
const root = resolve(import.meta.dir, ".."), evidenceRoot = join(root, ".evidence/66");
mkdirSync(evidenceRoot, { recursive: true });
const evidence = mkdtempSync(join(evidenceRoot, "redeploy-")), data = join(evidence, "data"), profile = join(evidence, "chrome-profile"), changed = join(evidence, "changed");
mkdirSync(data, { recursive: true });
const home = join(evidence, "home"), temp = join(evidence, "tmp");
mkdirSync(home); mkdirSync(temp); mkdirSync(profile);
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home,
  TEMP: temp, TMP: temp, DATA_DIR: data, NODE_ENV: "development", RAILWAY_GIT_COMMIT_SHA: "" };
const chromePath = process.env.CHROME_PATH ?? [
  join(process.env.ProgramFiles ?? "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
  join(process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
].find(path => existsSync(path));
if (!chromePath || !existsSync(chromePath)) throw Error("Set CHROME_PATH to an installed Chrome executable");
console.log(`Evidence: ${evidence}`);
function run(command: string[], cwd = root) {
  const result = Bun.spawnSync(command, { cwd, env: { ...env, NODE_ENV: "production" }, windowsVerbatimArguments: command[0] === "cmd.exe", stdout: "pipe", stderr: "pipe", timeout: 60000 });
  assert.equal(result.exitCode, 0, result.stdout.toString() + result.stderr.toString());
  return result.stdout.toString();
}
function chromeDirectory(path: string) {
  // Chrome's Windows profile internals still exceed MAX_PATH in nested checkouts.
  // Use the same owned directory's existing 8.3 spelling when available.
  if (process.platform !== "win32") return path;
  const short = run(["cmd.exe", "/d", "/c", `for %I in ("${path}") do @echo %~sI`]).trim();
  assert.equal(statSync(short).ino, statSync(path).ino);
  return short;
}
const browserProfile = chromeDirectory(profile), browserHome = chromeDirectory(home), browserTemp = chromeDirectory(temp);
run(["git", "diff", "--exit-code", "HEAD"]);
const originalCommit = run(["git", "rev-parse", "HEAD"]).trim();
await Bun.write(join(evidence, "build.log"), run([process.execPath, "run", "build"]));
run(["git", "clone", "--no-hardlinks", "--no-checkout", "--config", "core.longpaths=true", root, changed]);
run(["git", "checkout", "--detach", originalCommit], changed);
symlinkSync(join(root, "node_modules"), join(changed, "node_modules"), process.platform === "win32" ? "junction" : "dir");
appendFileSync(join(changed, "vite.config.ts"), "\n// Redeploy validation: distinct commit identity.\n");
run(["git", "add", "vite.config.ts"], changed);
run(["git", "-c", "user.name=Validation", "-c", "user.email=validation@example.invalid", "commit", "-m", "Validation build identity change"], changed);
const changedCommit = run(["git", "rev-parse", "HEAD"], changed).trim();
await Bun.write(join(evidence, "changed-build.log"), run([process.execPath, "run", "build"], changed));
const start = performance.now(), events: any[] = [], scenarios: any[] = [], processes: any[] = [];
const log = (type: string, value: any = {}) => { const event = { ms: performance.now() - start, type, ...value }; events.push(event); if (!type.startsWith("wire")) console.log(JSON.stringify(event)); return event; };
const until = async (fn: () => any, label: string, ms = 12000) => { const deadline = performance.now() + ms; while (performance.now() < deadline) { const result = await fn(); if (result) return result; await Bun.sleep(20); } throw Error("Timed out: " + label); };
async function server(cwd: string, port = 0) {
  const module = pathToFileURL(join(cwd, "src/server/main.ts")).href;
  const harness = `await import(${JSON.stringify(module)}); process.stdin.on('data', raw => { for (const signal of raw.toString().trim().split(/\\s+/)) process.emit(signal); });`;
  const command = process.platform === "win32" ? [process.execPath, "--eval", harness] : [process.execPath, join(cwd, "src/server/main.ts")];
  const child = Bun.spawn(command, { cwd, env: { ...env, PORT: String(port) }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  processes.push(child); let stdout = "", stderr = "";
  const read = async (stream: ReadableStream<Uint8Array>, append: (s: string) => void) => { const reader = stream.getReader(); try { while (true) { const result = await reader.read(); if (result.done) break; append(new TextDecoder().decode(result.value)); } } finally { reader.releaseLock(); } };
  const readers = [read(child.stdout, s => stdout += s), read(child.stderr, s => stderr += s)];
  await until(() => stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/), "server startup");
  const actualPort = Number(stdout.match(/http:\/\/127\.0\.0\.1:(\d+)/)![1]); log("server-start", { pid: child.pid, port: actualPort, cwd });
  return { child, port: actualPort, async stop(label: string) {
    const signal = log("signal", { label, method: process.platform === "win32" ? "Windows registered SIGTERM handler via child stdin" : "OS SIGTERM", pid: child.pid });
    if (process.platform === "win32") { child.stdin.write("SIGTERM\n"); child.stdin.flush(); } else child.kill("SIGTERM");
    assert.equal(await child.exited, 0); await Promise.all(readers);
    const elapsed = performance.now() - start - signal.ms; assert(elapsed < 5000);
    await Bun.write(join(evidence, `${label}-server.log`), stdout + stderr); log("server-stopped", { label, elapsed }); return { signalMs: signal.ms, shutdownMs: elapsed };
  } };
}
async function bots(origin: string, label: string, count = 10) {
  const child = Bun.spawn([process.execPath, "run", "bots", "--", "--url", origin, "--count", String(count), "--seconds", "60", "--policy", "aimer"], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  processes.push(child);
  const result = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]).then(async ([out, err, code]) => { await Bun.write(join(evidence, `${label}-bots.log`), out + err); return code; });
  return { child, result };
}
let app: Awaited<ReturnType<typeof server>> | undefined, chrome: any, ws: WebSocket | undefined;
try {
  app = await server(root); const port = app.port, origin = `http://127.0.0.1:${port}`;
  const chromeEnv: Record<string, string | undefined> = { ...env, HOME: browserHome, USERPROFILE: browserHome, APPDATA: browserHome, LOCALAPPDATA: browserHome, TEMP: browserTemp, TMP: browserTemp }; delete chromeEnv.CHROME_CRASHPAD_PIPE_NAME;
  chrome = Bun.spawn([chromePath, `--user-data-dir=${browserProfile.replaceAll("\\", "/")}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--remote-debugging-port=0", "about:blank"], { cwd: root, env: chromeEnv, stdout: "ignore", stderr: Bun.file(join(evidence, "chrome.log")) });
  processes.push(chrome);
  const debugPort = await until(() => { try { return readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch {} }, "Chrome CDP");
  const targets: any[] = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
  let next = 0, navigation = 0, latest: any, welcomes: any[] = [], restarts: any[] = [];
  const pending = new Map<number, { resolve: (value: any) => void; reject: (value: any) => void }>();
  const send = (method: string, params: any = {}) => new Promise<any>((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws!.send(JSON.stringify({ id, method, params })); });
  ws.onmessage = raw => {
    const message = JSON.parse(String(raw.data));
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(message.error); else item?.resolve(message.result); return; }
    const p = message.params;
    if (message.method === "Page.frameNavigated" && !p.frame.parentId) { navigation++; log("navigation", { navigation, url: p.frame.url }); }
    if (message.method === "Network.webSocketCreated") log("socket-created", { requestId: p.requestId });
    if (message.method === "Network.webSocketClosed") log("socket-closed", { requestId: p.requestId });
    if (message.method === "Network.webSocketFrameSent") {
      try { const m = JSON.parse(p.response.payloadData); if (m.type === "hello") log("hello", { message: m }); } catch {}
    }
    if (message.method === "Network.webSocketFrameReceived") {
      try {
        const m = JSON.parse(p.response.payloadData);
        if (m.type === "snapshot") {
          latest = m;
          const welcome = welcomes.at(-1);
          if (welcome && !welcome.playableMs && m.players.some((p: any) => p.id === browserId && p.hits > 0)) {
            welcome.playableMs = log("playable", { buildId: welcome.message.buildId, tick: m.tick }).ms;
          }
        }
        if (m.type === "welcome") { welcomes.push(log("welcome", { message: m })); }
        if (m.type === "server_restart") { restarts.push(log("restart", { message: m })); }
        if (m.type === "life_over") log("wire-life-over", { message: m });
      } catch {}
    }
    if (message.method === "Runtime.consoleAPICalled") log("browser-console", { level: p.type, args: p.args.map((a: any) => a.value ?? a.description) });
    if (message.method === "Runtime.exceptionThrown") log("browser-exception", { details: p.exceptionDetails });
    if (message.method === "Runtime.bindingCalled") { try { log("overlay", JSON.parse(p.payload)); } catch {} }
  };
  await new Promise(resolve => ws!.onopen = resolve);
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send("Runtime.addBinding", { name: "evidenceStatus" });
  const browserId = crypto.randomUUID(), identity = { playerId: browserId, name: "ChromePilot", team: "tabs" };
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('bug-swarm-player', ${JSON.stringify(JSON.stringify(identity))}); let previous; new MutationObserver(() => { const status = document.querySelector('[role=status]')?.textContent ?? ''; if (status !== previous) { previous = status; evidenceStatus(JSON.stringify({status, canvas: !!document.querySelector('canvas'), dialog: !!document.querySelector('[role=dialog]')})); } }).observe(document, {subtree:true, childList:true, characterData:true});` });
  const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const screenshot = async (name: string) => { const result = await send("Page.captureScreenshot", { format: "png" }); await Bun.write(join(evidence, name + ".png"), Buffer.from(result.data, "base64")); };
  await send("Page.navigate", { url: origin + "/arena" });
  await until(() => evaluate("document.querySelector('button')?.textContent"), "join button");
  await evaluate("document.querySelector('button').click()");
  await until(() => welcomes.length === 1, "first welcome");
  const originalBuild = welcomes[0].message.buildId;
  assert.equal(originalBuild, originalCommit);
  let cohort = await bots(origin, "same");
  await until(() => latest?.players.length === 11 && latest.players.every((p: any) => p.hits > 0), "eleven living players");
  await Bun.sleep(2500); await screenshot("before-same-restart");
  for (const scenario of ["same", "changed", "rollback", "redeploy", "delayed"] as const) {
    if (scenario !== "same") {
      cohort = await bots(origin, scenario);
      await until(() => latest?.players.length === 11 && latest.players.every((p: any) => p.hits > 0), "second eleven living players");
      await Bun.sleep(1800); await screenshot("before-changed-restart");
    }
    assert(latest.players.find((p: any) => p.id === browserId)?.hits > 0);
    const observed = structuredClone(latest), navBefore = navigation, welcomesBefore = welcomes.length;
    const arenaStats = await (await fetch(origin + "/api/arena/stats")).json();
    const frame = await evaluate("({fps:document.querySelector('canvas').dataset.fps, frameMs:document.querySelector('canvas').dataset.frameMs})");
    const beforeDb = new Database(join(data, "app.db"), { readonly: true });
    const activeRuns = beforeDb.query("SELECT id, player_id FROM runs WHERE ended_at_ms IS NULL").all() as any[]; beforeDb.close();
    assert.equal(activeRuns.length, 11);
    let lock: Database | undefined, release: ReturnType<typeof setTimeout> | undefined;
    if (scenario === "delayed") { lock = new Database(join(data, "app.db")); lock.exec("BEGIN IMMEDIATE"); release = setTimeout(() => lock!.exec("ROLLBACK"), 3500); }
    let stop: Awaited<ReturnType<Awaited<ReturnType<typeof server>>["stop"]>>;
    try { stop = await app!.stop(scenario); app = undefined; }
    finally { clearTimeout(release); try { lock?.exec("ROLLBACK"); } catch {} lock?.close(); }
    await cohort.result;
    await until(() => evaluate("document.querySelector('[role=status]')?.textContent?.startsWith('Score saved:')"), "saved overlay");
    const overlay = await evaluate("({status:document.querySelector('[role=status]')?.textContent, canvas:!!document.querySelector('canvas'), dialog:!!document.querySelector('[role=dialog]')})");
    assert(overlay.canvas && !overlay.dialog); await screenshot(scenario + "-saved-overlay");
    const db = new Database(join(data, "app.db"), { readonly: true });
    const saved = activeRuns.map(r => {
      const row = db.query("SELECT * FROM runs WHERE id = ?").get(r.id) as any;
      const count = db.query("SELECT count(*) AS n FROM events WHERE type = 'run_ended' AND run_id = ?").get(r.id) as any;
      assert.equal(row.end_reason, "restart"); assert.notEqual(row.ended_at_ms, null); assert.equal(count.n, 1);
      assert(row.score >= observed.players.find((p: any) => p.id === r.player_id).score);
      return { ...row, endEvents: count.n };
    }); db.close();
    const stats = Bun.spawnSync([process.execPath, "run", "stats"], { cwd: root, env, stdout: "pipe", stderr: "pipe" }); assert.equal(stats.exitCode, 0);
    await Bun.write(join(evidence, scenario + "-stats.txt"), stats.stdout); log("stats", { scenario, report: stats.stdout.toString() });
    latest = undefined;
    const target = scenario === "same" || scenario === "rollback" ? root : changed;
    const reload = scenario === "changed" || scenario === "rollback" || scenario === "redeploy";
    app = await server(target, port);
    await until(() => welcomes.length > welcomesBefore && latest?.players.some((p: any) => p.id === browserId && p.hits > 0), "automatic playable rejoin");
    if (reload) await until(() => welcomes.length >= welcomesBefore + 2 && navigation === navBefore + 1, "reload then automatic welcome");
    await Bun.sleep(250);
    const statsBuild = (await (await fetch(origin + "/api/arena/stats")).json()).buildId;
    assert.equal(navigation - navBefore, reload ? 1 : 0);
    assert.equal(welcomes.at(-1).message.playerId, browserId);
    assert.equal(welcomes.at(-1).message.buildId, statsBuild);
    assert.equal(statsBuild, target === root ? originalCommit : changedCommit);
    const firstPlayableMs = performance.now() - start;
    const result = { scenario, ...stop, resumedMs: welcomes.at(-1).playableMs - stop.signalMs, verifiedMs: firstPlayableMs - stop.signalMs, navigationDelta: navigation - navBefore, identity, buildId: statsBuild, overlay, observed, saved, arenaStats, frame };
    scenarios.push(result); log("scenario-passed", { scenario, shutdownMs: stop.shutdownMs, resumedMs: result.resumedMs, navigationDelta: result.navigationDelta, savedLives: saved.length });
    await screenshot(scenario + "-rejoined");
  }
  // Full-room timing plus the phone status layouts use the same owned production server.
  const full = await bots(origin, "full-room", 19);
  await until(() => latest?.players.length === 20, "full room");
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "f", code: "KeyF" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "f", code: "KeyF" });
  await Bun.sleep(2300);
  log("full-room-timing", { frame: await evaluate("({...document.querySelector('canvas').dataset})"), stats: await (await fetch(origin + "/api/arena/stats")).json() });
  await screenshot("full-room-frame-timing");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 60, y: 420, id: 1 }, { x: 330, y: 420, id: 2 }] });
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 110, y: 420, id: 1 }, { x: 330, y: 370, id: 2 }] });
  await Bun.sleep(180); await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await Bun.sleep(100); await screenshot("portrait-play");
  await app!.stop("portrait"); app = undefined; await full.result;
  await until(() => evaluate("document.querySelector('[role=status]')?.textContent?.includes('Rejoining')"), "portrait restart overlay");
  await screenshot("portrait-saved-overlay");
  latest = undefined; app = await server(changed, port);
  await until(() => latest?.players.some((p: any) => p.id === browserId && p.hits > 0), "portrait rejoin");
  await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 1, mobile: true });
  await Bun.sleep(150); await app!.stop("landscape"); app = undefined;
  await until(() => evaluate("document.querySelector('[role=status]')?.textContent?.includes('Rejoining')"), "landscape restart overlay");
  await screenshot("landscape-saved-overlay");
  latest = undefined; app = await server(changed, port);
  await until(() => latest?.players.some((p: any) => p.id === browserId && p.hits > 0), "landscape rejoin");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  // A fresh page verifies release 1 remains usable and can start a run.
  await send("Page.navigate", { url: origin + "/" });
  await until(() => evaluate("document.body.textContent.includes('Bug Swarm') && !!document.querySelector('button')"), "release 1 entry");
  await screenshot("release1-entry"); log("release1-smoke", { text: await evaluate("document.body.innerText") });
  await evaluate("document.querySelector('button').click()");
  await until(() => evaluate("!!document.querySelector('canvas')"), "release 1 plays");
  await screenshot("release1-playing");
  assert(!events.some(e => e.type === "browser-exception"), "Browser exceptions during validation");
  await app!.stop("cleanup"); app = undefined;
  await send("Browser.close").catch(() => {}); await chrome.exited;
  await Bun.write(join(evidence, "browser-validation.json"), JSON.stringify({ chrome: targets[0]?.title, scenarios, events }, null, 2));
  console.log("Production Chrome validation passed");
} finally {
  if (app?.child.exitCode === null) await app.stop("cleanup-failure").catch(() => {});
  ws?.close();
  for (const child of processes) if (child.exitCode === null) { child.kill(); await child.exited; }
  await Bun.write(join(evidence, "browser-events.json"), JSON.stringify({ scenarios, events }, null, 2));
}
