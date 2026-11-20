import { expect, test } from "bun:test";
import { mountStartScene } from "./StartScene";
import { canvasFixture } from "../game/canvas-fixture.test-support";

test("decorative scene resizes, pauses, honours reduced motion, and releases everything across effect replay", () => {
  const globals = ["window", "document", "matchMedia", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"] as const;
  const previous = globals.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  const fixture = canvasFixture();
  const ctx = Object.assign(fixture.context, { clearRect() {} });
  let width = 400, height = 240, next = 0, disconnected = 0, resized = () => {};
  const canvas = { width: 0, height: 0, getContext: () => ctx,
    getBoundingClientRect: () => ({ width, height }) } as unknown as HTMLCanvasElement;
  const frames = new Map<number, FrameRequestCallback>();
  const doc = Object.assign(new EventTarget(), { hidden: false, createElement: fixture.factory });
  const motion = Object.assign(new EventTarget(), { matches: false });
  const win = Object.assign(new EventTarget(), { devicePixelRatio: 2 });
  Object.assign(globalThis, { document: doc, window: win, matchMedia: () => motion,
    requestAnimationFrame: (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class { constructor(fn: () => void) { resized = fn; } observe() {} disconnect() { disconnected++; } },
  });
  const tick = (now: number) => { const [id, fn] = [...frames][0]!; frames.delete(id); fn(now); };
  try {
    for (let replay = 0; replay < 2; replay++) {
      const dispose = mountStartScene(canvas);
      expect(canvas.width).toBe(width * 2); expect(canvas.height).toBe(height * 2);
      expect(frames.size).toBe(1); expect(fixture.depth).toBe(0);
      const paints = ctx.paints.length; tick(100); tick(116);
      expect(ctx.paints.length).toBeGreaterThan(paints);
      doc.hidden = true; doc.dispatchEvent(new Event("visibilitychange"));
      expect(frames.size).toBe(0);
      doc.hidden = false; doc.dispatchEvent(new Event("visibilitychange")); expect(frames.size).toBe(1);
      motion.matches = true; motion.dispatchEvent(new Event("change")); expect(frames.size).toBe(0);
      width = 320; height = 192; resized(); expect(canvas.width).toBe(640); expect(canvas.height).toBe(384);
      motion.matches = false; motion.dispatchEvent(new Event("change")); expect(frames.size).toBe(1);
      dispose(); expect(frames.size).toBe(0); expect(canvas.width).toBe(0);
      expect(fixture.surfaces.every(({ canvas }) => canvas.width === 0 && canvas.height === 0)).toBe(true);
      const end = ctx.paints.length;
      doc.dispatchEvent(new Event("visibilitychange")); motion.dispatchEvent(new Event("change")); win.dispatchEvent(new Event("resize")); resized();
      expect(ctx.paints.length).toBe(end); expect(frames.size).toBe(0);
    }
    expect(disconnected).toBe(2);
    motion.matches = true;
    const dispose = mountStartScene(canvas); expect(frames.size).toBe(0);
    expect(canvas.width).toBeGreaterThan(0); dispose();
  } finally {
    globals.forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
