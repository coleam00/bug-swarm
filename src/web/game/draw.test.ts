import { expect, test } from "bun:test";
import { draw } from "./draw";
import { BUG_KINDS } from "./config";
import { createSimulation } from "./simulation";

function recordingContext() {
  const rectangles: { x: number; y: number; width: number; height: number }[] = [];
  const circles: { x: number; y: number; radius: number; color: string }[] = [];
  let sx = 1, sy = 1, tx = 0, ty = 0;
  const stack: number[][] = [];
  let circle = { x: 0, y: 0, radius: 0 };
  const context = {
    fillStyle: "",
    save() { stack.push([sx, sy, tx, ty]); },
    restore() { [sx, sy, tx, ty] = stack.pop()! as [number, number, number, number]; },
    translate(x: number, y: number) { tx += sx * x; ty += sy * y; },
    scale(x: number, y: number) { sx *= x; sy *= y; },
    fillRect(x: number, y: number, width: number, height: number) {
      rectangles.push({ x: tx + x * sx, y: ty + y * sy, width: width * sx, height: height * sy });
    },
    beginPath() {},
    arc(x: number, y: number, radius: number) { circle = { x: tx + x * sx, y: ty + y * sy, radius: radius * sx }; },
    fill() { circles.push({ ...circle, color: this.fillStyle }); },
  };
  return { context: context as unknown as CanvasRenderingContext2D, rectangles, circles };
}

test.each([
  { arena: { width: 450, height: 800 }, screen: [390, 844], bounds: [0, 226 / 3, 390, 2080 / 3] },
  { arena: { width: 800, height: 450 }, screen: [844, 390], bounds: [226 / 3, 0, 2080 / 3, 390] },
  { arena: { width: 450, height: 800 }, screen: [844, 390], bounds: [312.3125, 0, 219.375, 390] },
])("draw fits $arena to $screen, preserving the run's shape", ({ arena, screen, bounds }) => {
  const { context, rectangles } = recordingContext();
  draw(context, createSimulation(1, arena), screen[0]!, screen[1]!);
  // Expected pixel bounds are independent of viewport(), including a rotated run.
  const floor = rectangles[1]!;
  for (const [i, value] of [floor.x, floor.y, floor.width, floor.height].entries()) expect(value).toBeCloseTo(bounds[i]!, 6);
});

test("fast bugs are drawn smaller and with a different fill colour than base bugs", () => {
  const state = createSimulation(1), { context, circles } = recordingContext();
  state.bugs = [{ id: 1, kind: BUG_KINDS[0].id, x: 100, y: 100 }, { id: 2, kind: BUG_KINDS[1].id, x: 200, y: 100 }];
  draw(context, state, 600, 600);
  const base = circles.find((circle) => circle.x === 100 && circle.y === 100)!;
  const fast = circles.find((circle) => circle.x === 200 && circle.y === 100)!;
  expect(fast.radius).toBeLessThan(base.radius);
  expect(fast.color).not.toBe(base.color);
});
