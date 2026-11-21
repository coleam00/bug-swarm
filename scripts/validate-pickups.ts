// Production Chrome evidence. Build first; CHROME_PATH may override installed Chrome.
// All browser profiles, databases, logs and screenshots stay in .evidence/79/.
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import type { ArenaState, PickupKind } from '../src/shared/arena/types';
const repo = process.cwd();
const chromePath = process.env.CHROME_PATH ?? [
  join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
].find(existsSync);
if (!chromePath || !existsSync(chromePath)) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable, then run from the repository root.");
const { createServer } = await import(pathToFileURL(join(repo, 'src/server/server.ts')).href);
const { runBots } = await import(pathToFileURL(join(repo, 'scripts/bots.ts')).href);
const evidenceRoot = join(repo, '.evidence/79'); mkdirSync(evidenceRoot, { recursive: true });
const root = mkdtempSync(join(evidenceRoot, 'production-')), home = join(root, 'home'), temp = join(root, 'tmp');
for (const path of [home, temp, join(home, 'AppData/Local'), join(home, 'AppData/Roaming')]) mkdirSync(path, { recursive: true });
for (const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME']) process.env[key] = home;
process.env.APPDATA = join(home, 'AppData/Roaming'); process.env.LOCALAPPDATA = join(home, 'AppData/Local');
process.env.TEMP = process.env.TMP = temp; process.env.DATA_DIR = join(root, 'data');
const evidence = root; console.log(`Evidence: ${evidence}`);
const app = createServer({ port: 0, hostname: '127.0.0.1', dataDir: join(root, 'data'), env: { NODE_ENV: 'production' } });
const origin = app.server.url.origin, report: any = { origin, samples: {}, assertions: [] };
const chrome = Bun.spawn([chromePath,'--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(root,'profile').replaceAll('\\', '/')}`,'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-gpu','about:blank'], { stdout: 'ignore', stderr: Bun.file(join(root, 'chrome.log')), env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CHROME_CRASHPAD_PIPE_NAME')) });
let interrupted = false;
const interrupt = () => { interrupted = true; botAbort?.abort(); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
let socket: WebSocket | undefined, vite: any, botTask: Promise<any> | undefined, botAbort: AbortController | undefined;
let loadProcess: ReturnType<typeof Bun.spawn> | undefined;
let serial = 0; const pending = new Map<number, any>();
const pause = (ms: number) => Bun.sleep(ms);
async function until(fn: () => any, timeout = 10000) { const end = performance.now() + timeout; while (performance.now() < end) { if (interrupted) throw new Error("Validation interrupted"); const v = await fn(); if (v) return v; await pause(50); } throw new Error('Condition timed out'); }
function call(method: string, params: any = {}, sessionId?: string): Promise<any> { const id = ++serial; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 30000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
async function evaluate(session: string, expression: string) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function shot(session: string, name: string) { const r = await call('Page.captureScreenshot', { format: 'png' }, session); writeFileSync(join(evidence, name + '.png'), Buffer.from(r.data, 'base64')); }
async function page(width: number, height: number, url: string, touch = false) {
  const { browserContextId } = await call('Target.createBrowserContext'); const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  console.log('Opening page', sessionId, url);
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId);
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch }, sessionId);
  if (touch) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }, sessionId);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.evidence={snap:null,inputs:[],errors:[],kills:0,life:[]}; const Native=WebSocket; window.WebSocket=class extends Native {constructor(...args){super(...args);window.gameSocket=this;this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='welcome')window.evidence.id=m.playerId;if(m.type==='snapshot'){window.evidence.snap=m;window.evidence.kills+=m.events.length;}if(m.type==='life_over')window.evidence.life.push(m);});}send(data){const m=JSON.parse(data); if(m.type!=='hello'){window.evidence.inputs.push(m); if(window.evidence.inputs.length>100)window.evidence.inputs.shift();}return super.send(data);}}; window.addEventListener('error',e=>window.evidence.errors.push(String(e.message))); const err=console.error;console.error=(...args)=>{window.evidence.errors.push(args.map(String).join(' '));err(...args);};` }, sessionId);
  await call('Page.navigate', { url }, sessionId); return { session: sessionId, targetId, browserContextId };
}
async function joinPage(p: any, name: string, teamIndex: number) {
  await until(() => evaluate(p.session, `!!document.querySelector('#name')`));
  await evaluate(p.session, `document.querySelector('#name').focus()`); await call('Input.insertText', { text: name }, p.session);
  await evaluate(p.session, `document.querySelectorAll('.entry-teams button')[${teamIndex}].click()`);
  await until(() => evaluate(p.session, `!!window.evidence.snap`));
}
const ownExpr = `window.evidence.snap?.players.find(p=>p.id===window.evidence.id)`;
async function stats(session: string) { return evaluate(session, `({frame:{...document.querySelector('canvas').dataset},overflow:document.documentElement.scrollWidth>innerWidth,errors:window.evidence.errors,players:window.evidence.snap?.players.length,own:${ownExpr}})`); }
async function key(session: string, code: string, down: boolean) { await call('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: code === 'Space' ? ' ' : code.replace('Key',''), windowsVirtualKeyCode: code === 'Space' ? 32 : code.replace('Key','').charCodeAt(0) }, session); }
async function touch(session: string, type: string, points: any[]) { await call('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ radiusX: 10, radiusY: 10, force: 1, ...p })) }, session); }
try {
  await until(() => existsSync(join(root, 'profile', 'DevToolsActivePort')), 30000);
  const port = readFileSync(join(root, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json(); report.browser = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket!.onopen = resolve; socket!.onerror = reject; });
  socket.onmessage = event => {
    const m = JSON.parse(String(event.data)), p = pending.get(m.id);
    if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };
  const desktop = await page(1280, 800, origin + '/'), phone = await page(390, 844, origin + '/', true);
  await joinPage(desktop, 'Pickup Pilot', 1); await joinPage(phone, 'Boost Pilot', 0);
  const desktopId = await evaluate(desktop.session, 'window.evidence.id'), phoneId = await evaluate(phone.session, 'window.evidence.id');
  const room = app.arenas.active.get(desktopId)!.room!, state: ArenaState = room.state;
  const p = state.players.get(desktopId)!, q = state.players.get(phoneId)!;
  botAbort = new AbortController();
  botTask = runBots({ url: origin, count: 18, seconds: 240, policy: 'aimer' }, botAbort.signal); void botTask?.catch(() => {});
  await until(() => evaluate(desktop.session, 'window.evidence.snap?.players.length===20'));
  await key(desktop.session, 'KeyF', true); await key(desktop.session, 'KeyF', false);
  report.fullRoomFrames = [];
  for (let i = 0; i < 8; i++) { await pause(1000); report.fullRoomFrames.push({ desktop: await stats(desktop.session), phone: await stats(phone.session) }); }
  await shot(desktop.session, 'full-room-f-timings'); report.fullRoomTick = app.arenas.stats();
  // Protect only the stationary evidence observers; bots kill and roll drops through normal production play.
  p.immuneUntil = q.immuneUntil = state.tick * 50 + 60000;
  await until(() => state.pickups.length > 0, 60000);
  const natural = structuredClone(state.pickups[0]!); report.naturalDrop = { pickup: natural, snapshot: structuredClone(app.arenas.snapshot(room)) };
  Object.assign(p, { x: Math.max(450, Math.min(1950, natural.x - 100)), y: Math.max(450, Math.min(1950, natural.y)) });
  await pause(250); await shot(desktop.session, 'natural-drop-observer-moved');
  report.assertions.push('A ' + natural.kind + ' rolled naturally from a bot kill; observer repositioned for the screenshot.');
  // Controlled visual scenes are separate from natural frame/tick and load measurements.
  function clearThreats() {
    state.bugs = []; state.shots = [];
    for (const bot of state.players.values()) if (bot.id !== desktopId && bot.id !== phoneId) Object.assign(bot, { x: 2200, y: 2200, immuneUntil: state.tick * 50 + 60000 });
  }
  clearThreats(); state.pickups = [];
  Object.assign(p, { x: 1200, y: 1200, immuneUntil: 0, spawnProtectedUntil: 0, effects: {} });
  Object.assign(q, { x: 1320, y: 1400, immuneUntil: 0, spawnProtectedUntil: state.tick * 50 + 2000, effects: {} });
  assert.equal(p.status, 'active'); assert.equal(q.status, 'active');
  function drop(x: number, y: number, remaining = 12000, kind: PickupKind = 'shield') { const pickup = { id: state.nextId++, kind, x, y, expiresAt: state.tick * 50 + remaining }; state.pickups.push(pickup); return pickup; }
  const pickup = drop(p.x + 120, p.y); await pause(300);
  report.floor = structuredClone(app.arenas.snapshot(room));
  await shot(desktop.session, 'desktop-floor-and-spawn-arcs'); await shot(phone.session, 'portrait-floor');
  pickup.expiresAt = state.tick * 50 + 2900;
  await until(() => Math.floor((pickup.expiresAt - state.tick * 50) / 250) % 2 === 0);
  await pause(120); await shot(desktop.session, 'desktop-floor-blink-dim');
  report.blinkDim = structuredClone(app.arenas.snapshot(room));
  await pause(250); await shot(desktop.session, 'desktop-floor-blink-bright');
  report.blinkBright = structuredClone(app.arenas.snapshot(room));
  pickup.expiresAt = state.tick * 50 + 12000;
  await key(desktop.session, 'KeyD', true); await until(() => !!p.effects.shield); await key(desktop.session, 'KeyD', false);
  await until(() => evaluate(desktop.session, '(' + ownExpr + ')?.effects.shield'));
  await pause(200); await shot(desktop.session, 'desktop-active'); await shot(phone.session, 'portrait-remote-bubble');
  const firstDeadline = p.effects.shield!; report.collected = structuredClone(app.arenas.snapshot(room));
  assert(!state.pickups.some(v => v.id === pickup.id));
  await pause(3000); await shot(desktop.session, 'desktop-draining-hud');
  clearThreats(); drop(p.x + 65, p.y); await key(desktop.session, 'KeyD', true);
  await until(() => p.effects.shield! > firstDeadline); await key(desktop.session, 'KeyD', false);
  await pause(200); await shot(desktop.session, 'desktop-refreshed'); report.refreshed = structuredClone(app.arenas.snapshot(room));
  clearThreats(); drop(q.x + 90, q.y); await pause(200); await shot(phone.session, 'portrait-floor-nearby');
  await touch(phone.session, 'touchStart', [{ id: 1, x: 70, y: 600 }]);
  await touch(phone.session, 'touchMove', [{ id: 1, x: 130, y: 600 }]); await until(() => !!q.effects.shield); await touch(phone.session, 'touchEnd', []);
  await pause(200); await shot(phone.session, 'portrait-active');
  report.portraitActive = structuredClone(app.arenas.snapshot(room));
  const hits = p.hits; p.immuneUntil = p.spawnProtectedUntil = 0;
  state.bugs = [{ id: state.nextId++, kind: 'crawler', hp: 1, facing: 0, x: p.x, y: p.y, vx: 0, vy: 0 }];
  await until(() => !p.effects.shield); assert.equal(p.hits, hits); state.bugs = [];
  await pause(200); await shot(desktop.session, 'desktop-consumed'); report.consumed = structuredClone(app.arenas.snapshot(room));
  report.assertions.push('Movement collected one authoritative shield, refresh extended deadline, eligible contact consumed it without losing health.');
  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true }, phone.session);
  await touch(phone.session, 'touchStart', [{ id: 4, x: 120, y: 270 }, { id: 5, x: 700, y: 270 }]);
  await touch(phone.session, 'touchMove', [{ id: 4, x: 165, y: 270 }, { id: 5, x: 760, y: 270 }]); await pause(200);
  report.landscapeTwin = await evaluate(phone.session, 'window.evidence.inputs.at(-1)');
  assert(report.landscapeTwin.fire && report.landscapeTwin.move.x > 0 && report.landscapeTwin.touch);
  report.landscapeActive = structuredClone(app.arenas.snapshot(room));
  await shot(phone.session, 'landscape-active-twin-sticks'); await touch(phone.session, 'touchEnd', []);
  report.weapons = {};
  for (const kind of ['spread', 'rapid'] as const) {
    clearThreats(); state.pickups = [];
    Object.assign(p, { x: 1200, y: 1200, effects: {}, heat: 0, nextShotAt: state.tick * 50, overheatUntil: 0, immuneUntil: 0, spawnProtectedUntil: 0 });
    Object.assign(q, { x: 1320, y: 1400, effects: {}, heat: 0, nextShotAt: state.tick * 50, overheatUntil: 0, immuneUntil: 0, spawnProtectedUntil: 0 });
    await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, phone.session);
    const floor = drop(p.x + 100, p.y, 12000, kind); await pause(250);
    const scene: any = report.weapons[kind] = { floor: structuredClone(app.arenas.snapshot(room)) };
    await shot(desktop.session, kind + '-desktop-floor'); await shot(phone.session, kind + '-portrait-floor');
    await key(desktop.session, 'KeyD', true); await until(() => !!p.effects[kind]); await key(desktop.session, 'KeyD', false);
    const deadline = p.effects[kind]!;
    clearThreats(); drop(q.x, q.y, 12000, kind); await until(() => !!q.effects[kind]);
    await key(desktop.session, 'Space', true); await pause(150); await key(desktop.session, 'Space', false); await pause(100);
    assert(!state.pickups.some(p => p.id === floor.id));
    scene.active = structuredClone(app.arenas.snapshot(room));
    assert(scene.active.shots.some((s: any) => s.owner === p.id));
    await shot(desktop.session, kind + '-desktop-active'); await shot(phone.session, kind + '-portrait-active');
    await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true }, phone.session);
    await touch(phone.session, 'touchStart', [{ id: 7, x: 120, y: 270 }, { id: 8, x: 700, y: 270 }]);
    await touch(phone.session, 'touchMove', [{ id: 7, x: 165, y: 270 }, { id: 8, x: 760, y: 270 }]); await pause(200);
    const input = await evaluate(phone.session, 'window.evidence.inputs.at(-1)'); assert(input.fire && input.move.x > 0 && input.touch);
    scene.touch = input; await shot(phone.session, kind + '-landscape-twin-sticks'); await touch(phone.session, 'touchEnd', []);
    await pause(1000); clearThreats(); drop(p.x + 65, p.y, 12000, kind);
    await key(desktop.session, 'KeyD', true); await until(() => p.effects[kind]! > deadline); await key(desktop.session, 'KeyD', false);
    await pause(200); scene.refreshed = structuredClone(app.arenas.snapshot(room)); await shot(desktop.session, kind + '-refreshed');
    // Prevent contacts from clearing effects before their actual deadline during the expiry capture.
    const refreshed = p.effects[kind]!; p.immuneUntil = q.immuneUntil = state.tick * 50 + 12000;
    await until(() => state.tick * 50 >= refreshed, 10000); assert.equal(p.effects[kind], undefined); assert.equal(p.status, 'active');
    await pause(200); scene.expired = structuredClone(app.arenas.snapshot(room)); await shot(desktop.session, kind + '-expired');
    report.assertions.push(kind + ': floor, collection, firing, both robot overlays/HUDs, refresh, eight-second expiry and twin sticks passed.');
  }
  for (const browserPage of [desktop, phone]) {
    const result = await stats(browserPage.session); assert(!result.overflow); assert.deepEqual(result.errors, []);
    await call('Target.disposeBrowserContext', { browserContextId: browserPage.browserContextId });
  }
  botAbort.abort(); await botTask?.catch(() => {}); botTask = undefined;
  await until(() => app.arenas.active.size === 0);
  const { createServer: createVite } = await import(pathToFileURL(join(repo, 'node_modules/vite/dist/node/index.js')).href);
  vite = await createVite({ configFile: false, root: repo, cacheDir: join(root, 'vite-cache'), server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.evidence/**'] } } }); await vite.listen();
  report.benchmarks = [];
  for (const baseline of [true, false]) for (const [width, height] of [[1280, 800], [390, 844], [844, 390]]) {
    const fixture = await page(width!, height!, 'http://127.0.0.1:' + vite.httpServer.address().port + '/scripts/arena-benchmark.html' + (baseline ? '?baseline' : ''));
    await until(() => evaluate(fixture.session, '!!document.querySelector("canvas")?.dataset.fps'));
    const samples = [];
    for (let i = 0; i < 4; i++) { await pause(1000); samples.push(await evaluate(fixture.session, '({...document.querySelector("canvas").dataset})')); }
    report.benchmarks.push({ baseline, width, height, samples }); await shot(fixture.session, 'benchmark-' + (baseline ? 'baseline-' : 'shield-') + width + 'x' + height);
    await call('Target.disposeBrowserContext', { browserContextId: fixture.browserContextId });
  }
  await vite.close(); vite = undefined;
  console.log('All three production pickup scenes passed; starting 200 bots / 120 seconds');
  // Exercise the actual CLI in its own process, as real clients run separately from the server.
  loadProcess = Bun.spawn([process.execPath, 'run', 'bots', '--', '--url', origin, '--count', '200', '--seconds', '120', '--policy', 'aimer'],
    { stdout: Bun.file(join(evidence, 'bots.json')), stderr: Bun.file(join(evidence, 'bots.stderr.log')) });
  assert.equal(await loadProcess.exited, 0, 'Bot CLI failed; see bots.stderr.log');
  report.load = JSON.parse(readFileSync(join(evidence, 'bots.json'), 'utf8'));
  assert.equal(report.load.joins, 200); assert.equal(report.load.errors, 0); assert(report.load.tick.p95Ms < 10);
  report.assertions.push('200 joins, zero errors, tick p95 < 10ms.'); console.log(JSON.stringify(report.load));
} finally {
  if (loadProcess?.exitCode === null) loadProcess.kill(); await loadProcess?.exited;
  botAbort?.abort(); await botTask?.catch(() => {}); await vite?.close();
  await Bun.write(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await call('Browser.close').catch(() => {}); socket?.close();
  if (chrome.exitCode === null) chrome.kill(); await chrome.exited; await app.stop();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}
