import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
test("engine routes controls, predicts/reconciles and renders interpolated movement with a following camera, then cleans up", () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-engine-")), home = join(scratch, "home"); mkdirSync(home);
  const moduleUrl = (file: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, file)).href);
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
let clock = 0, next = 0, observers = 0, disposed = 0, reconnects = 0, admissions = 0, receive, disconnected, refusal, lifePanel, resize;
const timers = new Map(), frames = new Map(), inputs = [], draws = [], captures = new Set(), effects = [];
performance.now = () => clock;
globalThis.setInterval = (fn, ms) => { assert.equal(ms, 50); const id = ++next; timers.set(id, fn); return id; };
globalThis.clearInterval = id => timers.delete(id);
globalThis.requestAnimationFrame = fn => { const id = ++next; frames.set(id, fn); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.ResizeObserver = class { constructor(fn) { resize = fn; } observe() { observers++; } disconnect() { observers--; } };
globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
globalThis.document = new EventTarget();
const canvas = Object.assign(new EventTarget(), { clientWidth: 390, clientHeight: 844, dataset: {}, getContext: () => ({ setTransform() {} }),
  getBoundingClientRect: () => ({ left: 20, top: 30 }),
  hasPointerCapture: id => captures.has(id), setPointerCapture: id => captures.add(id), releasePointerCapture: id => captures.delete(id) });
mock.module(${moduleUrl("draw.ts")}, () => ({ ArenaRenderer: class { reset() {} events(events) { effects.push(...events); } draw(width, height, camera, players, local, input, bugs, shots, wave, tick, now, scale) {
  draws.push(structuredClone({ width, height, camera, players, local, shots, wave, tick, scale }));
} } }));
mock.module(${moduleUrl("connection.ts")}, () => ({ connectArena: (identity, touch, got, status, gone) => {
  receive = got; disconnected = gone;
  return { send: input => { inputs.push(input); return true; }, dispose: () => disposed++, reconnect: () => reconnects++ };
} }));
const { mountArena } = await import(${moduleUrl("engine.ts")});
const identity = { playerId: crypto.randomUUID(), name: "Robot", team: "tabs" };
const key = (code, type = "keydown", repeat = false) => { const event = new Event(type); event.code = code; event.repeat = repeat; window.dispatchEvent(event); };
const pointer = (type, id, x, y) => canvas.dispatchEvent(Object.assign(new Event(type), { pointerType: "touch", pointerId: id, clientX: x, clientY: y }));
const mouse = (type, x, y) => (type === "pointerup" ? window : canvas).dispatchEvent(Object.assign(new Event(type), { pointerType: "mouse", pointerId: 9, button: 0, clientX: x + 20, clientY: y + 30 }));
const send = () => timers.values().next().value();
const frame = at => { clock = at; const [id, fn] = frames.entries().next().value; frames.delete(id); fn(clock); return draws.at(-1); };
for (let cycle = 0; cycle < 2; cycle++) {
  let base = clock;
  const cleanup = mountArena(canvas, identity, false, () => {}, (...args) => { refusal = args; }, () => admissions++, result => lifePanel = result);
  assert.equal(timers.size, 1); assert.equal(frames.size, 1); assert.equal(observers, 1);
  receive({ v: 1, type: "welcome" });
  assert.equal(admissions, cycle * 3 + 1);
  // Shutdown may arrive before prediction has received even its first snapshot.
  receive({ v: 1, type: "life_over", reason: "restart", life: 1, playerId: identity.playerId, score: 0, save: "pending" });
  const beforeInitialSnapshot = inputs.length; clock += 3500; send();
  assert.equal(inputs.length, beforeInitialSnapshot); assert.equal(reconnects, cycle, "Missing prediction must not prevent waiting for the restart receipt");
  receive({ v: 1, type: "welcome" }); base = clock;
  const own = { status: "active", life: 1, hits: 3, id: identity.playerId, name: identity.name, team: identity.team, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 0 };
  const remote = { ...own, id: crypto.randomUUID(), name: "Remote", team: "spaces", x: 1000, y: 1100 };
  const snapshot = (tick, ownX, remoteX, ackSeq, events = []) => receive({ v: 1, type: "snapshot", arenaId: "room", tick, wave: tick + 4, bugs: [],
    shots: [{ id: 800, owner: own.id, life: 1, born: 0, x: 1200 + tick * 45, y: 1200, vx: 900, vy: 0 }], events,
    players: [{ ...own, x: ownX, ackSeq }, { ...remote, x: remoteX }] });
  snapshot(1, 1200, 1000, 0);
  let draw = frame(base); assert.equal(draw.local.x, 1200); assert.deepEqual(draw.camera, { x: 1005, y: 778 });
  assert.equal(draw.wave, 5, "Nonzero wave must reach the renderer");
  assert.equal(draw.tick, 1, "Authoritative tick must reach the renderer");
  assert.equal(draw.players.find(p => p.id === remote.id).x, 1000);
  mouse("pointermove", 295, 322); send();
  assert.ok(Math.abs(inputs.at(-1).aim + Math.PI / 4) < 1e-8, "Mouse aim must include camera and canvas offsets");
  assert.equal(inputs.at(-1).fire, false);
  mouse("pointerdown", 295, 322); send(); assert.equal(inputs.at(-1).fire, true, "Left mouse fires through bindings");
  key("Space"); mouse("pointerup", 295, 322); send(); assert.equal(inputs.at(-1).fire, true, "Space survives mouse release");
  key("Space", "keyup"); send(); assert.equal(inputs.at(-1).fire, false);
  clock = base + 50; key("ArrowRight"); send();
  draw = frame(clock); assert.equal(draw.local.x, 1209, "Local input must predict before acknowledgement");
  assert.equal(draw.camera.x, 1014); key("ArrowRight", "keyup");
  clock = base + 100; snapshot(3, 1203, 1020, inputs.at(-1).seq);
  draw = frame(base + 150);
  assert.equal(draw.wave, 7, "Changing wave must reach the renderer exactly");
  assert.equal(draw.tick, 3, "Changing authoritative ticks must reach the renderer exactly");
  assert.equal(draw.shots[0].x, 1290, "Travelling shots must reach the renderer after the delay");
  assert.ok(Math.abs(draw.local.x - 1203) < 1, "Acknowledgement must retire prediction and reconcile to authority");
  assert.equal(draw.camera.x, draw.local.x - 195); assert.equal(draw.camera.y, draw.local.y - 422);
  assert.equal(draw.players.find(p => p.id === remote.id).x, 1010, "Remote motion must interpolate 100ms behind");
  draw = frame(base + 175); assert.equal(draw.shots[0].x, 1312.5, "Renderer receives advancing interpolated shots");
  for (const [code, x, y] of [["KeyW",0,-1],["KeyA",-1,0],["KeyS",0,1],["KeyD",1,0],
    ["ArrowUp",0,-1],["ArrowLeft",-1,0],["ArrowDown",0,1],["ArrowRight",1,0]]) {
    key(code); send(); assert.deepEqual(inputs.at(-1).move, { x, y }); key(code, "keyup");
  }
  pointer("pointerdown", 1, 50, 400); pointer("pointermove", 1, 110, 400); send();
  assert.deepEqual(inputs.at(-1).move, { x: 1, y: 0 });
  pointer("pointerdown", 2, 350, 400); pointer("pointermove", 2, 300, 300); send();
  assert.deepEqual(inputs.at(-1).move, { x: 1, y: 0 });
  assert.equal(inputs.at(-1).fire, true); assert.equal(inputs.at(-1).touch, true);
  assert.ok(Math.abs(inputs.at(-1).aim - Math.atan2(-100, -50)) < 1e-8, "Right-thumb moves must reach the aim input");
  assert.ok(captures.has(1) && captures.has(2), "Both pointers are captured independently");
  pointer("pointermove", 2, 353, 402); send(); assert.equal(inputs.at(-1).fire, false, "Right dead zone stops fire without stopping movement");
  assert.deepEqual(inputs.at(-1).move, { x: 1, y: 0 });
  pointer("pointermove", 2, 400, 450); send(); assert.equal(inputs.at(-1).fire, true);
  assert.ok(Math.abs(inputs.at(-1).aim - Math.PI / 4) < 1e-8);
  pointer("pointercancel", 1, 110, 400); pointer("pointermove", 1, 160, 400); send();
  assert.deepEqual(inputs.at(-1).move, { x: 0, y: 0 }); assert.equal(inputs.at(-1).fire, false, "Cancellation clears both sticks, including held touch fire");
  key("KeyD"); send(); assert.equal(inputs.at(-1).move.x, 1);
  window.dispatchEvent(new Event("blur")); send(); assert.equal(inputs.at(-1).move.x, 0);
  snapshot(4, 50, 1020, inputs.at(-1).seq); draw = frame(clock + 50);
  assert.equal(draw.camera.x, -112);
  mouse("pointermove", 150, 400); send();
  const firstAim = inputs.at(-1).aim;
  assert.ok(Math.abs(firstAim - Math.atan2(-22, -12)) < 1e-8);
  key("KeyD"); send(); key("KeyD", "keyup"); send();
  assert.ok(Math.abs(inputs.at(-1).aim - Math.atan2(-22, -21)) < 1e-8, "Stationary cursor must be resampled after player movement");
  key("Space"); send();
  own.status = "downed"; own.hits = 0; own.downedUntil = 10000; own.reviveMs = 0;
  pointer("pointerdown", 1, 50, 400); pointer("pointerdown", 2, 350, 400);
  snapshot(5, 1203, 1020, inputs.at(-1).seq);
  assert.equal(captures.size, 0, "Downing releases both pointer captures"); assert.equal(lifePanel, null);
  const downCount = inputs.length;
  key("KeyA"); pointer("pointerdown", 3, 50, 400); pointer("pointermove", 3, 110, 400); send();
  assert.equal(inputs.length, downCount, "Downed controls neither send input nor respawn"); assert.equal(captures.size, 0);
  own.status = "active"; own.hits = 1; own.downedUntil = 0;
  snapshot(5, 1203, 1020, inputs.at(-1).seq); send();
  assert.equal(inputs.at(-1).life, 1, "Revive keeps the same life"); assert.equal(inputs.at(-1).fire, false);
  assert.deepEqual(inputs.at(-1).move, { x: 0, y: 0 }, "Revive requires fresh input");
  key("KeyA", "keydown", true); key("Space", "keydown", true); send();
  assert.deepEqual(inputs.at(-1).move, { x: 0, y: 0 }); assert.equal(inputs.at(-1).fire, false);
  key("KeyA", "keyup"); key("Space", "keyup"); key("Space"); send();
  own.status = "out"; own.hits = 0; own.result = { v: 1, type: "life_over", life: 1, playerId: own.id, score: 34, kills: 3, seconds: 8, touch: false, save: "pending" };
  const oldEffects = effects.length;
  snapshot(6, 1203, 1020, inputs.at(-1).seq, [{ id: 100 + cycle, tick: 6, x: 1300, y: 1200, points: 11 }]); assert.equal(lifePanel.score, 34);
  assert.equal(effects.length, oldEffects, "Receipt must not deliver kill feedback ahead of delayed combat");
  frame(clock + 99); assert.equal(effects.length, oldEffects);
  frame(clock + 1); assert.equal(effects.length, oldEffects + 1);
  frame(clock + 10); assert.equal(effects.length, oldEffects + 1, "Kill feedback is delivered once");
  const deadCount = inputs.length; key("Space", "keydown", true); send(); assert.equal(inputs.length, deadCount, "Held input at death cannot respawn");
  key("KeyW"); assert.equal(inputs.at(-1).type, "respawn"); assert.equal(inputs.at(-1).life, 1);
  own.status = "active"; own.hits = 3; own.life = 2; delete own.result; snapshot(7, 1300, 1020, inputs.at(-1).seq); assert.equal(lifePanel, null);
  receive({ v: 1, type: "life_over", life: 1, playerId: own.id, score: 34, save: "saved" }); assert.equal(lifePanel, null, "Late save cannot reopen previous life");
  key("Space", "keydown", true); key("KeyW", "keydown", true);
  send(); assert.equal(inputs.at(-1).fire, false); assert.deepEqual(inputs.at(-1).move, { x: 0, y: 0 });
  key("Space", "keyup"); key("KeyW", "keyup");
  canvas.clientWidth = 1920; canvas.clientHeight = 1080; window.devicePixelRatio = 3; resize();
  draw = frame(clock + 50); assert.equal(draw.scale, 1920 / 900);
  assert.equal(canvas.width, 3840); assert.equal(canvas.height, 2160, "DPR remains bounded separately from world scale");
  assert.equal(draw.camera.x, draw.local.x - 450); assert.equal(draw.camera.y, draw.local.y - 253.125);
  mouse("pointermove", 1060, 440); send();
  assert.ok(Math.abs(inputs.at(-1).aim + Math.PI / 4) < 1e-8, "Scaled mouse aim must divide CSS coordinates before adding the world camera");
  canvas.clientWidth = 390; canvas.clientHeight = 844; window.devicePixelRatio = 1; resize();
  key("KeyD");
  receive({ v: 1, type: "life_over", reason: "death", life: 1, playerId: own.id, score: 42, save: "pending" });
  const beforeOldResult = inputs.length; send(); assert.equal(inputs.length, beforeOldResult + 1, "An old ordinary death result must not pause the replacement life");
  receive({ v: 1, type: "life_over", reason: "restart", life: 3, playerId: own.id, score: 42, save: "pending" });
  assert.equal(lifePanel, null, "Restart result must not open the death panel while prediction is alive");
  const pendingScene = draws.length, pendingInputs = inputs.length, pendingReconnects = reconnects;
  frame(clock + 3500); send();
  assert.equal(draws.length, pendingScene, "Pending restart freezes the scene before persistence finishes");
  assert.equal(inputs.length, pendingInputs); assert.equal(reconnects, pendingReconnects, "Pending save must not cross the ordinary snapshot timeout");
  receive({ v: 1, type: "server_restart", result: { score: 42, save: "saved", reason: "restart" } });
  assert.equal(lifePanel, null);
  const sceneCount = draws.length; frame(clock + 20); assert.equal(draws.length, sceneCount, "Restart retains the rendered scene");
  disconnected(); const count = inputs.length; timers.values().next().value(); assert.equal(inputs.length, count);
  receive({ v: 1, type: "welcome" }); snapshot(1, 1200, 1000, 0); timers.values().next().value(); assert.equal(inputs.at(-1).move.x, 0); assert.equal(inputs.at(-1).seq, 1);
  clock += 3001; timers.values().next().value(); assert.equal(reconnects, cycle + 1);
  receive({ v: 1, type: "error", code: "name-hidden", message: "Unavailable" });
  assert.deepEqual(refusal, ["Unavailable", undefined, "name-hidden"]);
  cleanup(); assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(observers, 0); assert.equal(disposed, cycle + 1);
  // The next mount must start clean even after a key event while detached.
  key("KeyD");
}
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], { cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
