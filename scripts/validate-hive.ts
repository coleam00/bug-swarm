// Production Chrome evidence. Run after bun run build; all scratch files stay in this checkout.
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "../src/server/server";
import { runBots } from "./bots";
import { spawnHive, contributeHive } from "../src/shared/arena/bugs/hive";
const evidence = mkdtempSync(join((mkdirSync(".evidence/84", { recursive: true }), resolve(".evidence/84")), "chrome-"));
const home = join(evidence, "home"), temp = join(evidence, "tmp"), profile = join(evidence, "profile");
for (const path of [home, temp, profile, join(home,"AppData/Local"), join(home,"AppData/Roaming")]) mkdirSync(path, {recursive:true});
const chromePath = process.env.CHROME_PATH ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find(existsSync);
if (!chromePath) throw Error("Set CHROME_PATH to factory Chrome");
const app = createServer({port:0,hostname:"127.0.0.1",dataDir:join(evidence,"data"),env:{}}), origin=app.server.url.origin;
const chromeEnv: NodeJS.ProcessEnv={...process.env, HOME:home, USERPROFILE:home, XDG_CONFIG_HOME:home, XDG_CACHE_HOME:join(evidence,"cache"), APPDATA:join(home,"AppData/Roaming"), LOCALAPPDATA:join(home,"AppData/Local"), TMP:temp, TEMP:temp}; delete chromeEnv.CHROME_CRASHPAD_PIPE_NAME;
const chrome = Bun.spawn([chromePath,"--headless=new","--no-first-run","--no-default-browser-check","--disable-background-networking","--remote-debugging-port=0",`--user-data-dir=${profile.replaceAll("\\","/")}`,"--disable-background-timer-throttling","--disable-renderer-backgrounding","--disable-backgrounding-occluded-windows","about:blank"], {env:chromeEnv,stdout:"ignore",stderr:Bun.file(join(evidence,"chrome.log"))});
const scenesOnly = process.argv.includes("--scenes-only");
const report:any={origin,scenesOnly,bun:Bun.version,layouts:[],errors:[],scenes:[],frames:[]};
console.log("Evidence:", evidence);
let socket: WebSocket | undefined, botTask: Promise<any> | undefined, botAbort: AbortController | undefined;
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
  const desktop=await page(1280,720,origin), phone=await page(390,844,origin,true);
  await joinPage(desktop,'HivePilot',0); await joinPage(phone,'HiveScout',1);
  const id=await evaluate(desktop.session,'window.evidence.id'), second=await evaluate(phone.session,'window.evidence.id');
  const room=app.arenas.active.get(id)!.room!;
  if (!scenesOnly) {
    botAbort=new AbortController(); botTask=runBots({url:origin,count:15,seconds:210,policy:'aimer'},botAbort.signal); void botTask.catch(()=>{});
    await until(()=>evaluate(desktop.session,'window.evidence.snap?.players.length===17'));
  }
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
  if (!scenesOnly) {
    // Natural production clock and unmodified bots: two browsers + fifteen aimers.
    console.log("Waiting naturally for wave five...");
    let spawnAt=0, spawnSnapshot:any;
    await until(()=>{
      const boss=room.state.bugs.find(b=>b.kind==='hive');
      if(!boss)return false;
      spawnAt=performance.now();spawnSnapshot=app.arenas.snapshot(room);return true;
    },135000);
    const naturalBoss=room.state.bugs.find(b=>b.kind==='hive')!;
    report.natural={tick:room.state.tick,wave:room.state.wave,players:room.state.players.size,living:[...room.state.players.values()].filter(p=>p.status!=='out').length,boss:{...naturalBoss}};
    assert.equal(room.state.players.size,17);assert.equal(room.state.wave,5);assert.equal(naturalBoss.maxHp,120+60*report.natural.living);
    writeFileSync(join(evidence,'natural-spawn.json'),JSON.stringify(spawnSnapshot,null,2));
    await shot(desktop.session,'natural-wave-five');
    const attacks:any[]=[];
    await until(()=>{
      if(room.state.globs.some(g=>g.source==='hive')&&(!attacks.length||attacks.at(-1).tick!==room.state.tick))attacks.push({tick:room.state.tick,globs:room.state.globs.filter(g=>g.source==='hive').map(g=>({...g}))});
      return performance.now()-spawnAt>18000;
    },22000);
    assert(attacks.length>0);report.natural.attacks=attacks;
    const untilMs=Math.floor(performance.now()/50)*50,sinceMs=Math.ceil(spawnAt/50)*50;
    report.bossWindow=await(await fetch(`${origin}/api/arena/stats?sinceMs=${sinceMs}&untilMs=${untilMs}&raw=1`)).json();
    assert(report.bossWindow.window.complete);assert(report.bossWindow.window.tick.p95Ms<10);
    console.log("Natural hive observed",JSON.stringify(report.natural.boss),"tick p95",report.bossWindow.window.tick.p95Ms);
    botAbort!.abort();try{await botTask;}catch{}botTask=undefined;
  }
  await until(()=>room.state.players.size===2);
  const pilot=room.state.players.get(id)!,scout=room.state.players.get(second)!;
  for(const p of [pilot,scout]){
    if(p.status==='out') app.arenas.message(app.arenas.active.get(p.id)!,JSON.stringify({v:1,type:'respawn',life:p.life,touch:false}));
    Object.assign(p,{status:'active',hits:3,downedUntil:0,reviveMs:0,reviving:false,immuneUntil:room.state.tick*50+100000});
  }
  // Explicitly controlled in-process fixture for readable attacks and awards.
  // No production debug route or shipped rule is introduced.
  Object.assign(pilot,{x:1200,y:1200});Object.assign(scout,{x:1500,y:1400});
  room.state.bugs=[];room.state.shots=[];room.state.globs=[];room.state.hive=undefined;
  spawnHive(room.state,room.state.tick*50);const boss=room.state.bugs.find(b=>b.kind==='hive')!;
  Object.assign(boss,{x:900,y:1200,phase:'active'});delete boss.phaseUntil;
  room.state.hive!.broodAt=room.state.tick*50+4000;room.state.hive!.ringAt=room.state.tick*50+1000;
  await pause(250);await shot(desktop.session,'controlled-boss-health-minimap');
  report.scenes.push({name:'boss',controlled:true,snapshot:await evaluate(desktop.session,'window.evidence.snap')});
  // Off-screen direction is visible in the separate browser's camera.
  Object.assign(scout,{x:2000,y:2000});await pause(250);await shot(phone.session,'controlled-edge-arrow');
  await until(()=>room.state.globs.some(g=>g.source==='hive'));await pause(650);await shot(desktop.session,'controlled-ring');
  report.scenes.push({name:'ring',controlled:true,snapshot:await evaluate(desktop.session,'window.evidence.snap')});
  // Capture both mobile orientations during the boss, including two-point touch.
  for(const [width,height] of [[390,844],[844,390]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},phone.session);
    await touch(phone.session,'touchStart',[{id:1,x:width!*0.2,y:height!*0.7},{id:2,x:width!*0.8,y:height!*0.7}]);
    await touch(phone.session,'touchMove',[{id:1,x:width!*0.2+30,y:height!*0.7-20},{id:2,x:width!*0.8-30,y:height!*0.7-20}]);
    await pause(250);await shot(phone.session,`${width}x${height}-boss-touch`);await touch(phone.session,'touchEnd',[]);
  }
  // Arrival and downed overlays share the same boss bar and phone layout.
  boss.phase='arrival';boss.phaseUntil=room.state.tick*50+2000;boss.vx=boss.vy=0;
  Object.assign(pilot,{status:'downed',hits:0,downedUntil:room.state.tick*50+10000,reviveMs:500,reviving:false});
  for(const [width,height] of [[390,844],[844,390]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true},desktop.session);
    await pause(200);await shot(desktop.session,`${width}x${height}-downed-arrival`);
    report.scenes.push({name:`${width}x${height}-downed-arrival`,controlled:true,snapshot:await evaluate(desktop.session,'window.evidence.snap')});
  }
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false},desktop.session);
  Object.assign(pilot,{status:'active',hits:3,downedUntil:0,reviveMs:0,reviving:false});boss.phase='active';delete boss.phaseUntil;
  const before={pilot:pilot.score,scout:scout.score};
  contributeHive(room.state,boss,scout,1);boss.hp=1;
  room.state.shots.push({id:room.state.nextId++,owner:id,life:pilot.life,x:boss.x,y:boss.y,vx:900,vy:0,born:room.state.tick*50});
  await until(()=>evaluate(desktop.session,'window.evidence.hiveKills.length>0'));
  await pause(180);await shot(desktop.session,'controlled-kill-banner');await shot(phone.session,'controlled-kill-banner-phone');
  const kill=await evaluate(desktop.session,'window.evidence.hiveKills.at(-1)');
  const event=kill.events.find((e:any)=>e.type==='kill'&&e.kind==='hive');
  assert.equal(event.rewards.reduce((n:number,r:any)=>n+r.amount,0),400);
  report.scenes.push({name:'kill',controlled:true,before,after:{pilot:pilot.score,scout:scout.score},snapshot:kill});
  writeFileSync(join(evidence,'scenes.json'),JSON.stringify(report.scenes,null,2));
  // Full collection rendering fixture through an owned Vite server.
  const {createServer:createVite}=await import('vite');
  const vite=await createVite({configFile:false,cacheDir:join(evidence,'vite-cache'),optimizeDeps:{entries:['scripts/arena-benchmark.html']},server:{host:'127.0.0.1',port:0,strictPort:false,watch:{ignored:['**/.evidence/**']}}});await vite.listen();
  try{
    const address=vite.httpServer!.address() as {port:number};
    for(const [width,height] of [[1280,720],[390,844],[844,390]]){
      const p=await page(width!,height!,`http://127.0.0.1:${address.port}/scripts/arena-benchmark.html?hive`,width!==1280);
      await until(()=>evaluate(p.session,`!!document.querySelector('canvas')?.dataset.frameMs`));const samples=[];for(let i=0;i<7;i++){await pause(1100);samples.push(await evaluate(p.session,`({frame:{...document.querySelector('canvas').dataset},errors:window.evidence.errors})`));}report.frames.push({width,height,samples});await shot(p.session,`${width}x${height}-full-arena`);await dispose(p);
    }
  }finally{await vite.close();}
  report.errors=[...await evaluate(desktop.session,'window.evidence.errors'),...await evaluate(phone.session,'window.evidence.errors')];assert.equal(report.errors.length,0);
  await dispose(desktop);await dispose(phone);await until(()=>app.arenas.rooms.size===0);
  if (!scenesOnly) {
    // CLI workload includes natural hive activity across ten rooms.
    const activity={maxSpitters:0,maxGlobs:0,swellSnapshots:0,globPops:0,maxHives:0,hiveGlobs:0};
    const sample=setInterval(()=>{for(const r of app.arenas.rooms.values()){activity.maxHives=Math.max(activity.maxHives,r.state.bugs.filter(b=>b.kind==='hive').length);activity.hiveGlobs+=r.state.globs.filter(g=>g.source==='hive').length;activity.maxSpitters=Math.max(activity.maxSpitters,r.state.bugs.filter(b=>b.kind==='spitter').length);activity.maxGlobs=Math.max(activity.maxGlobs,r.state.globs.length);activity.swellSnapshots+=r.state.bugs.filter(b=>b.phase==='swell').length;activity.globPops+=r.state.events.filter(e=>e.type==='glob-pop').length;}},50);
    try{
      const load=Bun.spawn([process.execPath,'run','bots','--','--url',origin,'--count','200','--seconds','145','--policy','aimer'],{env:process.env,stdout:Bun.file(join(evidence,'load.json')),stderr:Bun.file(join(evidence,'load-errors.log'))});
      assert.equal(await load.exited,0);report.load=JSON.parse(readFileSync(join(evidence,'load.json'),'utf8')); report.loadActivity=activity;
      assert(report.load.tick.p95Ms<10);assert(activity.maxSpitters>0&&activity.maxGlobs>0&&activity.maxHives>0&&activity.hiveGlobs>0);
    }finally{clearInterval(sample);}
  }
  console.log("Completed hive validation", evidence);
} finally {
  botAbort?.abort();if(botTask)try{await botTask;}catch{}
  if(socket?.readyState===WebSocket.OPEN)try{await call('Browser.close');}catch{}
  socket?.close();chrome.kill();await chrome.exited;await app.stop();
  writeFileSync(join(evidence,'report.json'),JSON.stringify(report,null,2));
}
