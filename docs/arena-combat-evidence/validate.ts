// Reproduce the production Chrome and load evidence. Requires bun run build and CHROME_PATH.
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const repo = process.cwd();
const chromePath = process.env.CHROME_PATH;
if (!chromePath || !existsSync(chromePath)) throw new Error("Set CHROME_PATH to a Chrome/Chromium executable, then run from the repository root.");
const { createServer } = await import(pathToFileURL(join(repo, 'src/server/server.ts')).href);
const { runBots } = await import(pathToFileURL(join(repo, 'scripts/bots.ts')).href);
const root = mkdtempSync(join(tmpdir(), 'arena-combat-browser-')), home = join(root, 'home'); mkdirSync(home);
for (const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME']) process.env[key] = home;
const evidence = join(repo, 'docs/arena-combat-evidence'); mkdirSync(evidence, { recursive: true });
const app = createServer({ port: 0, hostname: '127.0.0.1', dataDir: join(root, 'data'), env: { NODE_ENV: 'production' } });
const origin = app.server.url.origin, report: any = { origin, errors: [], samples: {} };
const chrome = Bun.spawn([chromePath,'--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${join(root,'profile')}`,'--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'], { stdout: 'ignore', stderr: 'inherit', env: process.env });
let loadChild: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = false;
const interrupt = () => { interrupted = true; botAbort?.abort(); if (loadChild?.exitCode === null) loadChild.kill(); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
let socket: WebSocket | undefined, vite: any, botTask: Promise<any> | undefined, botAbort: AbortController | undefined;
let serial = 0; const pending = new Map<number, any>();
const pause = (ms: number) => Bun.sleep(ms);
async function until(fn: () => any, timeout = 10000) { const end = performance.now() + timeout; while (performance.now() < end) { if (interrupted) throw new Error("Validation interrupted"); const v = await fn(); if (v) return v; await pause(50); } throw new Error('Condition timed out'); }
function call(method: string, params: any = {}, sessionId?: string): Promise<any> { const id = ++serial; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 10000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
async function evaluate(session: string, expression: string) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function shot(session: string, name: string) { const r = await call('Page.captureScreenshot', { format: 'png' }, session); writeFileSync(join(evidence, name + '.png'), Buffer.from(r.data, 'base64')); }
async function page(width: number, height: number, url: string, touch = false) {
  const { browserContextId } = await call('Target.createBrowserContext'); const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId);
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch }, sessionId);
  if (touch) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }, sessionId);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.evidence={snap:null,inputs:[],errors:[],kills:0,life:[]}; const Native=WebSocket; window.WebSocket=class extends Native {constructor(...args){super(...args);window.gameSocket=this;this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='welcome')window.evidence.id=m.playerId;if(m.type==='snapshot'){window.evidence.snap=m;window.evidence.kills+=m.events.length;}if(m.type==='life_over')window.evidence.life.push(m);});}send(data){const m=JSON.parse(data); if(m.type!=='hello'){window.evidence.inputs.push(m); if(window.evidence.inputs.length>100)window.evidence.inputs.shift();}return super.send(data);}}; window.addEventListener('error',e=>window.evidence.errors.push(String(e.message))); const err=console.error;console.error=(...args)=>{window.evidence.errors.push(args.map(String).join(' '));err(...args);};` }, sessionId);
  await call('Page.navigate', { url }, sessionId); return { session: sessionId, targetId, browserContextId };
}
async function joinPage(p: any, name: string, teamIndex: number) {
  await until(() => evaluate(p.session, `!!document.querySelector('#arena-name')`));
  await evaluate(p.session, `document.querySelector('#arena-name').focus()`); await call('Input.insertText', { text: name }, p.session);
  await evaluate(p.session, `document.querySelectorAll('.arena-teams button')[${teamIndex}].click()`);
  await until(() => evaluate(p.session, `!!window.evidence.snap`));
}
const ownExpr = `window.evidence.snap?.players.find(p=>p.id===window.evidence.id)`;
async function stats(session: string) { return evaluate(session, `({frame:{...document.querySelector('canvas').dataset},overflow:document.documentElement.scrollWidth>innerWidth,errors:window.evidence.errors,players:window.evidence.snap?.players.length,own:${ownExpr}})`); }
async function key(session: string, code: string, down: boolean) { await call('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: code === 'Space' ? ' ' : code.replace('Key',''), windowsVirtualKeyCode: code === 'Space' ? 32 : code.replace('Key','').charCodeAt(0) }, session); }
async function mouse(session: string, x: number, y: number, down?: boolean) { await call('Input.dispatchMouseEvent', { type: down === undefined ? 'mouseMoved' : down ? 'mousePressed' : 'mouseReleased', x, y, button: down === undefined ? 'none' : 'left', buttons: down ? 1 : 0, clickCount: down === undefined ? 0 : 1 }, session); }
async function touch(session: string, type: string, points: any[]) { await call('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ radiusX: 10, radiusY: 10, force: 1, ...p })) }, session); }
try {
  console.log('Waiting for Chrome', root, chrome.pid); await until(() => existsSync(join(root,'profile','DevToolsActivePort')), 30000); console.log('Chrome ready');
  const port = readFileSync(join(root,'profile','DevToolsActivePort'),'utf8').split('\n')[0];
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); report.browser = version.Browser;
  socket = new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve,reject) => { socket!.onopen=resolve;socket!.onerror=reject; });
  socket.onmessage = event => { const m = JSON.parse(String(event.data)); if (m.id) { const p = pending.get(m.id); if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } } };
  const desktop = await page(1280,800, origin+'/arena'), phone = await page(390,844, origin+'/arena', true);
  console.log('Pages created'); await joinPage(desktop,'Pilot-A',0); console.log('Desktop joined'); await joinPage(phone,'Pilot-B',1); console.log('Phone joined');
  botAbort = new AbortController(); botTask = runBots({ url: origin, count: 10, seconds: 40, policy: 'aimer' }, botAbort.signal); void botTask.catch(() => {});
  await until(() => evaluate(desktop.session, `window.evidence.snap?.players.length===12`)); console.log('Two clients plus ten bots joined');
  await touch(phone.session,'touchStart',[{id:1,x:70,y:600},{id:2,x:310,y:600}]);
  const phoneOwn=await evaluate(phone.session,ownExpr); await touch(phone.session,'touchMove',[{id:1,x:phoneOwn.x>1200?25:115,y:phoneOwn.y>1200?570:630},{id:2,x:265,y:555}]); await pause(800);
  const twin = await evaluate(phone.session, 'window.evidence.inputs.at(-1)'); assert(twin.fire && Math.hypot(twin.move.x,twin.move.y)>0 && twin.touch); report.twinInput=twin;
  await shot(phone.session,'portrait-twin-sticks'); await touch(phone.session,'touchEnd',[]);
  report.samples.portrait = await stats(phone.session); assert(!report.samples.portrait.overflow);assert(report.samples.portrait.own.hits>0);
  await call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true},phone.session); await pause(1200);
  await touch(phone.session,'touchStart',[{id:1,x:120,y:270},{id:2,x:700,y:270}]); await touch(phone.session,'touchMove',[{id:1,x:160,y:250},{id:2,x:740,y:240}]); await pause(600); await shot(phone.session,'landscape-twin-sticks'); await touch(phone.session,'touchEnd',[]);
  report.samples.landscape = await stats(phone.session); assert(!report.samples.landscape.overflow);assert(report.samples.landscape.own.hits>0);
  await mouse(desktop.session, 900,350,true); await key(desktop.session,'KeyD',true); await pause(700); await key(desktop.session,'KeyD',false);
  await shot(desktop.session,'desktop-aim-shots');
  // Aim with actual mouse events at observed bugs, preserving server authority.
  let capturedKill = false; for (let i=0;i<200;i++) {
    const target = await evaluate(desktop.session, `(()=>{const p=${ownExpr},s=window.evidence.snap;if(!p?.hits)return null;const b=s.bugs.toSorted((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(!b)return null;const t=Math.hypot(b.x-p.x,b.y-p.y)/900;return {x:b.x+b.vx*t-Math.max(0,Math.min(1120,p.x-640)),y:b.y+b.vy*t-Math.max(0,Math.min(1600,p.y-400))};})()`);
    if(target) await mouse(desktop.session,target.x,target.y);
    const killed = await evaluate(desktop.session, `(()=>{const p=${ownExpr};const cx=Math.max(0,Math.min(1120,p.x-640)),cy=Math.max(0,Math.min(1600,p.y-400));return window.evidence.snap.events.some(e=>e.x>cx+20&&e.x<cx+1260&&e.y>cy+80&&e.y<cy+780)})()`); if(killed) { await shot(desktop.session,'kill-burst'); capturedKill = true; break; } await pause(80);
  }
  assert(capturedKill, 'A visible live kill burst must be captured'); await until(() => evaluate(desktop.session, `(()=>{const p=${ownExpr};return p?.hits&&p.overheatUntil>window.evidence.snap.tick*50;})()`),8000); await shot(desktop.session,'overheat'); await mouse(desktop.session,900,350,false);
  // Remain still without firing until the simulation ends this life.
  let held=new Set<string>(); for(let i=0;i<400;i++){if(await evaluate(desktop.session,`!!document.querySelector('.arena-life')`))break;const next=await evaluate(desktop.session,`(()=>{const p=${ownExpr},b=window.evidence.snap.bugs.toSorted((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(!b)return [];return [b.x>p.x?'KeyD':'KeyA',b.y>p.y?'KeyS':'KeyW'];})()`); const wanted=new Set<string>(next);for(const code of held)if(!wanted.has(code))await key(desktop.session,code,false);for(const code of wanted)if(!held.has(code))await key(desktop.session,code,true);held=wanted;await pause(100);}for(const code of held)await key(desktop.session,code,false);await until(()=>evaluate(desktop.session,`!!document.querySelector('.arena-life')`));
  report.respawnButton=await evaluate(desktop.session,`(()=>{const r=document.querySelector('.arena-life button').getBoundingClientRect();return {width:r.width,height:r.height}})()`);assert(report.respawnButton.width>=44&&report.respawnButton.height>=44); await shot(desktop.session,'life-over'); report.life = await evaluate(desktop.session,'window.evidence.life');
  await key(desktop.session,'Space',true); await key(desktop.session,'Space',false);
  await until(() => evaluate(desktop.session, `(${ownExpr})?.life>1&&(${ownExpr})?.hits>0`)); await shot(desktop.session,'respawn');
  report.tenBots = await botTask; botTask=undefined; console.log('Combat screenshots and touch passed');
  botAbort = new AbortController(); botTask = runBots({url:origin,count:18,seconds:18,policy:'aimer'},botAbort.signal); void botTask.catch(()=>{});
  await until(()=>evaluate(desktop.session,'window.evidence.snap?.players.length===20'));
  for(const p of [desktop,phone]){if(await evaluate(p.session,`!!document.querySelector('.arena-life')`)){await key(p.session,'Space',true);await key(p.session,'Space',false);}} await pause(1000); await shot(desktop.session,'full-room-desktop'); await shot(phone.session,'full-room-phone'); const frames=[]; for(let i=0;i<7;i++){await pause(1000); frames.push({desktop:await stats(desktop.session),phone:await stats(phone.session)});} report.fullRoomFrames=frames;
  report.fullRoomBots=await botTask;botTask=undefined;
  const legacy=await page(1280,800,origin+'/'); await until(()=>evaluate(legacy.session,`!!document.querySelector('input')`));
  await evaluate(legacy.session,`document.querySelector('input').focus()`); await call('Input.insertText',{text:'LegacyPilot'},legacy.session);
  report.legacyButtons=await evaluate(legacy.session,`Array.from(document.querySelectorAll('button')).map(b=>b.textContent)`);
  await evaluate(legacy.session,`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Tabs'))?.click()`); await pause(1500); await shot(legacy.session,'release-1');
  report.legacy=await evaluate(legacy.session,`({canvas:!!document.querySelector('canvas'),errors:window.evidence.errors})`); assert(report.legacy.canvas);assert.deepEqual(report.legacy.errors,[]);for(const sample of report.fullRoomFrames)for(const client of [sample.desktop,sample.phone]){assert.equal(client.players,20);assert.deepEqual(client.errors,[]);}
  for(const p of [desktop,phone,legacy]) await call('Target.disposeBrowserContext',{browserContextId:p.browserContextId});
  // Vite exposes only the developer renderer fixture; production play above used built assets.
  const {createServer:createVite} = await import(pathToFileURL(join(repo,'node_modules/vite/dist/node/index.js')).href);
  vite=await createVite({configFile: false,root:repo,server:{host:'127.0.0.1',port:0}});await vite.listen();
  const fixture=await page(1280,800,`http://127.0.0.1:${vite.httpServer.address().port}/scripts/arena-benchmark.html`);
  await until(()=>evaluate(fixture.session,`!!document.querySelector('canvas')?.dataset.fps`));
  report.fixture=[];for(let i=0;i<7;i++){await pause(1000);report.fixture.push(await until(()=>evaluate(fixture.session,`document.querySelector('canvas')?.dataset.fps?({...document.querySelector('canvas').dataset}):null`)));}await shot(fixture.session,'renderer-bounds');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},fixture.session);report.fixturePortrait=[];for(let i=0;i<7;i++){await pause(1000);report.fixturePortrait.push(await evaluate(fixture.session,`({...document.querySelector('canvas').dataset})`));}
  await call('Target.disposeBrowserContext',{browserContextId:fixture.browserContextId});await vite.close();vite=undefined;
  console.log('Full room and bounded-renderer frames recorded; starting 200 bots for 120s');
  if (interrupted) throw new Error('Validation interrupted'); loadChild=Bun.spawn([process.execPath,'run','bots','--','--url',origin,'--count','200','--seconds','120','--policy','aimer'],{cwd:repo,env:process.env,stdout:'pipe',stderr:'inherit'});const loadText=await new Response(loadChild.stdout).text();assert.equal(await loadChild.exited,0,loadText);report.load=JSON.parse(loadText);assert(report.load.tick.p95Ms<10);
  app.arenas.stop(); report.persistence=app.db.query("SELECT COUNT(*) AS lives, SUM(ended_at_ms IS NOT NULL) AS finished FROM runs WHERE mode='arena'").get(); assert.equal(report.persistence.lives,report.persistence.finished); writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  if (loadChild?.exitCode === null) { loadChild.kill(); await loadChild.exited; }
  botAbort?.abort();if(botTask)await botTask.catch(()=>{});if(vite)await vite.close();
  if(socket?.readyState===WebSocket.OPEN) {await call('Browser.close').catch(()=>{});socket.close();}
  if(chrome.exitCode===null)chrome.kill();await chrome.exited;await app.stop();
  writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2));
  rmSync(root,{recursive:true,force:true});
}
