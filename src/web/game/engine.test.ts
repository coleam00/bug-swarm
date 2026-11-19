import { expect, test } from "bun:test";
import { mountGame } from "./engine";
import { Session } from "./session";
import { canvasFixture } from "./canvas-fixture.test-support";

function harness() {
  const names = ["window", "document", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"] as const;
  const previous = names.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const fixture = canvasFixture();
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { hidden: false, createElement: fixture.factory });
  let callback: FrameRequestCallback | undefined, cancelled = 0, disconnected = false;
  const captures = new Set<number>();
  const context = fixture.context;
  const canvas = Object.assign(new EventTarget(), {
    width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => ({ left: 10, top: 20, width: 390, height: 700 }),
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id),
  });
  const replacements = [win, doc, class { observe() {} disconnect() { disconnected = true; } }, (cb: FrameRequestCallback) => { callback = cb; return 1; }, () => { cancelled++; }];
  names.forEach((key, i) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: replacements[i] }));
  const session = new Session({ playerId: crypto.randomUUID(), name: "Robot" }, {
    start: async () => ({ runId: "test-run" }), finish: async () => ({ saved: true }), best: async () => ({ best: null }), leaders: async () => [],
  }, () => 1);
  session.start();
  const readouts: string[] = [];
  const unmount = mountGame(canvas as unknown as HTMLCanvasElement, session, () => {}, (text) => readouts.push(text));
  function event(target: EventTarget, type: string, props: Record<string, unknown>) {
    const value = Object.assign(new Event(type, { cancelable: true }), props); target.dispatchEvent(value); return value;
  }
  return { session, canvas, win, doc, captures, event, readouts, tick: (time: number) => callback!(time),
    cleanup() {
      unmount(); expect(cancelled).toBe(1); expect(disconnected).toBe(true); expect(captures.size).toBe(0);
      names.forEach((key, i) => { const descriptor = previous[i]; if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    } };
}
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
