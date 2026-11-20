import { expect, test } from "bun:test";
import { CI_DRONE, nextPickDescription, REVIEW_LASER } from "../../shared/upgrades";
import { createSimulation, IDLE, step } from "./simulation";
import { pick } from "./upgrade-fixture.test-support";

test("first laser quadruples actual robot firing, repeat picks only add piercing, drones keep 1.5s cadence", () => {
  const robotShots = (laser: number, drone = false) => {
    const s = createSimulation(1); s.spawnIn = Infinity;
    s.upgrades.nextChoiceAt = Infinity;
    for (let i = 0; i < laser; i++) pick(s, REVIEW_LASER);
    if (drone) { pick(s, CI_DRONE); s.fireIn = Infinity; }
    s.bugs = [{ id: 1, kind: "base", x: 10000, y: 300 }];
    for (let i = 0; i < 180; i++) step(s, IDLE, 1 / 60);
    return s.shots;
  };
  expect(robotShots(0)).toHaveLength(2);
  expect(robotShots(1)).toHaveLength(8);
  expect(robotShots(4)).toHaveLength(8);
  expect(robotShots(0, true)).toHaveLength(3);
  expect(robotShots(1, true)).toHaveLength(3);
  expect(robotShots(4).every(s => s.remaining === 5)).toBe(true);
  expect(nextPickDescription(REVIEW_LASER, 0)).toBe("Shots hit up to 2 bugs; robot fires 4x faster");
  expect(nextPickDescription(REVIEW_LASER, 1)).toBe("Shots hit up to 3 bugs");
});

test("acquisition clamps remaining cooldown without a synchronous shot or changing existing shots; repeats never reset it", () => {
  const s = createSimulation(1); s.spawnIn = Infinity;
  s.shots = [{ x: 10, y: 20, vx: 1, vy: 0, life: 2, remaining: 1, laser: false }];
  s.bugs = [{ id: 1, kind: "base", x: 10000, y: 300 }];
  const original = structuredClone(s.shots);
  pick(s, REVIEW_LASER);
  expect(s.fireIn).toBe(0.375); expect(s.shots).toEqual(original);
  step(s, IDLE, 0.35); expect(s.shots).toHaveLength(1);
  pick(s, REVIEW_LASER); expect(s.fireIn).toBeCloseTo(0.025);
  step(s, IDLE, 0.025); expect(s.shots).toHaveLength(2);
  expect(s.shots[1]!.remaining).toBe(3);
  const readySoon = createSimulation(1); readySoon.fireIn = 0.1;
  pick(readySoon, REVIEW_LASER); expect(readySoon.fireIn).toBe(0.1);
});

test.each([0, 1, 2, 4])("laser pick count %i kills 1 + count distinct aligned targets in travel order", count => {
  const s = createSimulation(1); s.spawnIn = Infinity;
  for (let i = 0; i < count; i++) pick(s, REVIEW_LASER);
  s.bugs = [5, 3, 1, 4, 2, 6].map(id => ({ id, kind: "base", x: 300 + id * 32, y: 300 }));
  s.fireIn = 0; step(s, IDLE, 0.001);
  const shot = s.shots[0]!;
  expect(shot.remaining).toBe(count + 1); expect(shot.laser).toBe(count > 0);
  shot.vx = 20000; s.fireIn = Infinity;
  step(s, IDLE, 0.02);
  expect(s.squashes).toBe(count + 1); expect(s.score).toBe(10 * (count + 1));
  expect(s.bugs.map(b => b.id).sort()).toEqual([1, 2, 3, 4, 5, 6].slice(count + 1));
  step(s, IDLE, 0.02); expect(s.squashes).toBe(count + 1);
});

test("existing shots retain their budget; piercing persists between steps and expires", () => {
  const s = createSimulation(1); s.spawnIn = Infinity; s.fireIn = 0;
  s.bugs = [{ id: 1, kind: "base", x: 400, y: 300 }];
  step(s, IDLE, 0.001); pick(s, REVIEW_LASER);
  expect(s.shots[0]!.remaining).toBe(1); expect(s.shots[0]!.laser).toBe(false);
  s.shots = []; s.fireIn = 0;
  step(s, IDLE, 0.001); s.fireIn = Infinity;
  for (let i = 0; i < 20; i++) step(s, IDLE, 0.02);
  expect(s.squashes).toBe(1); expect(s.shots[0]!.remaining).toBe(1);
  for (let i = 0; i < 200; i++) step(s, IDLE, 0.02);
  expect(s.shots).toHaveLength(0); expect(s.squashes).toBe(1);
});

test("swept collision ties use bug id rather than array order", () => {
  const s = createSimulation(1); s.spawnIn = s.fireIn = Infinity;
  s.bugs = [{ id: 2, kind: "base", x: 400, y: 300 }, { id: 1, kind: "base", x: 400, y: 300 }];
  s.shots = [{ x: 350, y: 300, vx: 10000, vy: 0, life: 1 }];
  step(s, IDLE, 0.01);
  expect(s.bugs.map(b => b.id)).toEqual([2]);
});
