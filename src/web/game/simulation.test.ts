import { expect, test } from "bun:test";
import { BUG_KINDS, ROBOT_RADIUS, ROBOT_SPEED, STEP, FAST_BUG_EVERY, FIRST_SPAWN_DELAY, spawnInterval, bugSpeedMultiplier } from "./config";
import { createSimulation as createLiveSimulation, IDLE, nearestBug, spawnBug, step } from "./simulation";
// Isolate individual combat rules; upgraded pacing lives in scripts/pacing.test.ts.
const createSimulation: typeof createLiveSimulation = (...args) => {
  const state = createLiveSimulation(...args); state.upgrades.nextChoiceAt = Infinity; return state;
};
const [BASE, FAST] = BUG_KINDS;

test("directional speed is explicit, clamped and independent of direction magnitude or mouse targets", () => {
  for (const [speed, fraction] of [[undefined, 1], [0.5, 0.5], [0, 0], [-1, 0], [2, 1]] as const) {
    for (const [x, y] of [[0.01, 0], [1, 1], [-3, -4]]) {
      const s = createSimulation(1);
      step(s, { x: x!, y: y!, speed, target: { x: 0, y: 0 } }, STEP);
      const length = Math.hypot(x!, y!);
      expect(s.robot.x).toBeCloseTo(300 + x! / length * ROBOT_SPEED * STEP * fraction);
      expect(s.robot.y).toBeCloseTo(300 + y! / length * ROBOT_SPEED * STEP * fraction);
    }
  }
  const s = createSimulation(1);
  step(s, { x: 0, y: 0, speed: 0, target: { x: 301, y: 300 } }, STEP);
  expect(s.robot).toEqual({ x: 301, y: 300 });
  step(s, { x: 0, y: 0, target: { x: 301, y: 300 } }, STEP);
  expect(s.robot).toEqual({ x: 301, y: 300 });
  s.robot = { x: 585, y: 15 };
  step(s, { x: 1, y: -1, speed: 0.5, target: null }, 1);
  expect(s.robot).toEqual({ x: 600 - ROBOT_RADIUS, y: ROBOT_RADIUS });
});

test("bugs chase the robot", () => {
  const s = createSimulation(1);
  s.bugs = [{ id: 1, kind: BASE.id, x: 0, y: 300 }];
  s.robot = { x: 100, y: 100 };
  step(s, IDLE, STEP);
  expect(s.bugs[0]!.x).toBeGreaterThan(0); expect(s.bugs[0]!.y).toBeLessThan(300);
});

test("opening grace reconnects to the existing schedule and keeps countdown overshoot", () => {
  const a = createSimulation(1), b = createSimulation(1);
  a.invulnerableUntil = b.invulnerableUntil = Infinity;
  for (let i = 0; i < 30 / STEP; i++) step(a, IDLE, STEP);
  const early = a.nextId - 1;
  for (let i = 0; i < 30 / STEP; i++) step(a, IDLE, STEP);
  const middle = a.nextId - 1 - early;
  // Different step boundaries must preserve the spawn sequence and future countdown.
  for (let i = 0; i < 60 / 0.25; i++) step(b, IDLE, 0.25);
  expect(b.nextId).toBe(a.nextId); expect(b.eligibleSpawns).toBe(a.eligibleSpawns);
  expect(b.seed).toBe(a.seed); expect(b.spawnIn).toBeCloseTo(a.spawnIn, 8);
  expect(spawnInterval(0)).toBe(0.35); expect(spawnInterval(11.7)).toBe(0.35);
  expect(spawnInterval(15)).toBeCloseTo(0.35 + 3.65 * 3.3 / 8.3);
  expect(spawnInterval(20)).toBe(4); expect(spawnInterval(30)).toBe(4);
  expect(spawnInterval(45)).toBeCloseTo(2.15);
  // The easing ends at the original late knots and exponential tail.
  expect(spawnInterval(60)).toBe(0.3); expect(spawnInterval(120)).toBe(0.2);
  expect(spawnInterval(180)).toBe(0.18);
  expect(spawnInterval(240)).toBeCloseTo(1 / 6 + (0.18 - 1 / 6) * Math.exp(-1), 12);
  const beforeLate = a.nextId;
  for (let i = 0; i < 30 / STEP; i++) step(a, IDLE, STEP);
  expect(a.nextId - beforeLate).toBeGreaterThan(Math.max(early, middle));
  expect(spawnInterval(180)).toBeLessThan(spawnInterval(120));
  expect(spawnInterval(240)).toBeLessThan(spawnInterval(180));
  expect(spawnInterval(600)).toBeLessThan(spawnInterval(240));
  expect(spawnInterval(600)).toBeGreaterThanOrEqual(1 / 6);
  // Observe the live scheduler too: a ramping helper alone does not ensure it is used.
  const late = createSimulation(42); late.invulnerableUntil = Infinity;
  const windows: number[] = [];
  while (late.time < 300 - 1e-7) {
    const before = late.nextId;
    step(late, IDLE, STEP);
    const window = Math.min(4, Math.floor((late.time - 1e-7) / 60));
    windows[window] = (windows[window] ?? 0) + late.nextId - before;
    late.bugs.length = 0;
  }
  expect(windows[3]!).toBeGreaterThan(windows[2]!); // 180–240 vs 120–180
  expect(windows[4]!).toBeGreaterThan(windows[3]!); // 240–300 vs 180–240
});

test("the first spawn waits 9.3 seconds and the first 15 seconds contain fewer scheduled bugs", () => {
  const s = createSimulation(1); s.invulnerableUntil = s.fireIn = Infinity;
  expect(FIRST_SPAWN_DELAY).toBe(9.3); expect(s.spawnIn).toBe(FIRST_SPAWN_DELAY);
  step(s, IDLE, FIRST_SPAWN_DELAY - STEP);
  expect(s.nextId).toBe(1);
  step(s, IDLE, STEP / 2); expect(s.nextId).toBe(1);
  step(s, IDLE, STEP / 2); expect(s.nextId).toBe(2);
  expect(s.spawnIn).toBeCloseTo(spawnInterval(FIRST_SPAWN_DELAY), 10);
  while (s.time < 15 - 1e-7) step(s, IDLE, Math.min(STEP, 15 - s.time));
  // The old 0.2-to-4-second opening scheduled 15 bugs by this boundary.
  expect(s.nextId - 1).toBeLessThan(15);
});

test("opening pursuit starts at 60%, reaches full speed at 15s, then returns to the original rules at 20s", () => {
  for (const [time, multiplier] of [[0, .6], [7.5, .8], [15, 1], [16.25, 2.1], [17.5, 3.2], [18.75, 2.1], [20, 1]]) {
    expect(bugSpeedMultiplier(time!)).toBeCloseTo(multiplier!, 12);
  }
  for (const time of [0, 7.5, 15, 17.5, 19.99]) {
    const s = createSimulation(1); s.time = time; s.spawnIn = s.fireIn = Infinity;
    s.bugs.push({ id: 1, kind: BASE.id, x: 10, y: s.robot.y });
    step(s, IDLE, STEP);
    expect(s.bugs[0]!.x - 10).toBeCloseTo(BASE.speed * bugSpeedMultiplier(time + STEP) * STEP, 10);
  }
  for (const time of [20, 20.01, 30, 45, 60, 90, 120, 180, 240, 600]) {
    expect(bugSpeedMultiplier(time)).toBe(1 + Math.max(0, time - 45) / 45 + (Math.max(0, time - 90) / 45) ** 2);
  }
  for (const [time, interval] of [[20, 4], [25, 4], [30, 4], [45, 2.15], [60, .3], [120, .2], [180, .18]]) {
    expect(spawnInterval(time!)).toBeCloseTo(interval!, 12);
  }
});

test("scheduled spawns stay inside the cumulative six-per-second score allowance", () => {
  const s = createSimulation(42); s.invulnerableUntil = Infinity;
  // Keep the fixture small while exercising the production spawn schedule past its final knot.
  while (s.time < 600) {
    step(s, IDLE, STEP);
    expect(s.nextId - 1).toBeLessThanOrEqual(Math.floor(6 * s.time + 1e-7));
    expect(s.squashes).toBeLessThanOrEqual(s.nextId - 1);
    s.bugs.length = 0;
  }
});

test("late pursuit accelerates both existing and newly spawned bugs, preserving their speed ratio", () => {
  expect(bugSpeedMultiplier(30)).toBe(1); expect(bugSpeedMultiplier(45)).toBe(1);
  expect(bugSpeedMultiplier(60)).toBeCloseTo(4 / 3, 12);
  expect(bugSpeedMultiplier(120)).toBeCloseTo(28 / 9, 12);
  expect(bugSpeedMultiplier(180)).toBe(8);
  expect(bugSpeedMultiplier(60)).toBeGreaterThan(bugSpeedMultiplier(45));
  expect(bugSpeedMultiplier(180)).toBeGreaterThan(bugSpeedMultiplier(120));
  expect(bugSpeedMultiplier(240)).toBeGreaterThan(bugSpeedMultiplier(180));
  for (const time of [120, 180, 240]) {
    const distances = BUG_KINDS.map(kind => {
      const s = createSimulation(1); s.time = time; s.spawnIn = s.fireIn = Infinity;
      s.bugs.push({ id: 1, kind: kind.id, x: 10, y: s.robot.y });
      step(s, IDLE, STEP);
      const distance = s.bugs[0]!.x - 10;
      expect(distance).toBeCloseTo(kind.speed * bugSpeedMultiplier(time + STEP) * STEP);
      return distance;
    });
    expect(distances[1]! / distances[0]!).toBeCloseTo(FAST.speed / BASE.speed);
    const s = createSimulation(42); s.time = time; s.spawnIn = 0; s.fireIn = Infinity;
    const expected = createSimulation(42); spawnBug(expected, FAST.id);
    const origin = { ...expected.bugs[0]! };
    step(s, IDLE, STEP);
    expect(Math.hypot(s.bugs[0]!.x - origin.x, s.bugs[0]!.y - origin.y)).toBeCloseTo(FAST.speed * bugSpeedMultiplier(time + STEP) * STEP);
  }
});

test("no fast bug before 30s; the first eligible scheduled spawn and then every fourth are fast", () => {
  const s = createSimulation(1); s.fireIn = Infinity; s.invulnerableUntil = Infinity;
  let previous = s.nextId, eligible = 0;
  while (s.time < 50) {
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
test("an attacker survives contacts and can deal three hits across immunity windows, without squash credit", () => {
  const s = createSimulation(1); s.fireIn = 100; s.spawnIn = 100;
  s.bugs = [{ id: 1, kind: BASE.id, x: 300, y: 300 }];
  step(s, IDLE, STEP); expect(s.hits).toBe(1); expect(s.squashes).toBe(0);
  step(s, IDLE, STEP); expect(s.hits).toBe(1);
  for (let i = 0; i < 61; i++) step(s, IDLE, STEP);
  expect(s.seconds).toBe(1); expect(s.score).toBe(1);
  expect(s.hits).toBe(2);
  for (let i = 0; i < 61; i++) step(s, IDLE, STEP);
  expect(s.dead).toBe(true); expect(s.bugs.map(bug => bug.id)).toEqual([1]);
  expect(s.squashes).toBe(0); expect(s.score).toBe(s.seconds);
  const frozen = structuredClone(s); step(s, IDLE, STEP); expect(s).toEqual(frozen);
});
test("shots expire, even if they never find a bug", () => {
  const s = createSimulation(1); s.fireIn = 100; s.spawnIn = 100;
  s.shots.push({ x: 0, y: 0, vx: 1, vy: 0, life: STEP }); step(s, IDLE, STEP);
  expect(s.shots).toHaveLength(0);
});
