// Production Chrome evidence. Build first; CHROME_PATH may override installed Chrome.
// All browser profiles, databases, logs and screenshots stay in .evidence/72/.
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const repo = process.cwd();
const chromePath = process.env.CHROME_PATH ?? [
  join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome',
].find(existsSync);
if (!chromePath || !existsSync(chromePath)) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable, then run from the repository root.");
const { createServer } = await import(pathToFileURL(join(repo, 'src/server/server.ts')).href);
const { runBots } = await import(pathToFileURL(join(repo, 'scripts/bots.ts')).href);
const evidenceRoot = join(repo, '.evidence/72'); mkdirSync(evidenceRoot, { recursive: true });
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
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); report.browser = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket!.onopen = resolve; socket!.onerror = reject; });
  socket.onmessage = event => {
    const m = JSON.parse(String(event.data)), p = pending.get(m.id);
    if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };
  const desktop = await page(1280, 800, origin + '/'), phone = await page(390, 844, origin + '/', true);
  await joinPage(desktop, 'Rescuer', 1); await joinPage(phone, 'Downed', 0);
  botAbort = new AbortController();
  botTask = runBots({ url: origin, count: 18, seconds: 120, policy: 'aimer' }, botAbort.signal); void botTask?.catch(() => {});
  await until(() => evaluate(desktop.session, 'window.evidence.snap?.players.length===20'));
  await key(desktop.session, 'KeyF', true); await key(desktop.session, 'KeyF', false);
  report.fullRoomFrames = [];
  for (let i = 0; i < 8; i++) {
    await pause(1000); const sample = { desktop: await stats(desktop.session), phone: await stats(phone.session) };
    for (const client of [sample.desktop, sample.phone]) { assert.equal(client.players, 20); assert.deepEqual(client.errors, []); }
    report.fullRoomFrames.push(sample);
  }
  report.fullRoomTick = app.arenas.stats(); await shot(desktop.session, 'full-room-f-timings');
  const victimId = await evaluate(phone.session, 'window.evidence.id'), rescuerId = await evaluate(desktop.session, 'window.evidence.id');
  const connection = app.arenas.active.get(victimId)!, rescuerConnection = app.arenas.active.get(rescuerId)!;
  const room = connection.room!, p = room.state.players.get(victimId)!, q = room.state.players.get(rescuerId)!;
  assert.equal(room, rescuerConnection.room); const runId = connection.record!.runId;
  // Deterministic scene setup on this owned server; damage, input, timing,
  // rewards and saves below use the ordinary production paths.
  room.state.bugs = []; room.state.shots = [];
  for (const bot of room.state.players.values()) if (bot.id !== victimId && bot.id !== rescuerId)
    Object.assign(bot, { x: 2100, y: 2100, immuneUntil: room.state.tick * 50 + 60000 });
  Object.assign(p, { x: 800, y: 1000, hits: 3, immuneUntil: 0, spawnProtectedUntil: 0 });
  Object.assign(q, { x: 1450, y: 1000, immuneUntil: room.state.tick * 50 + 60000 });
  await pause(150);
  room.state.bugs = [{ id: room.state.nextId++, kind: 'crawler', x: p.x + 25, y: p.y, vx: 0, vy: 0 }];
  await key(phone.session, 'Space', true); await pause(100); await key(phone.session, 'Space', false);
  await until(() => p.score > 0); const victimBefore = { score: p.score, streak: p.streak, life: p.life, startedTick: p.startedTick };
  room.state.bugs = [{ id: room.state.nextId++, kind: 'crawler', x: p.x, y: p.y + 20, vx: 0, vy: 0 }];
  // Hold two touch controls across downing: the next damage arrives while they
  // are held, and capture/input must clear without requesting a respawn.
  await until(() => p.hits === 1);
  await until(() => room.state.tick * 50 >= p.immuneUntil - 100);
  await touch(phone.session, 'touchStart', [{ id: 1, x: 70, y: 600 }, { id: 2, x: 310, y: 600 }]);
  await touch(phone.session, 'touchMove', [{ id: 1, x: 73, y: 600 }, { id: 2, x: 370, y: 600 }]);
  await until(() => p.status === 'downed');
  // Release immediately after the authoritative transition, before any firing
  // cooldown can be mistaken for a new life.
  await touch(phone.session, 'touchEnd', []);
  await until(() => evaluate(phone.session, `(${ownExpr})?.status==='downed'`));
  assert.equal(p.reviveMs, 0); assert.equal(connection.record!.runId, runId); assert.equal(connection.result, undefined);
  // Downing cancels the still-travelling held shot without resetting accuracy.
  const frozen = { score: p.score, streak: p.streak, life: p.life, startedTick: p.startedTick };
  assert.equal(frozen.score, victimBefore.score); assert.equal(frozen.streak, victimBefore.streak);
  report.beforeDown = victimBefore; report.downed = structuredClone(p);
  await shot(phone.session, 'portrait-local-downed'); await shot(desktop.session, 'desktop-edge-arrow');
  console.log('Downed, countdown and off-screen arrow captured');
  await key(phone.session, 'KeyW', true); await touch(phone.session, 'touchStart', [{ id: 3, x: 70, y: 600 }]);
  await touch(phone.session, 'touchMove', [{ id: 3, x: 130, y: 600 }]);
  const downPosition = { x: p.x, y: p.y }; await pause(100);
  assert.equal(p.x, downPosition.x); assert.equal(p.y, downPosition.y); assert.equal(p.life, frozen.life);
  await key(desktop.session, 'KeyA', true);
  await until(() => Math.hypot(p.x - q.x, p.y - q.y) < 420);
  await shot(desktop.session, 'other-browser-downed');
  await until(() => Math.hypot(p.x - q.x, p.y - q.y) <= 85); await key(desktop.session, 'KeyA', false);
  const rescuerScore = q.score;
  await until(() => p.reviveMs >= 500);
  report.inProgress = { victim: structuredClone(p), rescuer: structuredClone(q) };
  await shot(desktop.session, 'revive-in-progress'); await shot(phone.session, 'portrait-revive-in-progress');
  await until(() => p.status === 'active');
  assert.equal(p.hits, 1); assert.equal(connection.record!.runId, runId); assert.equal(connection.result, undefined);
  for (const [field, value] of Object.entries(frozen)) assert.equal((p as any)[field], value);
  assert.equal(q.score, rescuerScore + 50);
  await until(() => evaluate(phone.session, `(${ownExpr})?.status==='active'`));
  await pause(100);
  const afterInput = await evaluate(phone.session, 'window.evidence.inputs.at(-1)');
  assert.equal(afterInput.type, 'input'); assert.deepEqual(afterInput.move, { x: 0, y: 0 }); assert.equal(afterInput.fire, false);
  report.completed = { victim: structuredClone(p), rescuer: structuredClone(q), runId, input: afterInput };
  await shot(desktop.session, 'revive-completed'); await shot(phone.session, 'portrait-revived');
  await key(phone.session, 'KeyW', false); await touch(phone.session, 'touchEnd', []);
  report.assertions.push('Same life/run/score/streak across down and revival; rescuer +50; no early save/respawn; held controls cleared.');
  // Repeat in landscape with real twin-stick input, then leave the player
  // unrescued through the complete timeout and normal fresh-input respawn.
  await call('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true }, phone.session);
  await touch(phone.session, 'touchStart', [{ id: 4, x: 120, y: 270 }, { id: 5, x: 700, y: 270 }]);
  await touch(phone.session, 'touchMove', [{ id: 4, x: 165, y: 270 }, { id: 5, x: 760, y: 270 }]); await pause(200);
  report.landscapeTwin = await evaluate(phone.session, 'window.evidence.inputs.at(-1)');
  assert(report.landscapeTwin.fire && report.landscapeTwin.move.x > 0 && report.landscapeTwin.touch);
  await touch(phone.session, 'touchEnd', []);
  Object.assign(q, { x: 1450, y: 1000 }); p.immuneUntil = room.state.tick * 50 + 100;
  room.state.bugs = [{ id: room.state.nextId++, kind: 'crawler', x: p.x, y: p.y + 20, vx: 0, vy: 0 }];
  await until(() => p.status === 'downed'); await pause(150); await shot(phone.session, 'landscape-local-downed');
  await until(() => p.status === 'out', 12000); await until(() => connection.result?.save === 'saved');
  report.timeout = structuredClone(connection.result); assert.equal(connection.result!.life, frozen.life);
  assert.equal((app.db.query('SELECT COUNT(*) AS n FROM events WHERE type = ? AND run_id = ?').get('run_ended', runId) as any).n, 1);
  await shot(phone.session, 'landscape-timeout');
  await key(phone.session, 'Space', true); await key(phone.session, 'Space', false);
  await until(() => p.life === frozen.life + 1); report.respawn = structuredClone(p); await pause(150); await shot(phone.session, 'landscape-respawn');
  report.assertions.push('Landscape twin sticks, unrescued timeout saves once and fresh-input respawn.');
  for (const browserPage of [desktop, phone]) {
    const state = await stats(browserPage.session); assert(!state.overflow); assert.deepEqual(state.errors, []);
    await call('Target.disposeBrowserContext', { browserContextId: browserPage.browserContextId });
  }
  botAbort.abort(); await botTask?.catch(() => {}); botTask = undefined;
  await until(() => app.arenas.active.size === 0);
  // Developer-only renderer maximums, including 19 downed states and arrows.
  const { createServer: createVite } = await import(pathToFileURL(join(repo, 'node_modules/vite/dist/node/index.js')).href);
  vite = await createVite({ configFile: false, root: repo, server: { host: '127.0.0.1', port: 0, watch: { ignored: ['**/.evidence/**'] } } }); await vite.listen();
  report.benchmarks = [];
  for (const rescue of [false, true]) for (const [width, height] of [[1280, 800], [390, 844], [844, 390]]) {
    const fixture = await page(width!, height!, `http://127.0.0.1:${vite.httpServer.address().port}/scripts/arena-benchmark.html${rescue ? '?revive' : ''}`);
    await until(() => evaluate(fixture.session, `!!document.querySelector('canvas')?.dataset.fps`));
    const samples = [];
    for (let i = 0; i < 4; i++) { await pause(1000); samples.push(await evaluate(fixture.session, `({...document.querySelector('canvas').dataset})`)); }
    report.benchmarks.push({ rescue, width, height, samples }); await shot(fixture.session, `benchmark-${rescue ? 'rescue' : 'combat'}-${width}x${height}`);
    await call('Target.disposeBrowserContext', { browserContextId: fixture.browserContextId });
  }
  await vite.close(); vite = undefined;
  console.log('Production browsers and renderer scenarios passed; starting 200 bots / 120 seconds');
  report.load = await runBots({ url: origin, count: 200, seconds: 120, policy: 'aimer' });
  assert.equal(report.load.joins, 200); assert.equal(report.load.errors, 0); assert(report.load.tick.p95Ms < 10);
  report.assertions.push('200 joins, zero errors, tick p95 < 10ms.');
  console.log(JSON.stringify(report.load));
} finally {
  botAbort?.abort(); await botTask?.catch(() => {}); await vite?.close();
  await Bun.write(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await call('Browser.close').catch(() => {}); socket?.close();
  if (chrome.exitCode === null) chrome.kill(); await chrome.exited; await app.stop();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}
