import { expect, test } from "bun:test";
import { BUG_KINDS, ROBOT_RADIUS, STEP, FAST_BUG_EVERY, spawnInterval } from "./config";
import { createSimulation, IDLE, nearestBug, spawnBug, step } from "./simulation";
import { arenaForViewport } from "./arena";
import { plausible } from "../../server/rules";
const [BASE, FAST] = BUG_KINDS;
const BUG_RADIUS = BASE.radius;

test.each([1, 42, 12345, 7, 99])("seed %i replays deterministically and idle loses in 30–60 seconds in every arena", (seed) => {
  for (const arena of [arenaForViewport(1, 1), arenaForViewport(390, 844), arenaForViewport(844, 390)]) {
    const a = createSimulation(seed, arena), b = createSimulation(seed, arena);
    while (!a.dead && a.time < 90) { step(a, IDLE, STEP); step(b, IDLE, STEP); }
    expect(a).toEqual(b);
    expect(a.time).toBeGreaterThanOrEqual(30); expect(a.time).toBeLessThanOrEqual(60);
    expect(a.hits).toBe(3);
    expect(plausible({ playerId: "fixture", score: a.score, squashes: a.squashes, seconds: a.seconds, touch: false }, 0, a.time * 1000)).toBe(true);
    const frozen = structuredClone(a); step(a, IDLE, STEP); expect(a).toEqual(frozen);
  }
});
test("bugs chase the robot", () => {
  const s = createSimulation(1);
  s.bugs = [{ id: 1, kind: BASE.id, x: 0, y: 300 }];
  s.robot = { x: 100, y: 100 };
  step(s, IDLE, STEP);
  expect(s.bugs[0]!.x).toBeGreaterThan(0); expect(s.bugs[0]!.y).toBeLessThan(300);
});

test("spawn rate increases across equal windows and keeps countdown overshoot", () => {
  const a = createSimulation(1), b = createSimulation(1);
  a.invulnerableUntil = b.invulnerableUntil = Infinity;
  for (let i = 0; i < 30 / STEP; i++) step(a, IDLE, STEP);
  const early = a.nextId - 1;
  for (let i = 0; i < 30 / STEP; i++) step(a, IDLE, STEP);
  expect(a.nextId - 1 - early).toBeGreaterThan(early);
  // Different step boundaries must preserve the spawn sequence and future countdown.
  for (let i = 0; i < 60 / 0.25; i++) step(b, IDLE, 0.25);
  expect(b.nextId).toBe(a.nextId); expect(b.eligibleSpawns).toBe(a.eligibleSpawns);
  expect(b.seed).toBe(a.seed); expect(b.spawnIn).toBeCloseTo(a.spawnIn, 8);
  expect(spawnInterval(15)).toBeCloseTo(0.9); expect(spawnInterval(45)).toBeCloseTo(0.6);
  expect(spawnInterval(180)).toBe(spawnInterval(120));
});

test.each([1, 42, 12345, 7, 99])("seed %i grows a live swarm and overwhelms moving, dodging steering in 60–180s", (seed) => {
  for (const arena of [arenaForViewport(1, 1), arenaForViewport(390, 844), arenaForViewport(844, 390)]) {
    const s = createSimulation(seed, arena), inset = 100;
    const corners = [{ x: inset, y: inset }, { x: arena.width - inset, y: inset },
      { x: arena.width - inset, y: arena.height - inset }, { x: inset, y: arena.height - inset }];
    let corner = 0, earlyPopulation = 0, laterPopulation = 0;
    while (!s.dead && s.time < 180) {
      const target = corners[corner]!;
      if (Math.hypot(s.robot.x - target.x, s.robot.y - target.y) < 30) corner = (corner + 1) % 4;
      let dx = corners[corner]!.x - s.robot.x, dy = corners[corner]!.y - s.robot.y;
      const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
      // Walk around the arena, steering away from bugs within 60 units and the walls.
      for (const bug of s.bugs) {
        const x = s.robot.x - bug.x, y = s.robot.y - bug.y, distance = Math.hypot(x, y) || 1;
        if (distance < 60) { const strength = 5 * (1 - distance / 60); dx += x / distance * strength; dy += y / distance * strength; }
      }
      dx += 3 * Math.max(0, 1 - s.robot.x / 60) - 3 * Math.max(0, 1 - (arena.width - s.robot.x) / 60);
      dy += 3 * Math.max(0, 1 - s.robot.y / 60) - 3 * Math.max(0, 1 - (arena.height - s.robot.y) / 60);
      step(s, { x: dx, y: dy, target: null }, STEP);
      if (s.time < 20) earlyPopulation = s.bugs.length;
      if (s.time < 60) laterPopulation = s.bugs.length;
    }
    expect(laterPopulation).toBeGreaterThan(earlyPopulation);
    expect(s.dead).toBe(true); expect(s.time).toBeGreaterThanOrEqual(60); expect(s.time).toBeLessThanOrEqual(180);
    expect(plausible({ playerId: "fixture", score: s.score, squashes: s.squashes, seconds: s.seconds, touch: false }, 0, s.time * 1000)).toBe(true);
  }
});

test("no fast bug before 30s; the first eligible scheduled spawn and then every fourth are fast", () => {
  const s = createSimulation(1); s.fireIn = Infinity; s.invulnerableUntil = Infinity;
  let previous = s.nextId, eligible = 0;
  while (s.time < 40) {
    const at = s.time + s.spawnIn;
    step(s, IDLE, STEP);
    if (s.nextId === previous) continue;
    const bug = s.bugs.find((b) => b.id === s.nextId - 1)!;
    if (at < 30 - 1e-9) expect(bug.kind).toBe(BASE.id);
    else { expect(bug.kind).toBe(eligible % FAST_BUG_EVERY === 0 ? FAST.id : BASE.id); eligible++; }
    previous = s.nextId;
  }
  expect(eligible).toBeGreaterThan(FAST_BUG_EVERY);
  expect(createSimulation(1).eligibleSpawns).toBe(0);
  // A step crossing the unlock must use the spawn's scheduled time.
  const crossing = createSimulation(1); crossing.time = 29.9; crossing.spawnIn = 0.05;
  step(crossing, IDLE, 0.2);
  expect(crossing.bugs[0]!.kind).toBe(BASE.id);
  crossing.time = 29.9; crossing.spawnIn = 0.15; crossing.bugs = [];
  step(crossing, IDLE, 0.2);
  expect(crossing.bugs[0]!.kind).toBe(FAST.id);
});

test("fast bug is smaller, moves at least 1.5x base speed, and one shot awards one squash and ten points", () => {
  const distances = BUG_KINDS.map((kind) => {
    const s = createSimulation(1); s.fireIn = s.spawnIn = Infinity;
    s.bugs = [{ id: 1, kind: kind.id, x: 100, y: 300 }];
    for (let i = 0; i < 6; i++) step(s, IDLE, STEP);
    return s.bugs[0]!.x - 100;
  });
  expect(distances[1]!).toBeGreaterThanOrEqual(distances[0]! * 1.5);
  expect(FAST.radius).toBeLessThan(BASE.radius);
  const s = createSimulation(1); s.fireIn = s.spawnIn = Infinity;
  spawnBug(s, FAST.id);
  Object.assign(s.bugs[0]!, { x: 400, y: 300 });
  s.shots = [{ x: 350, y: 300, vx: 10000, vy: 0, life: 3 }];
  step(s, IDLE, STEP);
  expect(s.bugs).toHaveLength(0); expect(s.shots).toHaveLength(0);
  expect(s.squashes).toBe(1); expect(s.score).toBe(10);
});

test("fast bug uses its smaller radius for both swept shots and robot contact", () => {
  for (const kind of BUG_KINDS) {
    const s = createSimulation(1); s.fireIn = s.spawnIn = Infinity;
    s.bugs = [{ id: 1, kind: kind.id, x: 400, y: 313 }];
    s.shots = [{ x: 350, y: 300, vx: 10000, vy: 0, life: 3 }];
    step(s, IDLE, STEP);
    expect(s.squashes).toBe(kind.id === BASE.id ? 1 : 0);
    s.bugs = [{ id: 2, kind: kind.id, x: 325, y: 300 }];
    step(s, IDLE, STEP);
    expect(s.hits).toBe(kind.id === BASE.id ? 1 : 0);
  }
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
  s.bugs = [{ id: 2, kind: BASE.id, x: 350, y: 300 }, { id: 1, kind: BASE.id, x: 250, y: 300 }];
  expect(nearestBug(s)!.id).toBe(1);
  s.bugs = [{ id: 1, kind: BASE.id, x: 400, y: 300 }, { id: 2, kind: BASE.id, x: 250, y: 300 }];
  expect(nearestBug(s)!.id).toBe(2);
  s.fireIn = 0; step(s, IDLE, STEP); expect(s.shots[0]!.vx).toBeLessThan(0);
  s.bugs = [{ id: 3, kind: BASE.id, x: 400, y: 300 }];
  s.shots = [{ x: 350, y: 300, vx: 10000, vy: 0, life: 3 }];
  step(s, IDLE, STEP); expect(s.squashes).toBe(1); expect(s.score).toBe(10); expect(s.shots).toHaveLength(0);
  step(s, IDLE, STEP); expect(s.squashes).toBe(1);
});
test("contact consumes three hits with invulnerability, no squash credit, and seconds score", () => {
  const s = createSimulation(1); s.fireIn = 100; s.spawnIn = 100;
  s.bugs = [{ id: 1, kind: BASE.id, x: 300, y: 300 }, { id: 2, kind: BASE.id, x: 300 + BUG_RADIUS, y: 300 }];
  step(s, IDLE, STEP); expect(s.hits).toBe(1); expect(s.squashes).toBe(0);
  s.bugs.push({ id: 3, kind: BASE.id, x: 300, y: 300 }); step(s, IDLE, STEP); expect(s.hits).toBe(1);
  for (let i = 0; i < 61; i++) step(s, IDLE, STEP);
  expect(s.seconds).toBe(1); expect(s.score).toBe(1);
  s.bugs.push({ id: 4, kind: BASE.id, x: 300, y: 300 }); step(s, IDLE, STEP); expect(s.hits).toBe(2);
  for (let i = 0; i < 61; i++) step(s, IDLE, STEP);
  s.bugs.push({ id: 5, kind: BASE.id, x: 300, y: 300 }); step(s, IDLE, STEP); expect(s.dead).toBe(true);
});
test("shots expire, even if they never find a bug", () => {
  const s = createSimulation(1); s.fireIn = 100; s.spawnIn = 100;
  s.shots.push({ x: 0, y: 0, vx: 1, vy: 0, life: STEP }); step(s, IDLE, STEP);
  expect(s.shots).toHaveLength(0);
});
