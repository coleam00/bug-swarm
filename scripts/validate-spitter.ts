// Production Chrome evidence. Run after bun run build; all scratch files stay in this checkout.
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "../src/server/server";
import { runBots } from "./bots";
import { createBug } from "../src/shared/arena/bugs/registry";
const evidence = mkdtempSync(join((mkdirSync(".evidence/78", { recursive: true }), resolve(".evidence/78")), "chrome-"));
const home = join(evidence, "home"), temp = join(evidence, "tmp"), profile = join(evidence, "profile");
for (const path of [home, temp, profile, join(home,"AppData/Local"), join(home,"AppData/Roaming")]) mkdirSync(path, {recursive:true});
for (const key of ["HOME","USERPROFILE","XDG_CONFIG_HOME","XDG_CACHE_HOME"]) process.env[key] = home;
process.env.APPDATA = join(home,"AppData/Roaming"); process.env.LOCALAPPDATA = join(home,"AppData/Local"); process.env.TMP = process.env.TEMP = temp;
const chromePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
if (!chromePath) throw Error("Set CHROME_PATH to factory Chrome");
const app = createServer({port:0,hostname:"127.0.0.1",dataDir:join(evidence,"data"),env:{}}), origin=app.server.url.origin;
const chromeEnv={...process.env}; delete chromeEnv.CHROME_CRASHPAD_PIPE_NAME;
const chrome = Bun.spawn([chromePath,"--headless=new","--no-first-run","--no-default-browser-check","--disable-background-networking","--remote-debugging-port=0",`--user-data-dir=${profile.replaceAll("\\","/")}`,"--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","about:blank"], {env:chromeEnv,stdout:"ignore",stderr:Bun.file(join(evidence,"chrome.log"))});
const report:any={origin,bun:Bun.version,layouts:[],errors:[],scenes:[],frames:[]};
console.log("Evidence:", evidence);
let socket: WebSocket | undefined, botTask: Promise<any> | undefined, botAbort: AbortController | undefined;
let serial = 0; const pending = new Map<number, any>();
const pause = (ms: number) => Bun.sleep(ms);
async function until(fn: () => any, timeout = 10000) { const end = performance.now() + timeout; while (performance.now() < end) { const v = await fn(); if (v) return v; await pause(50); } throw new Error('Condition timed out'); }
function call(method: string, params: any = {}, sessionId?: string): Promise<any> { const id = ++serial; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 10000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
async function evaluate(session: string, expression: string) { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function shot(session: string, name: string) { const r = await call('Page.captureScreenshot', { format: 'png' }, session); writeFileSync(join(evidence, name + '.png'), Buffer.from(r.data, 'base64')); }
async function page(width: number, height: number, url: string, touch = false, setup = "") {
  const { browserContextId } = await call('Target.createBrowserContext'); const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Page.enable', {}, sessionId); await call('Runtime.enable', {}, sessionId);
  await call('Network.enable', {}, sessionId);
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: touch }, sessionId);
  if (touch) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }, sessionId);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `window.evidence={snap:null,inputs:[],errors:[],kills:0,life:[],pops:[]}; const Native=WebSocket; window.WebSocket=class extends Native {constructor(...args){super(...args);window.gameSocket=this;this.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.type==='welcome')window.evidence.id=m.playerId;if(m.type==='snapshot'){window.evidence.snap=m;window.evidence.kills+=m.events.length;if(m.events.some(e=>e.type==='glob-pop'))window.evidence.pops.push(m);}if(m.type==='life_over')window.evidence.life.push(m);});}send(data){const m=JSON.parse(data); if(m.type!=='hello'){window.evidence.inputs.push(m); if(window.evidence.inputs.length>100)window.evidence.inputs.shift();}return super.send(data);}}; window.addEventListener('error',e=>window.evidence.errors.push(String(e.message))); const err=console.error;console.error=(...args)=>{window.evidence.errors.push(args.map(String).join(' '));err(...args);};` }, sessionId);
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

async function dispose(p:any){ await call("Target.disposeBrowserContext",{browserContextId:p.browserContextId}); }

try {
  await until(()=>existsSync(join(profile,'DevToolsActivePort')),30000);
  const port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const version=await(await fetch(`http://127.0.0.1:${port}/json/version`)).json(); report.browser=version.Browser;
  socket=new WebSocket(version.webSocketDebuggerUrl); await new Promise((resolve,reject)=>{socket!.onopen=resolve;socket!.onerror=reject;});
  socket.onmessage=event=>{const m=JSON.parse(String(event.data));if(m.id){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}};
  const desktop=await page(1280,720,origin), phone=await page(390,844,origin,true);
  await joinPage(desktop,'AcidPilot',0); await joinPage(phone,'AcidScout',1);
  const id=await evaluate(desktop.session,'window.evidence.id'), second=await evaluate(phone.session,'window.evidence.id');
  const room=app.arenas.active.get(id)!.room!;
  botAbort=new AbortController(); botTask=runBots({url:origin,count:18,seconds:180,policy:'aimer'},botAbort.signal); void botTask.catch(()=>{});
  await until(()=>evaluate(desktop.session,'window.evidence.snap?.players.length===20'));
  await key(desktop.session,'KeyF',true); await key(desktop.session,'KeyF',false);
  // Exercise two independent touch pointers in both phone orientations.
  for(const [width,height] of [[390,844],[844,390]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},phone.session);
    const p=room.state.players.get(second)!;
    if(p.status==='out') app.arenas.message(app.arenas.active.get(second)!,JSON.stringify({v:1,type:'respawn',life:p.life,touch:true}));
    p.spawnProtectedUntil=room.state.tick*50+10000;
    const before={x:p.x,y:p.y};
    await touch(phone.session,'touchStart',[{id:1,x:width!*0.2,y:height!*0.6},{id:2,x:width!*0.8,y:height!*0.6}]);
    await touch(phone.session,'touchMove',[{id:1,x:width!*0.2+40,y:height!*0.6-20},{id:2,x:width!*0.8-40,y:height!*0.6-30}]);
    await pause(800);
    const state=await stats(phone.session); assert(Math.hypot(p.x-before.x,p.y-before.y)>20); assert(!state.overflow); assert(state.errors.length===0);
    const inputs=await evaluate(phone.session,'window.evidence.inputs'); assert(inputs.some((i:any)=>i.type==='input'&&i.fire&&Math.hypot(i.move.x,i.move.y)>0));
    report.layouts.push({width,height,before,after:{x:p.x,y:p.y},state,simultaneousMoveAndFire:true});
    await shot(phone.session,`${width}x${height}-twin-touch`); await touch(phone.session,'touchEnd',[]);
  }
  // No artificial wave unlock: wait for the production clock's wave four.
  let maxSpitters=0,maxGlobs=0;
  await until(async()=>{
    maxSpitters=Math.max(maxSpitters,room.state.bugs.filter(b=>b.kind==='spitter').length);maxGlobs=Math.max(maxGlobs,room.state.globs.length);
    return room.state.wave>=4&&maxSpitters>0&&maxGlobs>0;
  },115000);
  report.natural={tick:room.state.tick,wave:room.state.wave,maxSpitters,maxGlobs,players:room.state.players.size};
  writeFileSync(join(evidence,'natural-snapshot.json'),JSON.stringify(app.arenas.snapshot(room),null,2));
  await shot(desktop.session,'natural-wave-four');
  botAbort.abort();try{await botTask;}catch{}botTask=undefined;
  await until(()=>room.state.players.size===2);
  const pilot=room.state.players.get(id)!,scout=room.state.players.get(second)!;
  for(const p of [pilot,scout]){ if(p.status==='out') app.arenas.message(app.arenas.active.get(p.id)!,JSON.stringify({v:1,type:'respawn',life:p.life,touch:false}));Object.assign(p,{status:'active',hits:3,downedUntil:0,reviveMs:0,reviving:false,spawnProtectedUntil:room.state.tick*50+100000}); }
  Object.assign(pilot,{x:1200,y:1200});Object.assign(scout,{x:1500,y:1400});
  await pause(200);
  room.state.bugs=[];room.state.shots=[];room.state.globs=[];
  const bug=createBug('spitter',room.state.nextId++,850,1200,room.state.tick*50);Object.assign(bug,{phase:'swell',phaseUntil:room.state.tick*50+500});room.state.bugs=[bug];
  await pause(350);await shot(desktop.session,'controlled-swell');
  report.scenes.push({name:'swell',controlled:true,snapshot:await evaluate(desktop.session,'window.evidence.snap')});
  await until(()=>room.state.globs.length>0);await pause(230);await shot(desktop.session,'controlled-flight');
  const flight=await evaluate(desktop.session,'window.evidence.snap');assert(flight.globs.length>0); report.scenes.push({name:'flight',controlled:true,snapshot:flight});
  const g=room.state.globs[0]!,beforeScore=pilot.score;
  // One authoritative player projectile at a deterministic intercept. No shipped debug route.
  room.state.shots.push({id:room.state.nextId++,owner:id,life:pilot.life,x:g.x+24,y:g.y,vx:-900,vy:0,born:room.state.tick*50});
  await until(()=>pilot.score===beforeScore+5);await pause(180);await shot(desktop.session,'controlled-intercept');
  report.scenes.push({name:'intercept',controlled:true,beforeScore,afterScore:pilot.score,snapshot:await evaluate(desktop.session,'window.evidence.pops.at(-1)'),visible:await evaluate(desktop.session,'window.evidence.snap')});
  writeFileSync(join(evidence,'scenes.json'),JSON.stringify(report.scenes,null,2));
  // Full collection rendering fixture through an owned Vite server.
  const {createServer:createVite}=await import('vite');
  const vite=await createVite({configFile:false,cacheDir:join(evidence,'vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false}});await vite.listen();
  try{
    const address=vite.httpServer!.address() as {port:number};
    for(const [width,height] of [[1280,720],[390,844],[844,390]]){
      const p=await page(width!,height!,`http://127.0.0.1:${address.port}/scripts/arena-benchmark.html`,width!==1280);
      await until(()=>evaluate(p.session,`!!document.querySelector('canvas')?.dataset.frameMs`));const samples=[];for(let i=0;i<7;i++){await pause(1100);samples.push(await evaluate(p.session,`({frame:{...document.querySelector('canvas').dataset},errors:window.evidence.errors})`));}report.frames.push({width,height,samples});await shot(p.session,`${width}x${height}-full-arena`);await dispose(p);
    }
  }finally{await vite.close();}
  // Run CLI workload on the server owned above, with observed spitter activity.
  report.errors=[...await evaluate(desktop.session,'window.evidence.errors'),...await evaluate(phone.session,'window.evidence.errors')];assert.equal(report.errors.length,0);
  await dispose(desktop);await dispose(phone);await until(()=>app.arenas.rooms.size===0);
  const activity={maxSpitters:0,maxGlobs:0,swellSnapshots:0,globPops:0};
  const sample=setInterval(()=>{for(const r of app.arenas.rooms.values()){activity.maxSpitters=Math.max(activity.maxSpitters,r.state.bugs.filter(b=>b.kind==='spitter').length);activity.maxGlobs=Math.max(activity.maxGlobs,r.state.globs.length);activity.swellSnapshots+=r.state.bugs.filter(b=>b.phase==='swell').length;activity.globPops+=r.state.events.filter(e=>e.type==='glob-pop').length;}},50);
  try{
    const load=Bun.spawn([process.execPath,'run','bots','--','--url',origin,'--count','200','--seconds','120','--policy','aimer'],{env:process.env,stdout:Bun.file(join(evidence,'load.json')),stderr:Bun.file(join(evidence,'load-errors.log'))});
    assert.equal(await load.exited,0);report.load=JSON.parse(readFileSync(join(evidence,'load.json'),'utf8')); report.loadActivity=activity;
    assert(report.load.tick.p95Ms<10);assert(activity.maxSpitters>0&&activity.maxGlobs>0);
  }finally{clearInterval(sample);}
  console.log(JSON.stringify(report,null,2));
} finally {
  botAbort?.abort();if(botTask)try{await botTask;}catch{}
  if(socket?.readyState===WebSocket.OPEN)try{await call('Browser.close');}catch{}
  socket?.close();chrome.kill();await chrome.exited;await app.stop();
  writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2));
}
