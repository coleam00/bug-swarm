import { expect, test } from "bun:test";
import { CI_DRONE, REFACTOR_BOMB, REVIEW_LASER, TEST_SHIELD } from "../src/shared/upgrades";
import { createSimulation, IDLE, step } from "../src/web/game/simulation";
import { evasiveInput, resolveChoice, runMatrix, runScenario, SCENARIOS, selectCard, targets } from "./pacing";

test("upgraded pacing replays deterministically, ends idle by 60s and every build by 240s in both shapes", () => {
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

test("idle takes the first card; evasive uses the first available priority", () => {
  const offer = [REVIEW_LASER, REFACTOR_BOMB, CI_DRONE];
  expect(selectCard("idle", offer, SCENARIOS[0].priority)).toBe(REVIEW_LASER);
  expect(selectCard("evasive", offer, SCENARIOS[0].priority)).toBe(CI_DRONE);
  expect(selectCard("evasive", [TEST_SHIELD, REVIEW_LASER, CI_DRONE], SCENARIOS[1].priority)).toBe(CI_DRONE);
});

test("harness resolves actual offers without advancing paused gameplay time", () => {
  const s = createSimulation(42); s.invulnerableUntil = Infinity;
  while (!s.upgrades.offer) step(s, IDLE, 1 / 60);
  const before = structuredClone(s), first = s.upgrades.offer![0]!;
  step(s, IDLE, 600); expect(s).toEqual(before);
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
  const s = createSimulation(1); s.robot.x += 10;
  const x = 0.15 * -10 / s.arena.width;
  s.bugs = [{ id: 1, kind: "base", ...s.robot }, { id: 2, kind: "base", x: s.robot.x - 100, y: s.robot.y },
    { id: 3, kind: "base", x: s.robot.x + 200, y: s.robot.y }];
  expect(evasiveInput(s)).toEqual({ x: x + 0.5, y: 0, target: null });
});
