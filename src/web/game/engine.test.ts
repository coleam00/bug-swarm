import { expect, spyOn, test } from "bun:test";
import { Renderer } from "./draw";
import { mountGame } from "./engine";
import { Session } from "./session";
import { canvasFixture } from "./canvas-fixture.test-support";
import { arenaForViewport } from "./arena";

function harness(screenShaped = false) {
  const names = ["window", "document", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"] as const;
  const previous = names.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const fixture = canvasFixture();
  const win = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 });
  const doc = Object.assign(new EventTarget(), { hidden: false, createElement: fixture.factory });
  const box = { left: 10, top: 20, width: 390, height: 700 };
  let onResize = () => {};
  let callback: FrameRequestCallback | undefined, cancelled = 0, disconnected = false;
  const captures = new Set<number>();
  const context = fixture.context;
  const canvas = Object.assign(new EventTarget(), {
    width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => box,
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id),
  });
  const replacements = [win, doc, class { constructor(cb: () => void) { onResize = cb; } observe() {} disconnect() { disconnected = true; } }, (cb: FrameRequestCallback) => { callback = cb; return 1; }, () => { cancelled++; }];
  names.forEach((key, i) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: replacements[i] }));
  const session = new Session({ playerId: crypto.randomUUID(), name: "Robot" }, {
    start: async () => ({ runId: "test-run" }), finish: async () => ({ saved: true }), best: async () => ({ best: null }), leaders: async () => [],
  }, () => 1, undefined, screenShaped ? () => arenaForViewport(win.innerWidth, win.innerHeight) : undefined);
  session.start();
  const readouts: string[] = [];
  const unmount = mountGame(canvas as unknown as HTMLCanvasElement, session, () => {}, (text) => readouts.push(text));
  function event(target: EventTarget, type: string, props: Record<string, unknown>) {
    const value = Object.assign(new Event(type, { cancelable: true }), props); target.dispatchEvent(value); return value;
  }
  return { session, canvas, win, doc, captures, event, readouts, resize: (w: number, h: number) => { box.width = w; box.height = h; onResize(); }, tick: (time: number) => callback!(time),
    cleanup() {
      unmount(); expect(cancelled).toBe(1); expect(disconnected).toBe(true); expect(captures.size).toBe(0);
      names.forEach((key, i) => { const descriptor = previous[i]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    } };
}

test("rotation rescales the current run; keyboard and touch restarts sample the screen even with a shrunken game-over canvas", () => {
  const h = harness(true);
  try {
    const first = h.session.current!.simulation;
    expect(first.arena).toEqual({ width: 450, height: 800 });
    h.win.innerWidth = 844; h.win.innerHeight = 390; h.resize(844, 280); h.tick(0);
    expect(first.arena).toEqual({ width: 450, height: 800 });
    h.event(h.canvas, "pointermove", { pointerId: 1, pointerType: "mouse", clientX: 854, clientY: 160 }); h.tick(17);
    expect(first.robot.x).toBeGreaterThan(225); expect(first.robot.y).toBeCloseTo(400);
    first.dead = true; h.tick(34); h.resize(295, 280);
    h.event(h.win, "keydown", { key: " ", repeat: false });
    expect(h.session.current!.simulation.arena).toEqual({ width: 800, height: 450 });
    h.tick(51); h.session.current!.simulation.dead = true; h.tick(68);
    h.win.innerWidth = 390; h.win.innerHeight = 844;
    h.event(h.canvas, "pointerdown", { pointerId: 2, pointerType: "touch", button: 0, clientX: 200, clientY: 160 });
    expect(h.session.current!.simulation.arena).toEqual({ width: 450, height: 800 });
  } finally { h.cleanup(); }
});
test("engine maps mouse and touch, captures/releases pointers, prioritizes keys and clears on blur/cancel", () => {
  const h = harness();
  try {
    h.tick(0);
    h.event(h.canvas, "pointermove", { pointerId: 1, pointerType: "mouse", clientX: 390, clientY: 370 }); h.tick(17);
    expect(h.session.current!.simulation.robot.x).toBeGreaterThan(300);
    const key = h.event(h.win, "keydown", { key: "ArrowLeft", repeat: false }); expect(key.defaultPrevented).toBe(true);
    h.tick(34); expect(h.session.current!.simulation.robot.x).toBeCloseTo(300);
    h.event(h.win, "keyup", { key: "ArrowLeft" });
    h.event(h.canvas, "pointerdown", { pointerId: 2, pointerType: "touch", button: 0, clientX: 10, clientY: 370 });
    expect(h.captures.has(2)).toBe(true); expect(h.session.current!.touch).toBe(true);
    h.tick(51); expect(h.session.current!.simulation.robot.x).toBeLessThan(300);
    h.event(h.canvas, "pointercancel", { pointerId: 2 }); expect(h.captures.size).toBe(0);
    const x = h.session.current!.simulation.robot.x; h.tick(68); expect(h.session.current!.simulation.robot.x).toBe(x);
    h.event(h.win, "keydown", { key: "d", repeat: false }); h.event(h.win, "blur", {}); h.tick(85); h.tick(102);
    expect(h.session.current!.simulation.robot.x).toBe(x);
  } finally { h.cleanup(); }
});
test("F reports the active frame rate without counting time before the loop mounted", () => {
  const h = harness();
  try {
    h.event(h.win, "keydown", { key: "f", repeat: false });
    for (let i = 0; i <= 61; i++) h.tick(5000 + i * 1000 / 60);
    expect(h.readouts).toHaveLength(1);
    expect(Number.parseInt(h.readouts[0]!)).toBeGreaterThanOrEqual(58);
    expect(h.readouts[0]).toContain("update"); expect(h.readouts[0]).toContain("draw");
    h.event(h.win, "keydown", { key: "f", repeat: false }); expect(h.readouts.at(-1)).toBe("");
  } finally { h.cleanup(); }
});
test("held keys cannot restart at death; a fresh key or touch immediately starts a clean run", () => {
  const h = harness();
  try {
    h.tick(0); h.event(h.win, "keydown", { key: "d", repeat: false });
    h.session.current!.simulation.dead = true; h.tick(17); const dead = h.session.current;
    h.event(h.win, "keydown", { key: "d", repeat: true }); expect(h.session.current).toBe(dead);
    h.event(h.win, "keydown", { key: "d", repeat: false }); expect(h.session.current).toBe(dead);
    h.event(h.win, "keyup", { key: "d" }); h.event(h.win, "keydown", { key: "d", repeat: false });
    expect(h.session.current).not.toBe(dead); h.tick(34); h.tick(51);
    expect(h.session.current!.simulation.robot.x).toBeGreaterThan(300);
    h.session.current!.simulation.dead = true; h.tick(68);
    h.event(h.canvas, "pointerdown", { pointerId: 2, pointerType: "touch", button: 0, clientX: 390, clientY: 370 });
    expect(h.session.view.over).toBe(false); expect(h.session.current!.touch).toBe(true); h.tick(85); h.tick(102);
    expect(h.session.current!.simulation.robot.x).toBeGreaterThan(300);
  } finally { h.cleanup(); }
});

test("visibility drops hidden elapsed time and DPR resize rebuilds caches without resetting the run", () => {
  const h = harness();
  try {
    h.tick(0); h.event(h.win, "keydown", { key: "d", repeat: false }); h.tick(17);
    const s = h.session.current!.simulation, x = s.robot.x, time = s.time;
    h.doc.hidden = true; h.event(h.doc, "visibilitychange", {}); h.tick(10000);
    expect(s.time).toBe(time);
    h.doc.hidden = false; h.event(h.doc, "visibilitychange", {}); h.tick(20000); h.tick(20017);
    expect(s.robot.x).toBe(x); expect(s.time).toBeCloseTo(time + 1 / 60);
    Object.assign(h.win, { devicePixelRatio: 3 }); h.event(h.win, "resize", {});
    expect(h.canvas.width).toBe(780); expect(h.session.current!.simulation).toBe(s);
    expect(s.robot.x).toBe(x);
  } finally { h.cleanup(); }
});

test("engine delivers movement and simulated squash/hit feedback to rendering and advances effects on later frames", () => {
  const draw = spyOn(Renderer.prototype, "draw"), h = harness();
  const renderedEffects = () => draw.mock.calls.at(-1)![1];
  try {
    const state = h.session.current!.simulation; state.spawnIn = state.fireIn = 100;
    h.tick(0); h.event(h.win, "keydown", { key: "d", repeat: false }); h.tick(17);
    expect(renderedEffects().trails.count).toBeGreaterThan(0);
    h.event(h.win, "keyup", { key: "d" });
    state.hits = 2;
    state.bugs.push({ id: 1, kind: "base", x: 100, y: 300 }, { id: 2, kind: "base", x: state.robot.x, y: state.robot.y });
    state.shots.push({ x: 100, y: 300, vx: 1, vy: 0, life: 1 }); h.tick(34);
    const fx = renderedEffects(), labelY = fx.labels.y[0]!, particleX = fx.particles.x[0]!, particleY = fx.particles.y[0]!, life = fx.labels.life[0]!;
    expect(state.squashes).toBe(1); expect(state.hits).toBe(3); expect(h.session.view.over).toBe(true);
    expect(fx.labels.count).toBe(1); expect(fx.particles.count).toBeGreaterThan(0);
    expect(fx.flash).toBeGreaterThan(0); expect(Math.hypot(fx.shake.x, fx.shake.y)).toBeGreaterThan(0);
    h.tick(51);
    expect(renderedEffects()).toBe(fx); expect(fx.labels.y[0]!).toBeLessThan(labelY);
    expect(Math.hypot(fx.particles.x[0]! - particleX, fx.particles.y[0]! - particleY)).toBeGreaterThan(0);
    expect(fx.labels.life[0]!).toBeLessThan(life);
    expect(fx.flash).toBeLessThan(0.1);
    for (let frame = 0; frame < 45; frame++) h.tick(68 + frame * 17);
    expect(fx.trails.count).toBe(0); expect(fx.labels.count).toBe(0); expect(fx.particles.count).toBe(0);
    expect(fx.flash).toBe(0); expect(fx.shake.remaining).toBe(0);
  } finally { h.cleanup(); draw.mockRestore(); }
});
