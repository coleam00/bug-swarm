import { expect, test } from "bun:test";
import { BUG_RADIUS, ROBOT_RADIUS, SPAWN_INTERVAL, STEP } from "./config";
import { createSimulation, IDLE, nearestBug, spawnBug, step } from "./simulation";

test.each([1, 42, 12345])("seed %i is reproducible and an idle robot loses in 30–60 seconds", (seed) => {
  const a = createSimulation(seed), b = createSimulation(seed);
  while (!a.dead && a.time < 90) { step(a, IDLE, STEP); step(b, IDLE, STEP); }
  expect(a).toEqual(b);
  expect(a.time).toBeGreaterThanOrEqual(30); expect(a.time).toBeLessThanOrEqual(60);
  expect(a.hits).toBe(3); expect(a.score).toBe(a.squashes * 10 + Math.floor(a.time));
  const frozen = structuredClone(a); step(a, IDLE, STEP); expect(a).toEqual(frozen);
});
test("steady edge spawning and chasing", () => {
  const s = createSimulation(1);
  for (let i = 0; i < 20; i++) spawnBug(s);
  expect(s.bugs.every((b) => b.x === 0 || b.x === 600 || b.y === 0 || b.y === 600)).toBe(true);
  s.bugs = [{ id: 1, x: 0, y: 300 }];
  step(s, IDLE, STEP); expect(s.bugs[0]!.x).toBeGreaterThan(0);
  s.bugs = []; s.fireIn = 100;
  for (let i = 1; i < 48 * 4; i++) step(s, IDLE, STEP);
  expect(s.nextId).toBe(1 + 20 + Math.floor((s.time + 1e-9) / SPAWN_INTERVAL));
});
test("diagonals normalize, target stops without overshoot, robot stays inside arena", () => {
  const a = createSimulation(1), b = createSimulation(1);
  step(a, { x: 1, y: 1, target: null }, STEP); step(b, { x: 1, y: 0, target: null }, STEP);
  expect(Math.hypot(a.robot.x - 300, a.robot.y - 300)).toBeCloseTo(b.robot.x - 300);
  step(a, { x: 0, y: 0, target: { x: 301, y: 301 } }, STEP); expect(a.robot).toEqual({ x: 301, y: 301 });
  for (let i = 0; i < 300; i++) step(a, { x: 1, y: 1, target: null }, STEP);
  expect(a.robot).toEqual({ x: 600 - ROBOT_RADIUS, y: 600 - ROBOT_RADIUS });
});
test("nearest targeting uses stable ids; a swept shot kills once and awards ten", () => {
  const s = createSimulation(1);
  s.bugs = [{ id: 2, x: 350, y: 300 }, { id: 1, x: 250, y: 300 }];
  expect(nearestBug(s)!.id).toBe(1);
  s.fireIn = 0; step(s, IDLE, STEP); expect(s.shots[0]!.vx).toBeLessThan(0);
  s.bugs = [{ id: 3, x: 400, y: 300 }];
  s.shots = [{ x: 350, y: 300, vx: 10000, vy: 0, life: 3 }];
  step(s, IDLE, STEP); expect(s.squashes).toBe(1); expect(s.score).toBe(10); expect(s.shots).toHaveLength(0);
  step(s, IDLE, STEP); expect(s.squashes).toBe(1);
});
test("contact consumes three hits with invulnerability, no squash credit, and seconds score", () => {
  const s = createSimulation(1); s.fireIn = 100; s.spawnIn = 100;
  s.bugs = [{ id: 1, x: 300, y: 300 }, { id: 2, x: 300 + BUG_RADIUS, y: 300 }];
  step(s, IDLE, STEP); expect(s.hits).toBe(1); expect(s.squashes).toBe(0);
  s.bugs.push({ id: 3, x: 300, y: 300 }); step(s, IDLE, STEP); expect(s.hits).toBe(1);
  for (let i = 0; i < 61; i++) step(s, IDLE, STEP);
  expect(s.seconds).toBe(1); expect(s.score).toBe(1);
  s.bugs.push({ id: 4, x: 300, y: 300 }); step(s, IDLE, STEP); expect(s.hits).toBe(2);
  for (let i = 0; i < 61; i++) step(s, IDLE, STEP);
  s.bugs.push({ id: 5, x: 300, y: 300 }); step(s, IDLE, STEP); expect(s.dead).toBe(true);
});
test("shots expire, even if they never find a bug", () => {
  const s = createSimulation(1); s.fireIn = 100; s.spawnIn = 100;
  s.shots.push({ x: 0, y: 0, vx: 1, vy: 0, life: STEP }); step(s, IDLE, STEP);
  expect(s.shots).toHaveLength(0);
});
