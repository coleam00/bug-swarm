import { expect, test } from "bun:test";
import { Renderer } from "./draw";
import { Effects } from "./fx";
import { createSimulation } from "./simulation";
import { canvasFixture } from "./canvas-fixture.test-support";

test("renderer caches procedural art across frames, rebuilds on resize, balances context and disposes stores", () => {
  const fixture = canvasFixture(), canvases: HTMLCanvasElement[] = [];
  const renderer = new Renderer(fixture.context as unknown as CanvasRenderingContext2D, () => {
    const canvas = fixture.factory(); canvases.push(canvas); return canvas;
  });
  const state = createSimulation(1), fx = new Effects();
  state.bugs.push({ id: 1, x: 100, y: 100 }); state.shots.push({ x: 300, y: 300, vx: 420, vy: 0, life: 1 });
  fx.squash(2, 2); fx.squash(599, 599); fx.hit(); fx.trails.movement(300, 300, true, 1);
  renderer.resize(390, 700, 2); expect(fixture.created).toBe(6);
  for (let i = 0; i < 100; i++) renderer.draw(state, fx);
  expect(fixture.created).toBe(6); expect(fixture.depth).toBe(0); expect(fixture.draws).toBeGreaterThan(100);
  expect("shadowBlur" in fixture.context).toBe(false);
  renderer.resize(390, 700, 2); expect(fixture.created).toBe(6);
  renderer.resize(700, 390, 1); expect(fixture.created).toBe(12);
  expect(canvases.slice(0, 6).every((c) => c.width === 0)).toBe(true);
  renderer.dispose(); expect(canvases.every((c) => c.width === 0)).toBe(true);
});
