// Production Chrome evidence. Run after bun run build; all scratch files stay in this checkout.
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "../src/server/server";
import { spawnHive } from "../src/shared/arena/bugs/hive";
const evidence = mkdtempSync(join((mkdirSync(".evidence/91", { recursive: true }), resolve(".evidence/91")), "chrome-"));
const home = join(evidence, "home"), temp = join(evidence, "tmp"), profile = join(evidence, "profile");
for (const path of [home, temp, profile, join(home,"AppData/Local"), join(home,"AppData/Roaming")]) mkdirSync(path, {recursive:true});
const chromePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
if (!chromePath) throw Error("Set CHROME_PATH to factory Chrome");
const app = createServer({port:0,hostname:"127.0.0.1",dataDir:join(evidence,"data"),env:{}}), origin=app.server.url.origin;
const chromeEnv: NodeJS.ProcessEnv={...process.env, HOME:home, USERPROFILE:home, XDG_CONFIG_HOME:home, XDG_CACHE_HOME:join(evidence,"cache"), APPDATA:join(home,"AppData/Roaming"), LOCALAPPDATA:join(home,"AppData/Local"), TMP:temp, TEMP:temp}; delete chromeEnv.CHROME_CRASHPAD_PIPE_NAME;
const chrome = Bun.spawn([chromePath,"--headless=new","--no-first-run","--no-default-browser-check","--disable-background-networking","--remote-debugging-port=0",`--user-data-dir=${profile.replaceAll("\\","/")}`,"--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","about:blank"], {env:chromeEnv,stdout:"ignore",stderr:Bun.file(join(evidence,"chrome.log"))});

const report:any={origin,bun:Bun.version,layouts:[],errors:[],scenes:[],frames:[]};
console.log("Evidence:", evidence);
let socket: WebSocket | undefined;
let serial = 0; const pending = new Map<number, any>();
const pause = (ms: number) => Bun.sleep(ms);
async function until(fn: () => any, timeout = 10000) { const end = performance.now() + timeout; while (performance.now() < end) { const v = await fn(); if (v) return v; await pause(50); } throw new Error('Condition timed out'); }
function call(method: string, params: any = {}, sessionId?: string): Promise<any> { const id = ++serial; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, method === 'Page.navigate' ? 30000 : 10000); pending.set(id, { resolve, reject, timer }); socket!.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
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
window.paintTexts=[];const fill=CanvasRenderingContext2D.prototype.fillText,rect=CanvasRenderingContext2D.prototype.fillRect;CanvasRenderingContext2D.prototype.fillRect=function(x,y,w,h){if(this.canvas===document.querySelector('canvas')&&x===0&&y===0&&w===innerWidth&&h===innerHeight)window.paintTexts=[];return rect.apply(this,arguments);};CanvasRenderingContext2D.prototype.fillText=function(t){if(this.canvas===document.querySelector('canvas'))window.paintTexts.push(String(t));return fill.apply(this,arguments);};
window.evidence={snap:null,inputs:[],errors:[],kills:0,life:[],pops:[],hiveKills:[]}; const Native=WebSocket; window.WebSocket=class extends Native {constructor(...args){super(...args);if(new URL(args[0],location.href).pathname!=='/ws')return;const decoder=new window.ArenaSnapshotDecoder();window.gameSocket=this;this.addEventListener('message',e=>{const m=decoder.read(e.data);if(!m)return;if(m.type==='welcome')window.evidence.id=m.playerId;if(m.type==='snapshot'){window.evidence.snap=m;window.evidence.kills+=m.events.length;if(m.events.some(e=>e.type==='glob-pop'))window.evidence.pops.push(m);if(m.events.some(e=>e.type==='kill'&&e.kind==='hive'))window.evidence.hiveKills.push(m);}if(m.type==='life_over')window.evidence.life.push(m);});}send(data){if(this!==window.gameSocket)return super.send(data);const m=JSON.parse(data); if(m.type!=='hello'){window.evidence.inputs.push(m); if(window.evidence.inputs.length>100)window.evidence.inputs.shift();}return super.send(data);}}; window.addEventListener('error',e=>window.evidence.errors.push(String(e.message))); const err=console.error;console.error=(...args)=>{window.evidence.errors.push(args.map(String).join(' '));err(...args);};` }, sessionId);
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
  if (!process.argv.includes("--fixtures-only")) {
  const desktop=await page(1280,720,origin), phone=await page(390,844,origin,true);
  await joinPage(desktop,'EdgePilot',0); await joinPage(phone,'EdgeScout',1);
  const id=await evaluate(desktop.session,'window.evidence.id'), second=await evaluate(phone.session,'window.evidence.id');
  const room=app.arenas.active.get(id)!.room!;
  assert.equal(app.arenas.active.get(second)!.room,room);
  await key(desktop.session,'KeyF',true); await key(desktop.session,'KeyF',false);
  await key(phone.session,'KeyF',true); await key(phone.session,'KeyF',false);
  await pause(2000); // Let both browser clients finish startup before the measured window.
  // Natural 60-second CLI workload, two isolated human identities and eighteen bots.
  const load=Bun.spawn([process.execPath,'run','bots','--','--url',origin,'--count','18','--seconds','60','--policy','aimer'],{env:process.env,stdout:Bun.file(join(evidence,'bots.json')),stderr:Bun.file(join(evidence,'bots-errors.log'))});
  try {
    await until(()=>room.state.players.size===20);
    for(const [width,height] of [[390,844],[844,390]]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},phone.session);
      const p=room.state.players.get(second)!;
      const before={x:p.x,y:p.y};
      await touch(phone.session,'touchStart',[{id:1,x:width!*0.2,y:height!*0.6},{id:2,x:width!*0.8,y:height!*0.6}]);
      await touch(phone.session,'touchMove',[{id:1,x:width!*0.2+40,y:height!*0.6-20},{id:2,x:width!*0.8-40,y:height!*0.6-30}]);
      await pause(700);
      const state=await stats(phone.session); assert(Math.hypot(p.x-before.x,p.y-before.y)>20); assert(!state.overflow); assert.equal(state.errors.length,0);
      const inputs=await evaluate(phone.session,'window.evidence.inputs'); assert(inputs.some((i:any)=>i.type==='input'&&i.fire&&Math.hypot(i.move.x,i.move.y)>0));
      report.layouts.push({width,height,before,after:{x:p.x,y:p.y},state,simultaneousMoveAndFire:true});
      await shot(phone.session,`${width}x${height}-twin-touch`); await touch(phone.session,'touchEnd',[]);
    }
    const loadExit = await load.exited;
    report.load=JSON.parse(readFileSync(join(evidence,'bots.json'),'utf8')); report.loadExit=loadExit; assert(report.load.tick.p95Ms<10);
    assert.equal(loadExit,0);
  } finally { if(load.exitCode===null){load.kill();await load.exited;} }
  console.log('18-bot workload complete, waiting for the natural scheduled warning');
  await until(()=>room.state.tick>=2220,120000);
  assert.equal(room.state.wave,4); assert(!room.state.bugs.some(b=>b.kind==='hive'));
  const third=await page(390,844,origin,true); await joinPage(third,'WarningJoin',0);
  assert.equal(app.arenas.active.get(await evaluate(third.session,'window.evidence.id'))!.room,room);
  await until(()=>evaluate(third.session,`window.paintTexts.includes('The hive is coming')`));
  report.scenes.push({name:'natural-mid-warning-join',controlled:false,snapshot:await evaluate(third.session,'window.evidence.snap')});
  await shot(third.session,'natural-mid-warning-join');
  await shot(desktop.session,'natural-warning-desktop');
  report.naturalLifeOver=await evaluate(desktop.session,`({dialog:!!document.querySelector('.arena-life'),banner:document.querySelector('.arena-hive-warning')?.textContent,texts:window.paintTexts})`);
  assert(report.naturalLifeOver.banner?.includes('The hive is coming'));
  await shot(phone.session,'natural-warning-life-over-landscape');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},phone.session);
  await pause(100);await shot(phone.session,'natural-warning-life-over-portrait');
  await until(()=>room.state.bugs.some(b=>b.kind==='hive'),12000);
  report.naturalArrival=app.arenas.snapshot(room);
  await until(()=>evaluate(third.session,`!window.paintTexts.includes('The hive is coming')&&!document.querySelector('.arena-hive-warning')`));
  await shot(third.session,'natural-activated');await dispose(third);
  console.log('Natural countdown, join and activation observed');
  // Explicit controlled fixtures: restore the two local lives and move the encounter clock.
  for(const pid of [id,second]){
    const p=room.state.players.get(pid)!;
    if(p.status==='out') app.arenas.message(app.arenas.active.get(pid)!,JSON.stringify({v:1,type:'respawn',life:p.life,touch:false}));
    Object.assign(p,{status:'active',hits:3,immuneUntil:1000000,x:1200,y:1200});
  }
  room.state.bugs=[];room.state.shots=[];room.state.globs=[];room.state.hive=undefined;
  room.state.tick=5300;room.state.wave=9;
  await until(()=>evaluate(desktop.session,`window.paintTexts.includes('The hive is coming')`));
  for(const [width,height] of [[1280,720],[390,844],[844,390]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width!==1280},desktop.session);
    await pause(120);await shot(desktop.session,`${width}x${height}-controlled-scheduled-warning`);
  }
  spawnHive(room.state,room.state.tick*50);const boss=room.state.bugs.find(b=>b.kind==='hive')!;
  boss.phase='arrival';boss.phaseUntil=room.state.tick*50+2000;boss.ringAt=boss.phaseUntil+6000;boss.vx=boss.vy=0;
  room.state.hive!.broodAt=boss.phaseUntil+4000;
  Object.assign(room.state.players.get(id)!,{status:'downed',hits:0,downedUntil:room.state.tick*50+10000,reviveMs:500,reviving:false});
  Object.assign(room.state.players.get(second)!,{x:1700,y:1700});
  for(const [width,height] of [[1280,720],[390,844],[844,390]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width!==1280},desktop.session);
    await pause(150);await shot(desktop.session,`${width}x${height}-controlled-downed-arrival`);
    report.scenes.push({name:`${width}x${height}-downed-arrival`,controlled:true,snapshot:await evaluate(desktop.session,'window.evidence.snap')});
  }
  await until(()=>boss.phase==='active',4000);await pause(150);
  assert(!(await evaluate(desktop.session,'window.paintTexts')).includes('The hive is coming'));
  await shot(desktop.session,'controlled-active-no-warning');
  await dispose(desktop);await dispose(phone);
  }
  // Full collection bounds: 20 players, 150 bugs, 140 shots, 24 globs and crowded markers.
  const {createServer:createVite}=await import('vite');
  const vite=await createVite({configFile:false,cacheDir:join(evidence,'vite-cache'),optimizeDeps:{entries:['scripts/arena-benchmark.html']},server:{host:'127.0.0.1',port:0,strictPort:false,watch:{ignored:['**/.evidence/**']}}});await vite.listen();
  try{
    const address=vite.httpServer!.address() as {port:number};
    const p=await page(1280,720,`http://127.0.0.1:${address.port}/scripts/arena-benchmark.html?hive&revive&edges`);
    await until(()=>evaluate(p.session,`!!document.querySelector('canvas')?.dataset.frameMs`));
    await key(p.session,'KeyF',true);await key(p.session,'KeyF',false);
    for(const [width,height] of [[1280,720],[390,844],[844,390],[568,320],[844,300],[667,280],[568,280]]){
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width!==1280},p.session);
      await until(()=>evaluate(p.session,`!!document.querySelector('canvas')?.dataset.frameMs`));
      await pause(1500); // Exclude viewport transition frames from the steady-state samples.
      const samples=[];for(let i=0;i<7;i++){await pause(1100);samples.push(await evaluate(p.session,`({frame:{...document.querySelector('canvas').dataset},errors:window.evidence.errors})`));}
      assert(samples.every(s=>s.errors.length===0&&Number(s.frame.frameMs)<16.67));
      report.frames.push({width,height,controlled:true,collections:{players:20,bugs:150,shots:140,globs:24,help:19,hive:1},samples});
      await shot(p.session,`${width}x${height}-full-arena-crowded-arrows`);
    }
    await call('Page.navigate',{url:`http://127.0.0.1:${address.port}/scripts/arena-benchmark.html?hive&revive&edges&quiet`},p.session);
    await until(()=>evaluate(p.session,`!!document.querySelector('canvas')?.dataset.frameMs`));
    for(const [width,height] of [[1280,720],[390,844],[844,390],[568,320],[844,300],[667,280],[568,280]]){
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width!==1280},p.session);
      await pause(200);await shot(p.session,`${width}x${height}-controlled-readable-arrows`);
    }
    await call('Page.navigate',{url:`http://127.0.0.1:${address.port}/scripts/arena-benchmark.html?hive&revive&quiet&panel-review`},p.session);
    await call('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:1,mobile:true},p.session);
    await until(()=>evaluate(p.session,`!!document.querySelector('canvas')?.dataset.frameMs`));
    assert.equal((await evaluate(p.session,'window.evidence.errors')).length,0);
    await shot(p.session,'844x390-controlled-downed-panel-help');
    await call('Page.navigate',{url:`http://127.0.0.1:${address.port}/scripts/arena-benchmark.html?hive&revive&edges&quiet&local-down`},p.session);
    await until(()=>evaluate(p.session,`!!document.querySelector('canvas')?.dataset.frameMs`));
    for(const [width,height] of [[568,320],[844,300],[667,280],[568,280]]){
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},p.session);
      await pause(200);assert.equal((await evaluate(p.session,'window.evidence.errors')).length,0);
      await shot(p.session,`${width}x${height}-controlled-downed-crowded-arrows`);
    }
    await dispose(p);
  }finally{await vite.close();}
  console.log('Completed issue 91 Chrome validation',evidence);
} finally {
  if(socket?.readyState===WebSocket.OPEN)try{await call('Browser.close');}catch{}
  socket?.close();chrome.kill();await chrome.exited;await app.stop();
  writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2));
}
