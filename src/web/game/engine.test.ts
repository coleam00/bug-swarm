import { expect, spyOn, test } from "bun:test";
import { Renderer } from "./draw";
import { mountGame, type MovementObserver } from "./engine";
import { CHOICE_GUARD_MS, RESTART_GUARD_MS, Session } from "./session";
import { FakeTiming } from "./timing.test-support";
import { canvasFixture } from "./canvas-fixture.test-support";
import { arenaForViewport } from "./arena";
import { ROBOT_SPEED } from "./config";

function harness(screenShaped = false, movement?: MovementObserver) {
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
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => {
      captures.delete(id); event(canvas, "lostpointercapture", { pointerId: id });
    },
  });
  const replacements = [win, doc, class { constructor(cb: () => void) { onResize = cb; } observe() {} disconnect() { disconnected = true; } }, (cb: FrameRequestCallback) => { callback = cb; return 1; }, () => { cancelled++; }];
  names.forEach((key, i) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: replacements[i] }));
  const time = new FakeTiming();
  let lastFrame = 0;
  const session = new Session({ playerId: crypto.randomUUID(), name: "Robot" }, {
    standing: async () => ({ rank: null, total: 0, next: null }),
    start: async () => ({ runId: "test-run" }), finish: async () => ({ saved: true }), best: async () => ({ best: null }), leaders: async () => [], teams: async () => ({ tabs: 0, spaces: 0 }),
  }, () => 1, undefined, screenShaped ? () => arenaForViewport(win.innerWidth, win.innerHeight) : undefined, undefined,
    { now: time.now, sleep: async ms => { time.advance(ms); } }, time);
  session.start();
  const readouts: string[] = [];
  const unmount = mountGame(canvas as unknown as HTMLCanvasElement, session, () => {}, (text) => readouts.push(text), movement);
  function event(target: EventTarget, type: string, props: Record<string, unknown>) {
    const value = Object.assign(new Event(type, { cancelable: true }), props); target.dispatchEvent(value); return value;
  }
  return { session, time, canvas, win, doc, captures, event, readouts, resize: (w: number, h: number) => { box.width = w; box.height = h; onResize(); }, tick: (timestamp: number) => {
      // Explicit guard advances also move the next frame onto the same wall clock.
      time.advance(Math.max(0, timestamp - lastFrame)); lastFrame = timestamp; callback!(time.now());
    },
    cleanup() {
      unmount(); expect(cancelled).toBe(1); expect(disconnected).toBe(true); expect(captures.size).toBe(0);
      names.forEach((key, i) => { const descriptor = previous[i]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    } };
}

test.each(["w", "ArrowRight", "mouse", "touch"])("%s displacement notifies the onboarding observer exactly once", control => {
  const moved: number[] = [];
  let checks = 0;
  const h = harness(false, { pending: () => { checks++; return true; }, moved: token => moved.push(token) });
  try {
    h.tick(0);
    if (control === "mouse") h.event(h.canvas, "pointermove", { pointerId: 1, pointerType: "mouse", clientX: 390, clientY: 370 });
    else if (control === "touch") {
      h.event(h.canvas, "pointerdown", { pointerId: 1, pointerType: "touch", button: 0, clientX: 200, clientY: 370 });
      h.event(h.canvas, "pointermove", { pointerId: 1, pointerType: "touch", clientX: 250, clientY: 370 });
    } else h.event(h.win, "keydown", { key: control, repeat: false });
    // Input alone, before an active simulation step, never dismisses.
    expect(moved).toEqual([]); h.tick(17);
    expect(moved).toEqual([h.session.view.token]);
    const atDismissal = checks;
    h.tick(34); h.tick(51); h.session.start(); h.tick(68); h.tick(85);
    expect(moved).toHaveLength(1); expect(checks).toBe(atDismissal);
  } finally { h.cleanup(); }
});

test("stationary targets, unrelated keys, touch-down, dead zone, ignored fingers, resize and paused frames preserve the hint", () => {
  const moved: number[] = [];
  const h = harness(false, { pending: () => true, moved: token => moved.push(token) });
  try {
    h.tick(0);
    h.event(h.win, "keydown", { key: "q", repeat: false }); h.tick(17);
    h.event(h.canvas, "pointermove", { pointerId: 1, pointerType: "mouse", clientX: 205, clientY: 370 }); h.tick(34);
    h.event(h.canvas, "pointerdown", { pointerId: 2, pointerType: "touch", button: 0, clientX: 200, clientY: 370 }); h.tick(51);
    h.event(h.canvas, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 202, clientY: 370 }); h.tick(68);
    h.event(h.canvas, "pointermove", { pointerId: 3, pointerType: "touch", clientX: 300, clientY: 370 }); h.tick(85);
    h.resize(844, 280); h.tick(102); h.tick(119);
    h.doc.hidden = true; h.event(h.doc, "visibilitychange", {});
    h.event(h.win, "keydown", { key: "d", repeat: false }); h.tick(136);
    expect(moved).toEqual([]);
  } finally { h.cleanup(); }
});

test("an expired or replaced hint removes movement observation before stepping", () => {
  let checks = 0;
  const h = harness(false, { pending: () => { checks++; return false; }, moved: () => { throw Error("expired hint"); } });
  try {
    h.tick(0); h.event(h.win, "keydown", { key: "d", repeat: false }); h.tick(17); h.tick(34);
    expect(checks).toBe(1); expect(h.session.current!.simulation.robot.x).toBeGreaterThan(300);
  } finally { h.cleanup(); }
});

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
    h.time.advance(RESTART_GUARD_MS);
    h.event(h.win, "keydown", { key: " ", repeat: false });
    expect(h.session.current!.simulation.arena).toEqual({ width: 800, height: 450 });
    h.tick(51); h.session.current!.simulation.dead = true; h.tick(68);
    h.win.innerWidth = 390; h.win.innerHeight = 844; h.time.advance(RESTART_GUARD_MS);
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
    h.tick(51); expect(h.session.current!.simulation.robot.x).toBeCloseTo(300);
    h.event(h.canvas, "pointermove", { pointerId: 2, pointerType: "touch", clientX: -50, clientY: 370 });
    h.tick(68); expect(h.session.current!.simulation.robot.x).toBeLessThan(300);
    h.event(h.canvas, "pointercancel", { pointerId: 2 }); expect(h.captures.size).toBe(0);
    const x = h.session.current!.simulation.robot.x; h.tick(85); expect(h.session.current!.simulation.robot.x).toBe(x);
    h.event(h.win, "keydown", { key: "d", repeat: false }); h.event(h.win, "blur", {}); h.tick(102); h.tick(119);
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

test("F reports changing bug/effect readings, ignores repeats and resets effects on restart", () => {
  const draw = spyOn(Renderer.prototype, "draw"), h = harness();
  const reading = (text: string | undefined, label: string, value: number) =>
    expect(text).toMatch(new RegExp(`\\b(?:${value}[\\s:=()]+${label}|${label}[\\s:=()]+${value})\\b`, "i"));
  try {
    const s = h.session.current!.simulation; s.spawnIn = s.fireIn = Infinity;
    h.tick(0); h.tick(1000); expect(h.readouts).toHaveLength(0);
    const fx = draw.mock.calls.at(-1)![1];
    s.bugs.push({ id: 1, kind: "base", x: 10, y: 10 }, { id: 2, kind: "fast", x: 590, y: 590 });
    fx.labels.emit(0, 0, 0, 0, 10);
    h.event(h.win, "keydown", { key: "f", repeat: false });
    h.event(h.win, "keydown", { key: "f", repeat: true });
    h.tick(2000);
    expect(h.readouts).toHaveLength(1);
    expect(h.readouts[0]).toMatch(/\bFPS\b/);
    reading(h.readouts[0], "bugs", s.bugs.length); reading(h.readouts[0], "effects", fx.liveCount);
    s.bugs.pop(); fx.labels.emit(0, 0, 0, 0, 10);
    h.tick(3000);
    expect(h.readouts).toHaveLength(2);
    reading(h.readouts[1], "bugs", s.bugs.length); reading(h.readouts[1], "effects", fx.liveCount);
    h.session.start(); h.tick(4000);
    h.session.current!.simulation.spawnIn = h.session.current!.simulation.fireIn = Infinity;
    h.tick(5000);
    reading(h.readouts.at(-1), "bugs", 0); reading(h.readouts.at(-1), "effects", 0);
    h.event(h.win, "keydown", { key: "f", repeat: false });
    const count = h.readouts.length;
    h.event(h.win, "keydown", { key: "f", repeat: true }); h.tick(6000); h.tick(7000);
    expect(h.readouts).toHaveLength(count);
  } finally { h.cleanup(); draw.mockRestore(); }
});
test("held keys cannot restart at death; a fresh key or touch after the guard starts a clean run", () => {
  const h = harness();
  try {
    h.tick(0); h.event(h.win, "keydown", { key: "d", repeat: false });
    h.session.current!.simulation.dead = true; h.tick(17); const dead = h.session.current;
    h.event(h.win, "keydown", { key: "d", repeat: true }); expect(h.session.current).toBe(dead);
    h.event(h.win, "keydown", { key: "d", repeat: false }); expect(h.session.current).toBe(dead);
    h.time.advance(RESTART_GUARD_MS);
    h.event(h.win, "keyup", { key: "d" }); h.event(h.win, "keydown", { key: "d", repeat: false });
    expect(h.session.current).not.toBe(dead); h.tick(34); h.tick(51);
    expect(h.session.current!.simulation.robot.x).toBeGreaterThan(300);
    h.session.current!.simulation.dead = true; h.tick(68); h.time.advance(RESTART_GUARD_MS);
    h.event(h.canvas, "pointerdown", { pointerId: 2, pointerType: "touch", button: 0, clientX: 390, clientY: 370 });
    expect(h.session.view.over).toBe(false); expect(h.session.current!.touch).toBe(true); h.tick(85); h.tick(102);
    expect(h.session.current!.simulation.robot.x).toBe(300);
    h.event(h.canvas, "pointermove", { pointerId: 2, pointerType: "touch", clientX: 450, clientY: 370 }); h.tick(119);
    expect(h.session.current!.simulation.robot.x).toBeGreaterThan(300);
  } finally { h.cleanup(); }
});

test("visibility drops hidden elapsed time and DPR resize updates canvas dimensions without resetting the run", () => {
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
  const tickAndReadEffects = (timestamp: number) => {
    draw.mockClear();
    h.tick(timestamp);
    // A retained Effects reference can advance even when the canvas isn't drawn.
    expect(draw).toHaveBeenCalledTimes(1);
    return draw.mock.calls[0]![1];
  };
  try {
    const state = h.session.current!.simulation; state.spawnIn = state.fireIn = 100;
    h.tick(0); h.event(h.win, "keydown", { key: "d", repeat: false });
    expect(tickAndReadEffects(17).trails.count).toBeGreaterThan(0);
    h.event(h.win, "keyup", { key: "d" });
    state.hits = 2;
    state.bugs.push({ id: 1, kind: "base", x: 100, y: 300 }, { id: 2, kind: "base", x: state.robot.x, y: state.robot.y });
    state.shots.push({ x: 100, y: 300, vx: 1, vy: 0, life: 1 });
    const fx = tickAndReadEffects(34), labelY = fx.labels.y[0]!, particleX = fx.particles.x[0]!, particleY = fx.particles.y[0]!, life = fx.labels.life[0]!;
    expect(state.squashes).toBe(1); expect(state.hits).toBe(3); expect(h.session.view.over).toBe(true);
    expect(fx.labels.count).toBe(1); expect(fx.particles.count).toBeGreaterThan(0);
    expect(fx.flash).toBeGreaterThan(0); expect(Math.hypot(fx.shake.x, fx.shake.y)).toBeGreaterThan(0);
    const advanced = tickAndReadEffects(51);
    expect(advanced).toBe(fx); expect(advanced.labels.y[0]!).toBeLessThan(labelY);
    expect(Math.hypot(advanced.particles.x[0]! - particleX, advanced.particles.y[0]! - particleY)).toBeGreaterThan(0);
    expect(advanced.labels.life[0]!).toBeLessThan(life);
    expect(advanced.flash).toBeLessThan(0.1);
    let latest = advanced;
    for (let frame = 0; frame < 45; frame++) latest = tickAndReadEffects(68 + frame * 17);
    expect(latest.trails.count).toBe(0); expect(latest.labels.count).toBe(0); expect(latest.particles.count).toBe(0);
    expect(latest.flash).toBe(0); expect(latest.shake.remaining).toBe(0);
  } finally { h.cleanup(); draw.mockRestore(); }
});

test("choice releases steering/capture, freezes visuals, requires fresh numeric keys and resumes without catch-up", () => {
  const draw = spyOn(Renderer.prototype, "draw"), h = harness();
  try {
    const s = h.session.current!.simulation; s.spawnIn = s.fireIn = Infinity; s.time = 19.99;
    h.tick(0);
    h.event(h.canvas, "pointerdown", { pointerId: 7, pointerType: "mouse", button: 0, clientX: 380, clientY: 370 });
    h.event(h.win, "keydown", { key: "d", repeat: false });
    h.event(h.win, "keydown", { key: "1", repeat: false });
    h.tick(17); expect(h.session.view.choice).not.toBeNull(); expect(h.captures.size).toBe(0);
    const frozen = structuredClone(s), fx = draw.mock.calls.at(-1)![1], visualTime = fx.time;
    h.event(h.win, "keydown", { key: "f", repeat: false });
    // Choice entry resets sampling; the first tick seeds it, the second completes it.
    h.tick(300000); h.tick(301000); expect(s).toEqual(frozen); expect(fx.time).toBe(visualTime);
    expect(h.readouts).toHaveLength(0);
    h.event(h.win, "keydown", { key: "1", repeat: true }); expect(h.session.view.choice).not.toBeNull();
    h.event(h.win, "keydown", { key: "1", repeat: false }); expect(h.session.view.choice).not.toBeNull();
    h.event(h.win, "keyup", { key: "1" });
    h.event(h.win, "blur", {}); h.resize(844, 280);
    expect(h.session.view.choice).not.toBeNull(); expect(s).toEqual(frozen);
    h.event(h.win, "keydown", { key: "d", repeat: false });
    const chosen = h.event(h.win, "keydown", { key: "1", repeat: false });
    expect(chosen.defaultPrevented).toBe(true); expect(h.session.view.choice).toBeNull();
    const robot = { ...s.robot };
    h.event(h.win, "keydown", { key: "d", repeat: true });
    h.tick(600000); expect(s.time).toBe(20); h.tick(600017);
    expect(s.time).toBeCloseTo(20 + 1 / 60); expect(s.robot).toEqual(robot);
    expect(h.session.view.upgrades.reduce((sum, item) => sum + item.count, 0)).toBe(1);
  } finally { h.cleanup(); draw.mockRestore(); }
});

test("shield flash, bomb and merged labels freeze through choices, resume without catch-up, decay after death and reset on focus/restart", () => {
  const draw = spyOn(Renderer.prototype, "draw"), h = harness();
  try {
    const s = h.session.current!.simulation; s.spawnIn = s.fireIn = Infinity;
    h.tick(0); const fx = draw.mock.calls.at(-1)![1];
    fx.block(); fx.bomb(100, 100, 850); fx.squash(100, 100); fx.squash(110, 100);
    expect(fx.labels.total[0]).toBe(20);
    s.time = 19.99; h.tick(17); expect(h.session.view.choice).not.toBeNull();
    const flash = fx.shieldFlash, ring = fx.ring.life, label = fx.labels.life[0];
    h.tick(60000); expect(fx.shieldFlash).toBe(flash); expect(fx.ring.life).toBe(ring); expect(fx.labels.life[0]).toBe(label);
    h.event(h.win, "keydown", { key: "1", repeat: false });
    h.tick(120000); expect(fx.shieldFlash).toBe(flash); expect(fx.ring.life).toBe(ring);
    h.tick(120017); expect(fx.shieldFlash).toBeLessThan(flash); expect(fx.ring.life).toBeLessThan(ring);
    s.dead = true; h.tick(120034);
    for (let i = 0; i < 50; i++) h.tick(120051 + i * 17);
    expect(fx.shieldFlash).toBe(0); expect(fx.ring.life).toBe(0); expect(fx.labels.count).toBe(0);
    fx.block(); fx.bomb(100, 100, 850); fx.squash(100, 100);
    h.event(h.win, "blur", {}); expect(fx.liveCount).toBe(0); expect(fx.labels.total.every(n => n === 0)).toBe(true);
    fx.block(); fx.bomb(100, 100, 850); h.session.start(); h.tick(122000);
    expect(fx.liveCount).toBe(0); expect(fx.shieldFlash).toBe(0);
  } finally { h.cleanup(); draw.mockRestore(); }
});

test.each([1, 2, 3])("fresh numeric key %i selects exactly its offered card", number => {
  const h = harness();
  try {
    const s = h.session.current!.simulation; s.time = 19.99; s.spawnIn = s.fireIn = Infinity;
    h.tick(0); h.tick(17);
    const id = h.session.view.choice!.offer[number - 1]!; h.time.advance(CHOICE_GUARD_MS);
    h.event(h.win, "keydown", { key: String(number), repeat: false });
    expect(h.session.view.choice).toBeNull(); expect(h.session.view.upgrades).toEqual([{ id, count: 1 }]);
    expect(s.time).toBe(20);
  } finally { h.cleanup(); }
});

test("touch wiring uses CSS displacement, ignores other fingers/mouse, and yields to nonzero keys", () => {
  const draw = spyOn(Renderer.prototype, "draw"), h = harness(true);
  const pointer = (type: string, id: number, x = 100, y = 600, pointerType = "touch") =>
    h.event(h.canvas, type, { pointerId: id, pointerType, button: 0, clientX: x, clientY: y });
  try {
    const s = h.session.current!.simulation; s.spawnIn = s.fireIn = Infinity;
    h.tick(0); pointer("pointermove", 1, 390, 400, "mouse");
    pointer("pointerdown", 2); h.tick(17);
    expect(s.robot).toEqual({ x: 225, y: 400 });
    expect(draw.mock.calls.at(-1)![2]).toEqual({ x: 90, y: 580, dx: 0, dy: 0 });
    pointer("pointermove", 2, 133); h.tick(34);
    const half = s.robot.x - 225; expect(half).toBeCloseTo(ROBOT_SPEED / 120);
    for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"]) pointer(type, 3, -100, -100);
    pointer("pointermove", 1, 0, 0, "mouse"); h.tick(51);
    expect(s.robot.x - 225).toBeCloseTo(half * 2); expect(h.captures.has(2)).toBe(true);
    h.event(h.win, "keydown", { key: "a", repeat: false }); h.tick(68);
    expect(s.robot.x).toBeCloseTo(225);
    h.event(h.win, "keydown", { key: "d", repeat: false }); h.tick(85);
    expect(s.robot.x).toBeCloseTo(225 + half); // opposing keys cancel, touch resumes
    h.event(h.win, "keyup", { key: "a" }); h.event(h.win, "keyup", { key: "d" });
    pointer("pointermove", 2, -200); h.tick(102); // captured outside the canvas, never arena-clamped
    expect(s.robot.x).toBeCloseTo(225 - half);
    expect(draw.mock.calls.at(-1)![2]).toEqual({ x: 90, y: 580, dx: -60, dy: 0 });
    pointer("pointermove", 2); h.tick(119); expect(s.robot.x).toBeCloseTo(225 - half);
    pointer("pointerup", 2); pointer("pointermove", 3, 300); pointer("pointermove", 2, 300); h.tick(136);
    expect(s.robot.x).toBeCloseTo(225 - half); expect(draw.mock.calls.at(-1)![2]).toBeNull();
    pointer("pointermove", 1, 390, 370, "mouse"); h.tick(153);
    expect(s.robot.x).toBeGreaterThan(225 - half);
  } finally { h.cleanup(); draw.mockRestore(); }
});

test.each(["pointerup", "pointercancel", "lostpointercapture", "blur", "visibility", "resize", "token", "choice", "death"])(
  "%s clears touch/capture/visual and delayed moves cannot revive it", reset => {
    const draw = spyOn(Renderer.prototype, "draw"), h = harness();
    const pointer = (type: string, x = 100) => h.event(h.canvas, type, { pointerId: 2, pointerType: "touch", button: 0, clientX: x, clientY: 600 });
    try {
      let s = h.session.current!.simulation; s.spawnIn = s.fireIn = Infinity;
      h.tick(0); pointer("pointerdown"); pointer("pointermove", 160); h.tick(17);
      expect(draw.mock.calls.at(-1)![2]).not.toBeNull();
      if (reset.startsWith("pointer") || reset === "lostpointercapture") pointer(reset);
      else if (reset === "blur") h.event(h.win, "blur", {});
      else if (reset === "visibility") h.event(h.doc, "visibilitychange", {});
      else if (reset === "resize") h.resize(844, 390);
      else if (reset === "token") { h.session.start(); s = h.session.current!.simulation; }
      else if (reset === "death") { s.dead = true; h.tick(34); }
      else {
        s.time = 19.99; h.tick(34);
        expect(h.session.view.choice).not.toBeNull(); expect(draw.mock.calls.at(-1)![2]).toBeNull();
        const choice = h.session.view.choice!;
        h.time.advance(CHOICE_GUARD_MS);
        h.session.choose(h.session.view.token, choice.number, choice.offer[0]!);
      }
      expect(h.captures.size).toBe(0);
      const robot = { ...s.robot };
      pointer("pointermove", 300); h.tick(51); h.tick(68);
      expect(s.robot).toEqual(robot); expect(draw.mock.calls.at(-1)![2]).toBeNull();
      if (reset !== "death") {
        pointer("pointerdown"); h.tick(85); expect(s.robot).toEqual(robot);
        pointer("pointermove", 160); h.tick(102); expect(s.robot.x).toBeGreaterThan(robot.x);
      }
    } finally { h.cleanup(); draw.mockRestore(); }
  });

test("unmount releases an active touch and detaches its listeners", () => {
  const h = harness();
  h.event(h.canvas, "pointerdown", { pointerId: 2, pointerType: "touch", button: 0, clientX: 100, clientY: 600 });
  expect(h.captures.has(2)).toBe(true); h.cleanup();
  h.event(h.canvas, "pointerdown", { pointerId: 3, pointerType: "touch", button: 0, clientX: 100, clientY: 600 });
  expect(h.captures.size).toBe(0);
});

test("early canvas taps never capture or attribute touch; holding an early restart key cannot cross the deadline", () => {
  const h = harness();
  try {
    h.tick(0); h.session.current!.simulation.dead = true; h.tick(17);
    const run = h.session.current!, token = run.token;
    const down = () => h.event(h.canvas, "pointerdown", { pointerId: 9, pointerType: "touch", button: 0, clientX: 100, clientY: 100 });
    down(); expect(h.captures.size).toBe(0); expect(run.touch).toBe(false);
    const early = h.event(h.win, "keydown", { key: "Enter", repeat: false }); expect(early.defaultPrevented).toBe(true);
    h.time.advance(799); down(); expect(h.session.view.token).toBe(token);
    h.time.advance(1);
    h.event(h.canvas, "pointerup", { pointerId: 9 });
    h.event(h.win, "keydown", { key: "Enter", repeat: true });
    h.event(h.win, "keydown", { key: "Enter", repeat: false });
    expect(h.session.current).toBe(run);
    h.event(h.win, "keyup", { key: "Enter" });
    h.event(h.win, "keydown", { key: "Enter", repeat: false });
    expect(h.session.view.token).toBe(token + 1);
    h.session.end(); h.time.advance(800); down();
    expect(h.captures.has(9)).toBe(true); expect(h.session.current!.touch).toBe(true);
  } finally { h.cleanup(); }
});

test.each(["1", "2", "3"])("early numeric %s is rejected through release, even when readiness changes", key => {
  const h = harness();
  try {
    const s = h.session.current!.simulation; s.time = 19.99; s.spawnIn = s.fireIn = Infinity;
    h.tick(0); h.tick(17); const choice = h.session.view.choice!;
    h.event(h.win, "keydown", { key, repeat: false }); expect(h.session.view.choice).toBe(choice);
    h.event(h.win, "keyup", { key }); h.time.advance(349);
    h.event(h.win, "keydown", { key, repeat: false }); expect(h.session.view.choice).toBe(choice);
    h.time.advance(1);
    for (const repeat of [true, false]) h.event(h.win, "keydown", { key, repeat });
    expect(h.session.view.choice).toBe(choice); expect(s.time).toBe(20);
    h.event(h.win, "keyup", { key }); h.event(h.win, "keydown", { key, repeat: false });
    expect(h.session.view.choice).toBeNull();
    expect(h.session.view.upgrades).toEqual([{ id: choice.offer[Number(key) - 1]!, count: 1 }]);
  } finally { h.cleanup(); }
});
