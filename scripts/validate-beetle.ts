// Production Chrome evidence. Build first; CHROME_PATH may override installed Chrome.
// All browser profiles, databases, logs and screenshots stay in .evidence/83/.
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
const evidenceRoot = join(repo, '.evidence/83'); mkdirSync(evidenceRoot, { recursive: true });
const root = mkdtempSync(join(evidenceRoot, 'production-')), home = join(root, 'home'), temp = join(root, 'tmp');
for (const path of [home, temp, join(home, 'AppData/Local'), join(home, 'AppData/Roaming')]) mkdirSync(path, { recursive: true });
for (const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME']) process.env[key] = home;
process.env.APPDATA = join(home, 'AppData/Roaming'); process.env.LOCALAPPDATA = join(home, 'AppData/Local');
process.env.TEMP = process.env.TMP = temp; process.env.DATA_DIR = join(root, 'data');
const evidence = root; console.log(`Evidence: ${evidence}`);
const app = createServer({ port: 0, hostname: '127.0.0.1', dataDir: join(root, 'data'), env: { NODE_ENV: 'production' } });
const origin = app.server.url.origin, report: any = { origin, samples: {}, assertions: [] };
const chrome = Bun.spawn([chromePath,'--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(root,'profile').replaceAll('\\', '/')}`,'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','about:blank'], { stdout: 'ignore', stderr: Bun.file(join(root, 'chrome.log')), env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'CHROME_CRASHPAD_PIPE_NAME')) });
let loadApp: ReturnType<typeof createServer> | undefined;
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
window.evidence={snap:null,inputs:[],errors:[],kills:0,life:[],events:[]}; const Native=WebSocket; window.WebSocket=class extends Native {constructor(...args){super(...args);const decoder=new window.ArenaSnapshotDecoder();window.gameSocket=this;this.addEventListener('message',e=>{const m=decoder.read(e.data);if(!m)return;if(m.type==='welcome')window.evidence.id=m.playerId;if(m.type==='snapshot'){window.evidence.snap=m;window.evidence.kills+=m.events.length;for(const event of m.events)window.evidence.events.push({event,snapshot:m});if(window.evidence.events.length>100)window.evidence.events.splice(0,50);}if(m.type==='life_over')window.evidence.life.push(m);});}send(data){const m=JSON.parse(data); if(m.type!=='hello'){window.evidence.inputs.push(m); if(window.evidence.inputs.length>100)window.evidence.inputs.shift();}return super.send(data);}}; window.addEventListener('error',e=>window.evidence.errors.push(String(e.message))); const err=console.error;console.error=(...args)=>{window.evidence.errors.push(args.map(String).join(' '));err(...args);};` }, sessionId);
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
  // Windows can briefly lock this file while Chrome publishes its port.
  const port = await until(() => { try { const value = readFileSync(join(root, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0]; return value && /^\d+$/.test(value.trim()) ? value.trim() : false; } catch { return false; } }, 30000);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); report.browser = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket!.onopen = resolve; socket!.onerror = reject; });
  socket.onmessage = event => {
    const m = JSON.parse(String(event.data)), p = pending.get(m.id);
    if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  };

  report.gpu = (await call('SystemInfo.getInfo')).gpu;
  const desktop = await page(1280, 800, origin + '/'), phone = await page(390, 844, origin + '/', true);
  await joinPage(desktop, 'Flanker', 1); await joinPage(phone, 'Teammate', 0);
  botAbort = new AbortController();
  botTask = runBots({ url: origin, count: 18, seconds: 180, policy: 'aimer' }, botAbort.signal); void botTask?.catch(() => {});
  await until(() => evaluate(desktop.session, 'window.evidence.snap?.players.length===20'));
  await key(desktop.session, 'KeyF', true); await key(desktop.session, 'KeyF', false);
  await key(phone.session, 'KeyF', true); await key(phone.session, 'KeyF', false);
  const id = await evaluate(desktop.session, 'window.evidence.id'), friendId = await evaluate(phone.session, 'window.evidence.id');
  const room = app.arenas.active.get(id)!.room!, p = room.state.players.get(id)!, q = room.state.players.get(friendId)!;
  report.natural = { samples: [], beetle: null };
  console.log('Observing natural wave unlock with two browsers and 18 bots for 180 seconds');
  for (let i = 0; i < 180; i++) {
    await pause(1000);
    const beetle = room.state.bugs.find((b: any) => b.kind === 'beetle');
    if (beetle && !report.natural.beetle) { report.natural.beetle = { tick: room.state.tick, wave: room.state.wave, bug: structuredClone(beetle) }; console.log('Natural beetle', room.state.wave, room.state.tick); }
    if (i % 30 === 0) { const d = await stats(desktop.session), f = await stats(phone.session); report.natural.samples.push({ seconds: i + 1, desktop: d, portrait: f }); console.log('Natural play', i+1, 'seconds, wave', room.state.wave); }
  }
  report.natural.bots = await botTask; botTask = undefined;
  assert(report.natural.beetle, 'Must observe a natural wave-five beetle');
  assert(report.natural.beetle.wave >= 5); await shot(desktop.session, 'natural-full-room');
  // Finish the idle human lives through the normal respawn path before setup.
  for(const client of [desktop,phone]) {
    const own=await evaluate(client.session,ownExpr);
    if(own.status==='downed') await until(()=>evaluate(client.session,`(${ownExpr})?.status==='out'`),12000);
    if(own.status!=='active') {await key(client.session,'Space',true);await key(client.session,'Space',false);await until(()=>evaluate(client.session,`(${ownExpr})?.status==='active'`));}
  }
  // Owned in-process setup isolates the new mechanic. Real Chrome controls fire,
  // move and aim; ordinary simulation, snapshots and delayed drawing resolve it.
  const { createBug } = await import('../src/shared/arena/bugs/registry');
  for (const player of room.state.players.values()) Object.assign(player, { x: 2100, y: 2100, immuneUntil: room.state.tick * 50 + 60000 });
  for (const player of [p,q]) Object.assign(player, { status: 'active', hits: 3, downedUntil: 0, reviveMs: 0, heat: 0, overheatUntil: 0 });
  Object.assign(p, { x: 1200, y: 1200, streak: 4 }); Object.assign(q, { x: 1900, y: 1200 });
  room.state.bugs = []; room.state.shots = []; room.state.globs = [];
  const b = createBug('beetle', room.state.nextId++, 1320, 1200); b.facing = Math.PI; room.state.bugs = [b];
  await pause(200);
  const aimAt = async (bug: any) => {
    const self = await evaluate(desktop.session, ownExpr);
    // Desktop world view: 900 x 562.5, centred on this interior player.
    await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640 + (bug.x-self.x)*1280/900, y: 400 + (bug.y-self.y)*1280/900 }, desktop.session);
  };
  await aimAt(b); await key(desktop.session, 'Space', true);
  await until(() => evaluate(desktop.session, `window.evidence.events.some(e=>e.event.kind==='beetle'&&e.event.type==='bounce'&&e.snapshot.bugs.some(b=>b.id===${b.id}))`));
  await key(desktop.session, 'Space', false);
  report.bounce = await evaluate(desktop.session, `window.evidence.events.findLast(e=>e.event.kind==='beetle'&&e.event.type==='bounce')`);
  assert.equal(b.hp, 5); assert.equal(p.streak, 0);
  await pause(100); await shot(desktop.session, 'front-bounce');
  // Let the teammate keep the front while the shooter moves around it.
  Object.assign(q, { x: b.x - 70, y: b.y });
  await key(desktop.session, 'KeyS', true); await pause(950); await key(desktop.session, 'KeyS', false);
  await pause(100); const flankPosition = structuredClone(p); report.flankPosition = flankPosition;
  const previousScore = p.score, previousKills = p.kills;
  await aimAt({ x: b.x + b.vx * 0.12, y: b.y + b.vy * 0.12 }); await key(desktop.session, 'Space', true);
  const damaged = new Set<number>();
  await until(async () => {
    if (!room.state.bugs.some((bug: any) => bug.id === b.id)) return true;
    await aimAt({ x: b.x + b.vx * 0.12, y: b.y + b.vy * 0.12 });
    if (b.hp < 5 && !damaged.has(b.hp)) { damaged.add(b.hp); await pause(105); await shot(desktop.session, `shell-hp-${b.hp}`); }
    return false;
  }, 10000);
  await key(desktop.session, 'Space', false); await pause(120);
  report.flankKill = await evaluate(desktop.session, `window.evidence.events.findLast(e=>e.event.kind==='beetle'&&e.event.type==='kill')`);
  assert(report.flankKill); assert.equal(p.kills, previousKills+1); assert(p.score > previousScore);
  await shot(desktop.session, 'flank-kill');
  report.assertions.push('Natural wave-five beetle; controlled front bounce preserves five HP and resets streak; real movement to flank and authoritative lethal score/removal.');
  // Controlled HP gallery keeps all five crack states visible in one screenshot.
  room.state.shots=[]; room.state.bugs = Array.from({length:5},(_,i)=> {const bug=createBug('beetle',room.state.nextId++,p.x-130+i*65,p.y-100);bug.hp=5-i;bug.facing=Math.PI/2;return bug;});
  await pause(150); await shot(desktop.session, 'shell-damage-states');
  // Two independent touch points in both supported phone layouts.
  report.touch=[];
  for (const [width,height] of [[390,844],[844,390]] as const) {
    await call('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:true }, phone.session);
    const y = height-100;
    await touch(phone.session,'touchStart',[{id:1,x:70,y},{id:2,x:width-90,y}]);
    await touch(phone.session,'touchMove',[{id:1,x:115,y},{id:2,x:width-35,y}]); await pause(150);
    const input=await evaluate(phone.session,'window.evidence.inputs.at(-1)'); assert(input.fire && input.move.x>0 && input.touch);
    const state=await stats(phone.session); assert(!state.overflow); assert.deepEqual(state.errors,[]);
    report.touch.push({width,height,input,state}); await shot(phone.session,`touch-${width}x${height}`); await touch(phone.session,'touchEnd',[]);
  }
  for(const client of [desktop,phone]) { const s=await stats(client.session); assert.deepEqual(s.errors,[]); assert(!s.overflow); await call('Target.disposeBrowserContext',{browserContextId:client.browserContextId}); }
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

  await app.stop();
  loadApp = createServer({port:0,hostname:'127.0.0.1',dataDir:join(root,'load-data'),env:{NODE_ENV:'production'}});
  console.log('Production browser evidence passed; starting 200 bots for 240 seconds (complete post-unlock minute)');
  const loadOrigin=loadApp.server.url.origin;
  let naturalBeetles=0, allUnlockedAt: number | undefined;
  const sampler=setInterval(()=> {
    const rooms=[...loadApp!.arenas.rooms.values()];
    for(const room of rooms) naturalBeetles=Math.max(naturalBeetles,room.state.bugs.filter((b:any)=>b.kind==='beetle').length);
    if(allUnlockedAt===undefined && rooms.length===10 && rooms.every(room=>room.state.wave>=5)) allUnlockedAt=performance.now();
  },1000);
  try {
    report.load=await runBots({url:loadOrigin,count:200,seconds:240,policy:'aimer'});
    // Read the last complete minute from retained buckets, after wave five.
    report.postUnlock=loadApp.arenas.stats({sinceMs:report.load.untilMs-60000,untilMs:report.load.untilMs,raw:true});
    report.maxLiveBeetles=naturalBeetles; report.allUnlockedAt=allUnlockedAt;
    assert(allUnlockedAt!==undefined && allUnlockedAt<=report.load.untilMs-60000);
    assert(report.postUnlock.window.complete); assert(report.postUnlock.window.tick.p95Ms<10); assert(naturalBeetles>0 && naturalBeetles<=10);
    assert.equal(report.load.joins,200); assert.equal(report.load.errors,0); assert(report.load.tick.p95Ms<10);
    console.log(JSON.stringify({tick:report.load.tick,postUnlock:report.postUnlock.window.tick.p95Ms,maxLiveBeetles:naturalBeetles}));
  } catch(error) { report.loadFailure=(error as any).report; throw error; } finally {clearInterval(sampler);}
} finally {
  botAbort?.abort(); await botTask?.catch(() => {}); await vite?.close();
  await Bun.write(join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  if(socket) await call('Browser.close').catch(() => {}); socket?.close();
  if (chrome.exitCode === null) chrome.kill(); await chrome.exited; await app.stop(); await loadApp?.stop();
  process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
}
