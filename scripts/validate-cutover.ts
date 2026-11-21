// Production Chrome evidence. Run after bun run build; all scratch files stay in this checkout.
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "../src/server/server";
import { runBots } from "./bots";
import { hideName, startRun } from "../src/server/db";
const evidence = mkdtempSync(join((mkdirSync(".evidence/73", { recursive: true }), resolve(".evidence/73")), "chrome-"));
const home = join(evidence, "home"), temp = join(evidence, "tmp"), profile = join(evidence, "profile");
for (const path of [home, temp, profile, join(home,"AppData/Local"), join(home,"AppData/Roaming")]) mkdirSync(path, {recursive:true});
for (const key of ["HOME","USERPROFILE","XDG_CONFIG_HOME","XDG_CACHE_HOME"]) process.env[key] = home;
process.env.APPDATA = join(home,"AppData/Roaming"); process.env.LOCALAPPDATA = join(home,"AppData/Local"); process.env.TMP = process.env.TEMP = temp;
const chromePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
if (!chromePath) throw Error("Set CHROME_PATH to factory Chrome");
const app = createServer({port:0,hostname:"127.0.0.1",dataDir:join(evidence,"data"),env:{}}), origin=app.server.url.origin;
const chromeEnv={...process.env}; delete chromeEnv.CHROME_CRASHPAD_PIPE_NAME;
const chrome = Bun.spawn([chromePath,"--headless=new","--no-first-run","--no-default-browser-check","--disable-background-networking","--remote-debugging-port=0",`--user-data-dir=${profile.replaceAll("\\","/")}`,"--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","about:blank"], {env:chromeEnv,stdout:"ignore",stderr:Bun.file(join(evidence,"chrome.log"))});
const report:any={origin,bun:Bun.version,layouts:[],errors:[],legacyPosts:[]};
console.log("Evidence:", evidence);
let socket: WebSocket | undefined, botTask: Promise<any> | undefined, botAbort: AbortController | undefined;
let serial = 0; const pending = new Map<number, any>();
const pause = (ms: number) => Bun.sleep(ms);
async function until(fn: () => any, timeout = 10000) { const end = performance.now() + timeout; while (performance.now() < end) { const v = await fn(); if (v) return v; await pause(50); } throw new Error('Condition timed out'); }
function call(method: string, params: any = {}, sessionId?: string): Promise<any> { const id = ++serial; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 10000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
async function evaluate(session: string, expression: string) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function shot(session: string, name: string) { const r = await call('Page.captureScreenshot', { format: 'png' }, session); writeFileSync(join(evidence, name + '.png'), Buffer.from(r.data, 'base64')); }
const decoderBuild = await Bun.build({ entrypoints: [join(import.meta.dir, "browser-decoder.ts")], target: "browser", format: "iife" });
if (!decoderBuild.success) throw Error("Browser observer decoder build failed");
const decoderSource = await decoderBuild.outputs[0]!.text();
async function page(width: number, height: number, url: string, touch = false, setup = "") {
  const { browserContextId } = await call('Target.createBrowserContext'); const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId);
  await call('Network.enable', {}, sessionId);
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch }, sessionId);
  if (touch) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }, sessionId);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `${decoderSource}
window.evidence={snap:null,inputs:[],errors:[],kills:0,life:[]}; const Native=WebSocket; window.WebSocket=class extends Native {constructor(...args){super(...args);const decoder=new window.ArenaSnapshotDecoder();window.gameSocket=this;this.addEventListener('message',e=>{const m=decoder.read(e.data);if(!m)return;if(m.type==='welcome')window.evidence.id=m.playerId;if(m.type==='snapshot'){window.evidence.snap=m;window.evidence.kills+=m.events.length;}if(m.type==='life_over')window.evidence.life.push(m);});}send(data){const m=JSON.parse(data); if(m.type!=='hello'){window.evidence.inputs.push(m); if(window.evidence.inputs.length>100)window.evidence.inputs.shift();}return super.send(data);}}; window.addEventListener('error',e=>window.evidence.errors.push(String(e.message))); const err=console.error;console.error=(...args)=>{window.evidence.errors.push(args.map(String).join(' '));err(...args);};` }, sessionId);
  if (setup) await call('Page.addScriptToEvaluateOnNewDocument', { source: setup }, sessionId);
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
async function mouse(session: string, x: number, y: number, down?: boolean) { await call('Input.dispatchMouseEvent', { type: down === undefined ? 'mouseMoved' : down ? 'mousePressed' : 'mouseReleased', x, y, button: down === undefined ? 'none' : 'left', buttons: down ? 1 : 0, clickCount: down === undefined ? 0 : 1 }, session); }
async function touch(session: string, type: string, points: any[]) { await call('Input.dispatchTouchEvent', { type, touchPoints: points.map(p => ({ radiusX: 10, radiusY: 10, force: 1, ...p })) }, session); }

const requests: any[] = [];
async function dispose(p:any){ await call("Target.disposeBrowserContext",{browserContextId:p.browserContextId}); }
async function entry(p:any, label:string) {
  await until(()=>evaluate(p.session,`!!document.querySelector('.entry-form')`));
  const layout=await evaluate(p.session,`({overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,buttons:[...document.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,width:r.width,height:r.height}}),text:document.querySelector('main').innerText})`);
  assert(!layout.overflow, label+" entry overflow");
  for(const b of layout.buttons) assert(b.width>=44&&b.height>=44);
  await shot(p.session,label+"-entry"); return layout;
}
async function activate(p:any, name:string, touchMode:boolean) {
  await until(()=>evaluate(p.session,`!!document.querySelector('.entry-form')`));
  if(await evaluate(p.session,`!!document.querySelector('#name')`)){
    await evaluate(p.session,`document.querySelector('#name').focus()`); await call('Input.insertText',{text:name},p.session);
  }
  const r=await evaluate(p.session,`(()=>{const r=document.querySelector('button').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  if(touchMode){ await touch(p.session,'touchStart',[{id:1,...r}]);await touch(p.session,'touchEnd',[]); }
  else {await mouse(p.session,r.x,r.y,true);await mouse(p.session,r.x,r.y,false);}
  await until(()=>evaluate(p.session,`!!window.evidence.snap`));
}
try {
  await until(()=>existsSync(join(profile,'DevToolsActivePort')),30000);
  const port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json();report.browser=version.Browser;
  socket=new WebSocket(version.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket!.onopen=resolve;socket!.onerror=reject;});
  socket.onmessage=event=>{const m=JSON.parse(String(event.data));if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}
    if(m.method==='Network.requestWillBeSent'){const r=m.params.request;requests.push({url:r.url,method:r.method});if(r.method==='POST'&&new URL(r.url).pathname.startsWith('/api/runs'))report.legacyPosts.push(r);}};
  if (!process.argv.includes('--edges-only')) {
  // Each page uses an isolated Chrome browser storage context.
  const anchor=await page(1280,720,origin);await joinPage(anchor,'AnchorPilot',1);
  botAbort=new AbortController();botTask=runBots({url:origin,count:18,seconds:180,policy:'aimer'},botAbort.signal);void botTask.catch(()=>{});
  await until(()=>evaluate(anchor.session,'window.evidence.snap?.players.length===19'));
  let index=0;
  for(const [width,height] of [[1280,720],[844,390],[390,844]])for(const touchMode of [false,true]){
    const label=`${width}x${height}-${touchMode?'touch':'desktop'}`;
    const start=performance.now(),p=await page(width!,height!,origin,touchMode);
    await call('Network.enable',{},p.session);
    const first=await entry(p,label+'-first');
    await activate(p,'Pilot'+index++,touchMode);
    const firstMs=performance.now()-start;
    await until(()=>evaluate(p.session,'window.evidence.snap?.players.length===20'));
    assert(await evaluate(p.session,`!!document.querySelector('.arena-hint')`));
    const hint=await evaluate(p.session,`document.querySelector('.arena-hint').innerText`);
    assert(hint.includes(touchMode?'Left thumb':'WASD'));
    await shot(p.session,label+'-first-play-hint');
    if(index===1){await pause(6300);assert(!await evaluate(p.session,`!!document.querySelector('.arena-hint')`));await shot(p.session,label+'-timeout');}
    const before=await evaluate(p.session,ownExpr);
    if(touchMode){
      await touch(p.session,'touchStart',[{id:1,x:width!*0.2,y:height!*0.65},{id:2,x:width!*0.8,y:height!*0.65}]);
      await touch(p.session,'touchMove',[{id:1,x:width!*0.2+40,y:height!*0.65-20},{id:2,x:width!*0.8-40,y:height!*0.65-30}]);
    }else{await key(p.session,'KeyD',true);await mouse(p.session,width!*0.7,height!*0.5,true);}
    await pause(800);
    const input=await evaluate(p.session,'window.evidence.inputs.at(-1)');assert(input.fire&&Math.hypot(input.move.x,input.move.y)>0);assert.equal(input.touch,touchMode);
    const after=await evaluate(p.session,ownExpr);assert(Math.hypot(after.x-before.x,after.y-before.y)>10);assert.equal(after.spawnProtectedUntil,0);
    assert(!await evaluate(p.session,`!!document.querySelector('.arena-hint')`));
    await shot(p.session,label+'-controls-shot-dismissed');
    if(touchMode)await touch(p.session,'touchEnd',[]);else{await key(p.session,'KeyD',false);await mouse(p.session,100,100,false);}
    await key(p.session,'KeyF',true);await key(p.session,'KeyF',false);await pause(1200);
    const sample=await stats(p.session);assert(!sample.overflow);assert(sample.own.hits>0);
    assert(Number(sample.frame.fps)>=58 && Number(sample.frame.frameMs)<1000/60);
    await shot(p.session,label+'-full-room-F');
    await call('Page.reload',{},p.session);
    const returning=await entry(p,label+'-return');assert.equal(returning.buttons.length,1);assert.equal(returning.buttons[0].text,'Play');
    const returnStart=performance.now();await activate(p,'',touchMode);const returnMs=performance.now()-returnStart;
    assert(!await evaluate(p.session,`!!document.querySelector('.arena-hint')`));
    await shot(p.session,label+'-return-play');
    const end=await stats(p.session);assert(!end.overflow);report.layouts.push({label,firstMs,returnMs,first,returning,hint,input,sample,end});
    report.errors.push(...end.errors);await dispose(p);console.log(label,'passed');
  }
  // Real death, server save, results and replay at the new root.
  const lifePage=await page(844,390,origin);await activate(lifePage,'LifePilot',false);
  await until(()=>evaluate(lifePage.session,`!!document.querySelector('.arena-life')`),60000);
  await until(()=>evaluate(lifePage.session,`document.querySelector('.arena-life [role=status]')?.textContent==='Score saved'`));
  await shot(lifePage.session,'life-over-saved');
  report.life=await evaluate(lifePage.session,'window.evidence.life');
  await key(lifePage.session,'Space',true);await key(lifePage.session,'Space',false);
  await until(()=>evaluate(lifePage.session,`(${ownExpr})?.life>1&&(${ownExpr})?.hits>0`));
  assert(!await evaluate(lifePage.session,`!!document.querySelector('.arena-hint')`));await shot(lifePage.session,'respawn-no-hint');await dispose(lifePage);
  await dispose(anchor);report.fullRoomTick=app.arenas.stats().tick;botAbort.abort();await botTask.catch(()=>{});botTask=undefined;
  const board=await page(1280,720,origin+'/board');await until(()=>evaluate(board.session,`!!document.querySelector('.stream-board')`));await pause(1000);await shot(board.session,'board');await dispose(board);
  for(const path of ['/arena','/arena/']){const r=await fetch(origin+path+'?stream=1',{redirect:'manual'});assert.equal(r.status,307);assert.equal(r.headers.get('location'),'/?stream=1');}
  // A module fixture exercises all collection bounds without depending on live spawn age.
  const bundle=await Bun.build({entrypoints:['scripts/arena-benchmark.ts'],target:'browser'});assert(bundle.success);
  const fixture=join(evidence,'benchmark.js');await Bun.write(fixture,await bundle.outputs[0]!.text());
  // Same owned production server serves fixture bytes through a dedicated CDP response.
  const bench=await page(1280,720,origin);await call('Page.setDocumentContent',{frameId:(await call('Page.getFrameTree',{},bench.session)).frameTree.frame.id,html:'<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>'},bench.session);
  await evaluate(bench.session,await bundle.outputs[0]!.text());await pause(4000);report.bound=await evaluate(bench.session,`({...document.querySelector('canvas').dataset})`);await shot(bench.session,'renderer-bound');await dispose(bench);
  if(!process.argv.includes('--skip-capacity')){console.log('Running 200 bots for 120 seconds');report.capacity=await runBots({url:origin,count:200,seconds:120,policy:'aimer'});assert(report.capacity.errors===0);assert(report.capacity.tick.p95Ms<10);}
  assert.equal(report.legacyPosts.length,0);assert.equal(report.errors.length,0);
  console.log(JSON.stringify({browser:report.browser,layouts:report.layouts.length,bound:report.bound,capacity:report.capacity},null,2));
  }
  // Authoritative entry failures, team recovery and unavailable browser storage.
  hideName(app.db, 'MutedPilot', Date.now());
  const rejected=await page(390,844,origin);
  await until(()=>evaluate(rejected.session,`!!document.querySelector('#name')`));
  await evaluate(rejected.session,`document.querySelector('#name').focus()`);await call('Input.insertText',{text:'MutedPilot'},rejected.session);
  await evaluate(rejected.session,`document.querySelector('button').click()`);
  await until(()=>evaluate(rejected.session,`!!document.querySelector('[role=alert]')`));
  assert.equal(await evaluate(rejected.session,`document.querySelector('#name').value`),'MutedPilot');
  assert.equal(await evaluate(rejected.session,`localStorage.getItem('bug-swarm-player')`),null);
  await shot(rejected.session,'rejected-editable-name');await dispose(rejected);
  const correctedId=crypto.randomUUID(), stored={playerId:correctedId,name:'TeamPilot',team:'tabs'};
  const run=startRun(app.db,correctedId,'TeamPilot',Date.now(),'spaces');assert(!('error' in run));
  const setup=`localStorage.setItem('bug-swarm-player',${JSON.stringify(JSON.stringify(stored))});`;
  const corrected=await page(844,390,origin,false,setup);await activate(corrected,'',false);
  assert.equal(await evaluate(corrected.session,`JSON.parse(localStorage.getItem('bug-swarm-player')).team`),'spaces');
  await shot(corrected.session,'authoritative-team-restored');
  const duplicate=await page(844,390,origin,false,setup);
  await until(()=>evaluate(duplicate.session,`!!document.querySelector('button')`));await evaluate(duplicate.session,`document.querySelector('button').click()`);
  await until(()=>evaluate(duplicate.session,`!!document.querySelector('[role=alert]')`));
  assert.equal(await evaluate(duplicate.session,`document.querySelectorAll('button').length`),1);
  await shot(duplicate.session,'returning-duplicate-error');await dispose(duplicate);await dispose(corrected);
  const blocked=await page(390,844,origin,false,`Object.defineProperty(window,'localStorage',{get(){throw Error('Validation blocked storage');}});`);
  await activate(blocked,'MemoryPilot',false);assert(await evaluate(blocked.session,`!!document.querySelector('.arena-game')`));
  await shot(blocked.session,'storage-unavailable-playing');report.storageErrors=await evaluate(blocked.session,'window.evidence.errors');await dispose(blocked);
  report.entryEdges='passed';assert.equal(report.legacyPosts.length,0);
  console.log('Entry edge cases passed');
} finally {
  botAbort?.abort();if(botTask)await botTask.catch(error=>{report.botError=String(error);});
  await Bun.write(join(evidence,'report.json'),JSON.stringify(report,null,2));await Bun.write(join(evidence,'requests.json'),JSON.stringify(requests,null,2));
  if(socket?.readyState===WebSocket.OPEN){await call('Browser.close').catch(()=>{});socket.close();}
  if(chrome.exitCode===null)chrome.kill();await chrome.exited;
  await app.stop();
}
