// Production Chrome evidence. Build first; CHROME_PATH may override installed Chrome.
// All browser profiles, databases, logs and screenshots stay in .evidence/88/.
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
const evidenceRoot = join(repo, '.evidence/88'); mkdirSync(evidenceRoot, { recursive: true });
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
let socket: WebSocket | undefined, botTask: Promise<any> | undefined, botAbort: AbortController | undefined;
let serial = 0; const pending = new Map<number, any>();
const pause = (ms: number) => Bun.sleep(ms);
async function until(fn: () => any, timeout = 10000) { const end = performance.now() + timeout; while (performance.now() < end) { if (interrupted) throw new Error("Validation interrupted"); const v = await fn(); if (v) return v; await pause(50); } throw new Error('Condition timed out'); }
function call(method: string, params: any = {}, sessionId?: string): Promise<any> { const id = ++serial; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 30000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
async function evaluate(session: string, expression: string) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function shot(session: string, name: string) { const r = await call('Page.captureScreenshot', { format: 'png' }, session); writeFileSync(join(evidence, name + '.png'), Buffer.from(r.data, 'base64')); }
const decoderBuild = await Bun.build({ entrypoints: [join(import.meta.dir, "browser-decoder.ts")], target: "browser", format: "iife" });
if (!decoderBuild.success) throw Error("Browser observer decoder build failed");
const decoderSource = await decoderBuild.outputs[0]!.text();
async function page(width: number, height: number, url: string, touch = false) {
  const { browserContextId } = await call('Target.createBrowserContext'); const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  console.log('Opening page', sessionId, url);
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId);
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch }, sessionId);
  if (touch) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }, sessionId);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `${decoderSource}
window.evidence={snap:null,inputs:[],errors:[],kills:0,life:[],texts:[]};
const fill=CanvasRenderingContext2D.prototype.fillRect, text=CanvasRenderingContext2D.prototype.fillText;
CanvasRenderingContext2D.prototype.fillRect=function(...args){if(this.canvas.isConnected&&args[0]===0&&args[1]===0)window.evidence.texts=[];return fill.apply(this,args);};
CanvasRenderingContext2D.prototype.fillText=function(...args){if(this.canvas.isConnected)window.evidence.texts.push(args[0]);return text.apply(this,args);};
const Native=WebSocket; window.WebSocket=class extends Native {constructor(...args){super(...args);const decoder=new window.ArenaSnapshotDecoder();window.gameSocket=this;this.addEventListener('message',e=>{const m=decoder.read(e.data);if(!m)return;if(m.type==='welcome')window.evidence.id=m.playerId;if(m.type==='snapshot'){window.evidence.snap=m;window.evidence.kills+=m.events.length;}if(m.type==='life_over')window.evidence.life.push(m);});}send(data){const m=JSON.parse(data); if(m.type!=='hello'){window.evidence.inputs.push(m); if(window.evidence.inputs.length>100)window.evidence.inputs.shift();}return super.send(data);}}; window.addEventListener('error',e=>window.evidence.errors.push(String(e.message))); const err=console.error;console.error=(...args)=>{window.evidence.errors.push(args.map(String).join(' '));err(...args);};` }, sessionId);
  await call('Page.navigate', { url }, sessionId); return { session: sessionId, targetId, browserContextId };
}
async function joinPage(p: any, name: string, teamIndex: number) {
  await until(() => evaluate(p.session, `!!document.querySelector('#name')`));
  await evaluate(p.session, `document.querySelector('#name').focus()`); await call('Input.insertText', { text: name }, p.session);
  await evaluate(p.session, `document.querySelectorAll('.entry-teams button')[${teamIndex}].click()`);
  await until(() => evaluate(p.session, `!!window.evidence.snap`));
}
const ownExpr = `window.evidence.snap?.players.find(p=>p.id===window.evidence.id)`;
async function stats(session: string) { return evaluate(session, `({frame:{...document.querySelector('canvas').dataset},overflow:document.documentElement.scrollWidth>innerWidth,errors:window.evidence.errors,players:window.evidence.snap?.players.length,tick:window.evidence.snap?.tick,wave:window.evidence.snap?.wave,texts:window.evidence.texts,own:${ownExpr}})`); }
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
  const desktop = await page(1280, 720, origin + '/'), phone = await page(390, 844, origin + '/', true);
  await joinPage(desktop, 'Level Pilot', 0); await joinPage(phone, 'Level Friend', 1);
  const id = await evaluate(desktop.session, 'window.evidence.id'), friendId = await evaluate(phone.session, 'window.evidence.id');
  const connection = app.arenas.active.get(id)!, friendConnection = app.arenas.active.get(friendId)!;
  const room = connection.room!, p = room.state.players.get(id)!, q = room.state.players.get(friendId)!;
  assert.equal(room, friendConnection.room);
  // Keep the idle browser observers alive while bots use ordinary combat.
  p.immuneUntil = q.immuneUntil = 1e9;
  botAbort = new AbortController();
  botTask = runBots({ url: origin, count: 18, seconds: 60, policy: 'aimer' }, botAbort.signal); void botTask?.catch(() => {});
  await until(() => evaluate(desktop.session, 'window.evidence.snap?.players.length===20'));
  await key(desktop.session, 'KeyF', true); await key(desktop.session, 'KeyF', false);
  report.fullRoomFrames = [];
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true }, phone.session);
    for (let i = 0; i < 4; i++) {
      await pause(1000);
      const sample = { desktop: await stats(desktop.session), phone: await stats(phone.session), width, height };
      for (const client of [sample.desktop, sample.phone]) { assert.equal(client.players, 20); assert.deepEqual(client.errors, []); assert(!client.overflow); }
      report.fullRoomFrames.push(sample);
    }
    await shot(phone.session, `full-room-${width}x${height}`);
  }
  // Measure a developed swarm as well as the opening. Finish the ordinary bot
  // window before applying any clock/bug fixtures below.
  await pause(35000);
  for (let i = 0; i < 4; i++) {
    await pause(1000);
    report.fullRoomFrames.push({ desktop: await stats(desktop.session), phone: await stats(phone.session), width: 844, height: 390 });
  }
  await shot(desktop.session, 'full-room-f-timings');
  report.load = await botTask; botTask = undefined;
  assert.equal(report.load.joins, 18); assert.equal(report.load.errors, 0); assert(report.load.tick.p95Ms < 10);
  // Controlled fixture on the owned production server. Only presentation is
  // under test: advance arena/life timestamps without waiting for survival.
  const { lifeDefaults } = await import('../src/shared/arena/types');
  Object.assign(p, lifeDefaults(room.state.tick, p.life));
  room.state.tick = 73800; room.state.wave = 124;
  Object.assign(p, { startedTick: room.state.tick, x: 1200, y: 1200, spawnProtectedUntil: 0, immuneUntil: 1e9 });
  Object.assign(q, { x: 1800, y: 1800, immuneUntil: 1e9 });
  const quiet = setInterval(() => { room.state.bugs = []; room.state.shots = []; room.state.globs = []; }, 20);
  const capture = async (name: string, level: number, width: number, height: number, downed = false) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 1000 }, desktop.session);
    await until(() => evaluate(desktop.session, `window.evidence.texts.some(t=>t.includes('Lv ${level}')) && (${ownExpr})?.status===${JSON.stringify(downed ? 'downed' : 'active')}`));
    await pause(150);
    const state = await stats(desktop.session);
    assert(!state.overflow); assert.deepEqual(state.errors, []);
    assert(state.texts.some((text: string) => text.includes(`Lv ${level}`)));
    assert(!state.texts.some((text: string) => /W\d|[\u2013\u2014]/u.test(text)));
    if (downed) assert.equal(state.texts.filter((text: string) => text.startsWith('Downed') || text === 'can revive you.').join(' '), 'Downed. A teammate can revive you.');
    report.samples[name] = { width, height, fixture: true, ...state };
    await shot(desktop.session, name);
  };
  try {
    // At 390 px Chrome fits the short sentence on one line; 300 px also proves
    // the narrow two-line fallback with actual font measurements.
    for (const [width, height] of [[1280, 720], [844, 390], [390, 844], [300, 640]]) {
      for (const [age, level] of [[0, 1], [120, 3], [240, 4]]) {
        p.startedTick = room.state.tick - age! * 20;
        await capture(`level-${level}-${width}x${height}`, level!, width!, height!);
      }
      Object.assign(p, { status: 'downed', hits: 0, downedUntil: room.state.tick * 50 + 10000, reviveMs: 0, reviving: false });
      await capture(`downed-${width}x${height}`, 4, width!, height!, true);
      // Production simulation revives in contact and must preserve life age.
      const startedTick = p.startedTick;
      Object.assign(q, { x: p.x + 50, y: p.y });
      await until(() => p.status === 'active'); assert.equal(p.startedTick, startedTick);
      await capture(`revived-${width}x${height}`, 4, width!, height!);
      Object.assign(q, { x: 1800, y: 1800 });
      Object.assign(p, { status: 'downed', hits: 0, downedUntil: room.state.tick * 50, reviveMs: 0, reviving: false });
      await until(() => p.status === 'out'); await until(() => connection.result?.save === 'saved');
      await pause(150);
      await key(desktop.session, 'Space', true); await key(desktop.session, 'Space', false);
      await until(() => p.status === 'active');
      p.immuneUntil = 1e9;
      await capture(`respawn-${width}x${height}`, 1, width!, height!);
    }
    // Phone controls still support simultaneous move and aim/fire.
    await touch(phone.session, 'touchStart', [{ id: 1, x: 120, y: 270 }, { id: 2, x: 700, y: 270 }]);
    await touch(phone.session, 'touchMove', [{ id: 1, x: 165, y: 270 }, { id: 2, x: 760, y: 270 }]); await pause(200);
    report.twinTouch = await evaluate(phone.session, 'window.evidence.inputs.at(-1)');
    assert(report.twinTouch.fire && report.twinTouch.move.x > 0 && report.twinTouch.touch);
    await touch(phone.session, 'touchEnd', []);
  } finally { clearInterval(quiet); }
  // Intercept only this browser's board fetches to expose loading, failure and
  // successful zero states deterministically, without altering the server.
  const board = await page(1280, 720, 'about:blank');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.boardMode='loading';const fetchOriginal=fetch;window.fetch=(url,init)=>String(url).startsWith('/api/')?new Promise((resolve,reject)=>{const tick=()=>{if(window.boardMode==='loading')return setTimeout(tick,25);if(window.boardMode==='failed')return reject(new Error('Fixture offline'));resolve(Response.json(String(url).endsWith('/leaderboard')?[]:String(url).endsWith('/teams')?{tabs:0,spaces:0}:{totalPlayers:0,arenas:[]}));};tick();}):fetchOriginal(url,init);` }, board.session);
  await call('Page.navigate', { url: origin + '/board' }, board.session);
  const boardState = () => evaluate(board.session, `({title:document.title,teams:[...document.querySelectorAll('.board-team strong')].map(e=>e.textContent.trim()),activity:document.querySelector('.board-playing')?.textContent,status:document.querySelector('[role=status]')?.textContent})`);
  await until(async () => (await boardState()).activity === '… playing now');
  report.boardLoading = await boardState(); assert.deepEqual(report.boardLoading.teams, ['…', '…']); assert.equal(report.boardLoading.title, 'Bug Swarm: Stream Board'); await shot(board.session, 'board-loading');
  await evaluate(board.session, `window.boardMode='failed'`);
  await until(async () => Boolean((await boardState()).status));
  report.boardFailed = await boardState(); assert.deepEqual(report.boardFailed.teams, ['…', '…']); await shot(board.session, 'board-failed');
  await evaluate(board.session, `window.boardMode='zero'`);
  await until(async () => (await boardState()).activity === '0 playing now');
  report.boardZero = await boardState(); assert.deepEqual(report.boardZero.teams, ['0', '0']); await shot(board.session, 'board-zero');
  report.assertions.push('Production HUD at ages 0/120/240 in wave 124+, exact downed copy in both layouts, real revival keeps age, real respawn resets level, twin touch, board loading/failure/zero, full-room timings.');
  console.log(JSON.stringify({ browser: report.browser, load: report.load, assertions: report.assertions }));
} finally {
  botAbort?.abort(); await botTask?.catch(() => {});
  await Bun.write(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  await call('Browser.close').catch(() => {}); socket?.close();
  if (chrome.exitCode === null) chrome.kill(); await chrome.exited; await app.stop();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}
