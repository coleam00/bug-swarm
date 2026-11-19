import { expect, test } from "bun:test";
import { CI_DRONE, REFACTOR_BOMB, REVIEW_LASER, TEST_SHIELD, UPGRADE_IDS } from "../src/shared/upgrades";
import { createSimulation, IDLE, step } from "../src/web/game/simulation";
import { evasiveInput, median, resolveChoice, runMatrix, runScenario, SCENARIOS, selectCard, summarize, targets, VIEWPORTS } from "./pacing";

test("default matrix keeps all five seeds, modes, shapes and distinct upgrade priorities", () => {
  const rows = runMatrix();
  expect(rows).toHaveLength(20);
  for (const seed of [1, 42, 12345, 7, 99]) for (const mode of ["idle", "evasive"] as const)
    for (const viewport of [[390, 844], [1280, 800]])
      expect(rows.filter(r => r.seed === seed && r.mode === mode && r.viewport[0] === viewport[0] && r.viewport[1] === viewport[1])).toHaveLength(1);
  const priorities = rows.filter(r => r.mode === "evasive" && r.viewport[0] === 390).map(r => r.priority);
  expect(new Set(priorities.map(p => p.join(","))).size).toBe(5);
  for (const priority of priorities) expect([...priority].sort()).toEqual([...UPGRADE_IDS].sort());
  expect(priorities.some(p => p[0] === TEST_SHIELD)).toBe(true);
  expect(priorities.some(p => p[0] === CI_DRONE && p[1] === REFACTOR_BOMB)).toBe(true);
});

test("two-seed upgraded pacing replays deterministically, ends idle by 60s and both priorities by 240s", () => {
  const rows = runMatrix([1, 42]);
  expect(rows).toHaveLength(8); expect(rows).toEqual(runMatrix([1, 42]));
  for (const r of rows) {
    expect(r.dead).toBe(true); expect(r.elapsed).toBeLessThanOrEqual(240 + 1e-7);
    if (r.mode === "idle") expect(r.elapsed).toBeLessThanOrEqual(60 + 1e-7);
    expect(r.validScore).toBe(true); expect(r.score).toBe(10 * r.squashes + r.seconds);
    expect(r.squashes).toBeLessThanOrEqual(r.spawned);
    expect(r.build.reduce((sum, u) => sum + u.count, 0)).toBe(Math.floor(r.seconds / 20));
  }
  expect(Object.values(targets(rows)).every(Boolean)).toBe(true);
});

test("idle first-card builds end by 60s across consecutive and spread 32-bit seeds, including seed 5", () => {
  const seeds = [...Array.from({ length: 100 }, (_, i) => i),
    ...Array.from({ length: 100 }, (_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0)];
  for (const seed of seeds) for (const viewport of VIEWPORTS) {
    const r = runScenario({ ...SCENARIOS[0], seed, viewport, mode: "idle" });
    expect({ seed, viewport, dead: r.dead, within60: r.elapsed <= 60 + 1e-7, validScore: r.validScore })
      .toEqual({ seed, viewport, dead: true, within60: true, validScore: true });
  }
});

test.each([
  { durations: [90, 10, 20], expectedMedian: 20, longest: 90 },
  { durations: [90, 10, 50, 20], expectedMedian: 35, longest: 90 },
])("median and longest use unequal odd/even durations: %j", ({ durations, expectedMedian, longest }) => {
  expect(median(durations)).toBe(expectedMedian);
  const fixture = runScenario({ ...SCENARIOS[0], mode: "idle", viewport: [390, 844] }, 0.025);
  const rows = durations.map((elapsed, i) => ({ ...fixture, elapsed, dead: i !== 0 }));
  expect(summarize(rows)).toEqual({ median: expectedMedian, longest, cutoffs: 1 });
});

test("idle takes the first card; evasive uses the first available priority", () => {
  const offer = [REVIEW_LASER, REFACTOR_BOMB, CI_DRONE];
  expect(selectCard("idle", offer, SCENARIOS[0].priority)).toBe(REVIEW_LASER);
  expect(selectCard("evasive", offer, SCENARIOS[0].priority)).toBe(CI_DRONE);
  expect(selectCard("evasive", [TEST_SHIELD, REVIEW_LASER, CI_DRONE], SCENARIOS[1].priority)).toBe(CI_DRONE);
});

test("harness resolves actual offers without advancing paused gameplay time", () => {
  const s = createSimulation(42); s.invulnerableUntil = Infinity;
  while (!s.upgrades.offer) step(s, IDLE, 1 / 60);
  const first = s.upgrades.offer![0]!;
  resolveChoice(s, offer => selectCard("idle", offer, SCENARIOS[1].priority));
  expect(s.time).toBe(20); expect(s.upgrades.offer).toBeNull(); expect(s.upgrades.counts[first]).toBe(1);
});

test("cutoff is a survivor even below a target ceiling and the horizon uses a shortened last step", () => {
  const r = runScenario({ ...SCENARIOS[0], mode: "idle", viewport: [390, 844] }, 0.025);
  expect(r.elapsed).toBeCloseTo(0.025, 12); expect(r.dead).toBe(false);
  expect(targets([r]).idle60).toBe(false); expect(targets([r]).allDead240).toBe(false);
  expect(() => runScenario({ ...SCENARIOS[0], mode: "idle", viewport: [390, 844] }, Infinity)).toThrow();
});

test("evasion combines centre drift and nearby repulsion, ignoring zero-distance bugs", () => {
  const s = createSimulation(1);
  s.robot.x += 80; s.robot.y -= 120;
  const drift = evasiveInput(s);
  expect(drift.x).toBeLessThan(0); expect(drift.y).toBeGreaterThan(0); expect(drift.target).toBeNull();
  s.bugs = [{ id: 1, kind: "base", ...s.robot },
    { id: 2, kind: "base", x: s.robot.x - 201, y: s.robot.y },
    { id: 3, kind: "base", x: s.robot.x, y: s.robot.y + 200 },
    { id: 4, kind: "base", x: s.robot.x, y: s.robot.y - 201 }];
  expect(evasiveInput(s)).toEqual(drift);
  for (const [dx, dy] of [[-100, 0], [100, 0], [0, -100], [0, 100]] as const) {
    s.bugs = [{ id: 4, kind: "fast", x: s.robot.x + dx, y: s.robot.y + dy }];
    const near = evasiveInput(s);
    if (dx < 0) expect(near.x).toBeGreaterThan(drift.x);
    if (dx > 0) expect(near.x).toBeLessThan(drift.x);
    if (dy < 0) expect(near.y).toBeGreaterThan(drift.y);
    if (dy > 0) expect(near.y).toBeLessThan(drift.y);
    const component = dx ? "x" : "y", other = dx ? "y" : "x";
    expect(near[other]).toBe(drift[other]);
    s.bugs[0]![component] = s.robot[component] + (dx || dy) / 2;
    expect(Math.abs(evasiveInput(s)[component] - drift[component])).toBeGreaterThan(Math.abs(near[component] - drift[component]));
  }
});
