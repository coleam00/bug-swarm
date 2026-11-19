import { expect, test } from "bun:test";
import { arenaForViewport } from "./arena";
import { ARENA_AREA, ROBOT_RADIUS, STEP } from "./config";
import { createSimulation, spawnBug, step } from "./simulation";

test("arena preserves area and clamps aspect, with a square fallback for invalid viewports", () => {
  expect(arenaForViewport(390, 844)).toEqual({ width: 450, height: 800 });
  expect(arenaForViewport(844, 390)).toEqual({ width: 800, height: 450 });
  const middle = arenaForViewport(600, 800);
  expect(middle.width / middle.height).toBeCloseTo(0.75);
  for (const [w, h] of [[390, 844], [844, 390], [600, 800], [0, 844], [-1, 4], [NaN, 5], [1, Infinity]]) {
    const arena = arenaForViewport(w!, h!);
    expect(arena.width * arena.height).toBeCloseTo(ARENA_AREA);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w! <= 0 || h! <= 0) expect(arena).toEqual({ width: 600, height: 600 });
  }
});

test.each([[390, 844], [844, 390]])("%i x %i run centers, spawns on all edges and clamps all robot bounds", (w, h) => {
  const supplied = { ...arenaForViewport(w, h) }, s = createSimulation(42, supplied);
  const { width, height } = s.arena;
  expect(s.robot).toEqual({ x: width / 2, y: height / 2 });
  supplied.width = 1; expect(s.arena.width).toBe(width);
  expect(Object.isFrozen(s.arena)).toBe(true);
  for (let i = 0; i < 200; i++) spawnBug(s);
  expect(s.bugs.every((b) => b.x >= 0 && b.x <= width && b.y >= 0 && b.y <= height &&
    (b.x === 0 || b.x === width || b.y === 0 || b.y === height))).toBe(true);
  for (const edge of [(b: { x: number; y: number }) => b.x === 0, (b: { x: number; y: number }) => b.x === width,
    (b: { x: number; y: number }) => b.y === 0, (b: { x: number; y: number }) => b.y === height]) expect(s.bugs.some(edge)).toBe(true);
  s.bugs = []; s.spawnIn = Infinity;
  for (const direction of [-1, 1]) {
    for (let i = 0; i < 400; i++) step(s, { x: direction, y: direction, target: null }, STEP);
    expect(s.robot).toEqual({ x: direction < 0 ? ROBOT_RADIUS : width - ROBOT_RADIUS,
      y: direction < 0 ? ROBOT_RADIUS : height - ROBOT_RADIUS });
  }
});
