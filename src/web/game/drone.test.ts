import { expect, test } from "bun:test";
import { CI_DRONE, REVIEW_LASER } from "../../shared/upgrades";
import { createSimulation, dronePosition, IDLE, nearestBug, step } from "./simulation";
import { pick } from "./upgrade-fixture.test-support";
import { openChoice } from "./upgrades";

test("drone orbit is deterministic, evenly spaced, and acquisition preserves existing cooldowns", () => {
  const s = createSimulation(1); s.spawnIn = s.fireIn = Infinity;
  pick(s, CI_DRONE);
  const p = { x: 0, y: 0 }; dronePosition(s, 0, p);
  expect(p).toEqual({ x: 336, y: 300 });
  s.time = Math.PI / 4; dronePosition(s, 0, p);
  expect(p.x).toBeCloseTo(300); expect(p.y).toBeCloseTo(336);
  s.drones[0]!.fireIn = 0.4; pick(s, CI_DRONE);
  expect(s.drones.map(d => d.fireIn)).toEqual([0.4, 0]);
  dronePosition(s, 1, p); expect(p.x).toBeCloseTo(300); expect(p.y).toBeCloseTo(264);
  pick(s, CI_DRONE); expect(s.drones).toHaveLength(3);
  const positions = s.drones.map((_, i) => { const p = { x: 0, y: 0 }; dronePosition(s, i, p); return p; });
  for (const p of positions) expect(Math.hypot(p.x - 300, p.y - 300)).toBeCloseTo(36);
  expect(Math.hypot(positions[0]!.x - positions[1]!.x, positions[0]!.y - positions[1]!.y)).toBeCloseTo(Math.sqrt(3) * 36);
});

test("drones target independently from their own position, share laser budgets, and pause with the run", () => {
  const s = createSimulation(1); s.spawnIn = s.fireIn = Infinity;
  pick(s, CI_DRONE); pick(s, CI_DRONE); pick(s, REVIEW_LASER);
  s.fireIn = Infinity; // Isolate drone cadence after laser acquisition clamps robot readiness.
  s.bugs = [{ id: 2, kind: "base", x: 440, y: 300 }, { id: 1, kind: "base", x: 160, y: 300 }];
  expect(nearestBug(s)!.id).toBe(1);
  step(s, IDLE, 0.001);
  expect(s.shots).toHaveLength(2); expect(s.shots[0]!.vx).toBeGreaterThan(0); expect(s.shots[1]!.vx).toBeLessThan(0);
  expect(s.shots.every(shot => shot.remaining === 2 && shot.laser)).toBe(true);
  s.shots = []; step(s, IDLE, 0.5); expect(s.shots).toHaveLength(0);
  step(s, IDLE, 1); expect(s.shots).toHaveLength(2); // 1.5-second firing cadence
  openChoice(s.upgrades); const paused = structuredClone(s); step(s, IDLE, 50); expect(s).toEqual(paused);
  s.upgrades.offer = null; s.dead = true; const dead = structuredClone(s); step(s, IDLE, 50); expect(s).toEqual(dead);
});

test("drones skip empty targets and kill through the same scoring and collision path", () => {
  const s = createSimulation(1); s.spawnIn = s.fireIn = Infinity; pick(s, CI_DRONE);
  step(s, IDLE, 0.001); expect(s.shots).toHaveLength(0);
  s.drones[0]!.fireIn = 0;
  s.bugs = [{ id: 1, kind: "base", x: 390, y: 300 }];
  for (let i = 0; i < 30; i++) step(s, IDLE, 1 / 60);
  expect(s.squashes).toBe(1); expect(s.score).toBe(10); expect(s.hits).toBe(0);
});
