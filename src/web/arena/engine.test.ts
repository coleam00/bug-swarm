import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
test("engine clears input on blur/disconnect, reconnects stalled snapshots and releases mount resources", () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-engine-")), home = join(scratch, "home"); mkdirSync(home);
  const moduleUrl = (file: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, file)).href);
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
let clock = 0, next = 0, observers = 0, disposed = 0, reconnects = 0, receive, disconnected;
const timers = new Map(), frames = new Map(), inputs = [];
performance.now = () => clock;
globalThis.setInterval = fn => { const id = ++next; timers.set(id, fn); return id; };
globalThis.clearInterval = id => timers.delete(id);
globalThis.requestAnimationFrame = fn => { const id = ++next; frames.set(id, fn); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; } observe() { observers++; } disconnect() { observers--; } };
globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
globalThis.document = new EventTarget();
const canvas = Object.assign(new EventTarget(), { clientWidth: 390, clientHeight: 844, dataset: {}, getContext: () => ({ setTransform() {} }), hasPointerCapture: () => false });
mock.module(${moduleUrl("draw.ts")}, () => ({ ArenaRenderer: class { draw() {} } }));
mock.module(${moduleUrl("connection.ts")}, () => ({ connectArena: (identity, touch, got, status, gone) => {
  receive = got; disconnected = gone;
  return { send: input => { inputs.push(input); return true; }, dispose: () => disposed++, reconnect: () => reconnects++ };
} }));
const { mountArena } = await import(${moduleUrl("engine.ts")});
const identity = { playerId: crypto.randomUUID(), name: "Robot", team: "tabs" };
const key = code => { const event = new Event("keydown"); event.code = code; window.dispatchEvent(event); };
for (let cycle = 0; cycle < 2; cycle++) {
  const cleanup = mountArena(canvas, identity, false, () => {}, () => {});
  assert.equal(timers.size, 1); assert.equal(frames.size, 1); assert.equal(observers, 1);
  receive({ v: 1, type: "welcome" });
  receive({ v: 1, type: "snapshot", arenaId: "room", tick: 1, players: [{ id: identity.playerId, name: identity.name, team: identity.team, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 0 }] });
  key("KeyD"); timers.values().next().value(); assert.equal(inputs.at(-1).move.x, 1);
  window.dispatchEvent(new Event("blur")); timers.values().next().value(); assert.equal(inputs.at(-1).move.x, 0);
  key("KeyD"); disconnected(); const count = inputs.length; timers.values().next().value(); assert.equal(inputs.length, count);
  receive({ v: 1, type: "welcome" }); timers.values().next().value(); assert.equal(inputs.at(-1).move.x, 0); assert.equal(inputs.at(-1).seq, 1);
  clock += 3001; timers.values().next().value(); assert.equal(reconnects, cycle + 1);
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
