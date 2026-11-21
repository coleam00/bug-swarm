import { expect, test } from "bun:test";
import { skillSeed, skillMatrix, median, lifeMedians, newcomerTrial, newcomerComparison, survivalSummary, fairnessPassed, IDLE_JOIN_AGES, type NewcomerLife } from "./skill";
test("fixed-seed combat and private policy randomness replay exactly", () => {
  expect(skillSeed(4, "aimer", 400)).toEqual(skillSeed(4, "aimer", 400));
  expect(median([3, 1, 4, 2])).toBe(2.5);
});
test("score and life-length summaries have independent known odd and even medians", () => {
  const lives = [{ score: 90, seconds: 2 }, { score: 10, seconds: 8 }, { score: 20, seconds: 4 }, { score: 40, seconds: 30 }];
  expect(lifeMedians(lives)).toEqual({ medianScore: 30, medianSeconds: 6 });
  expect(lifeMedians(lives.slice(0, 3))).toEqual({ medianScore: 20, medianSeconds: 4 });
});
test("20 seeds × 8 bots × 180s: aimer median score is positive and at least twice mover", () => {
  const [mover, aimer] = skillMatrix(); expect(mover!.seeds).toHaveLength(20); expect(aimer!.seeds).toHaveLength(20);
  for (const result of [mover!, aimer!]) {
    expect(result.medianSeconds).toBeGreaterThan(0); expect(result.medianSeconds).toBeLessThanOrEqual(180);
    expect(result.seeds.map(s => s.seed)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    for (const seed of result.seeds) { expect(seed.players).toBe(8); expect(seed.playerSeconds).toBeCloseTo(8 * 180, 6); }
  }
  expect(mover!.medianScore).toBeGreaterThan(0); expect(aimer!.medianScore).toBeGreaterThanOrEqual(2 * mover!.medianScore);
}, 30000);

test("newcomer trials observe exactly the first life at the requested age and retain live cutoffs", () => {
  for (const age of [0, 90, 150, 180, 480, 900]) {
    const admissions: { tick: number; startedTick: number; ids: string[] }[] = [];
    newcomerTrial(3, "idle", age, 8, 0.5, arena => {
      admissions.push({ tick: arena.tick, startedTick: arena.players.get("newcomer")!.startedTick, ids: [...arena.players.keys()] });
    });
    expect(admissions).toEqual([{ tick: age * 20, startedTick: age * 20, ids: ["0", "1", "2", "3", "4", "5", "6", "7", "newcomer"] }]);
  }
  const early = newcomerTrial(3, "idle", 0, 0, 0.5), late = newcomerTrial(3, "idle", 480, 0, 0.5);
  expect(early).toEqual({ seed: 3, policy: "idle", joinSeconds: 0, incumbents: 0, seconds: 0.5, score: 0, cutoff: true });
  expect(late).toEqual({ ...early, joinSeconds: 480 });
  const death = newcomerTrial(3, "idle", 0, 0, 60);
  expect(death.cutoff).toBe(false); expect(death.seconds).toBeGreaterThan(0); expect(death.seconds).toBeLessThan(60);
  expect(newcomerTrial(3, "idle", 0, 0, 120)).toEqual(death);
  const busy = newcomerTrial(3, "aimer", 1, 8, 0.5);
  expect(busy).toMatchObject({ seed: 3, policy: "aimer", joinSeconds: 1, incumbents: 8, seconds: 0.5, cutoff: true });
}, 10000); // Several thousand simulated seconds, also on shared Windows runners.

test("survival gates distinguish deaths, censored lower bounds, missing cohorts and failed thresholds", () => {
  const cohort = (policy: "aimer" | "idle", joinSeconds: number, incumbents: number, seconds: number): NewcomerLife[] =>
    Array.from({ length: 20 }, (_, seed) => ({ seed, policy, joinSeconds, incumbents, seconds, score: 0, cutoff: false }));
  const early = cohort("aimer", 0, 8, 100), late = cohort("aimer", 480, 8, 80);
  expect(newcomerComparison(early, late)).toBe("pass");
  expect(newcomerComparison(early, late.map(l => ({ ...l, seconds: 79.9 })))).toBe("fail");
  const censored = late.map(l => ({ ...l, cutoff: true }));
  expect(survivalSummary(censored)).toEqual({ count: 20, deaths: 0, cutoffs: 20, medianSeconds: 80, exact: false });
  expect(newcomerComparison(early, censored)).toBe("pass");
  expect(newcomerComparison(censored, late)).toBe("inconclusive");
  expect(newcomerComparison(early, censored.map(l => ({ ...l, seconds: 79 })))).toBe("inconclusive");
  expect(IDLE_JOIN_AGES).toEqual(Array.from({ length: 61 }, (_, i) => i * 15));
  const idle = IDLE_JOIN_AGES.map(age => cohort("idle", age, 8, 10));
  const cohorts = [early, late, ...idle, cohort("idle", 0, 0, 10), cohort("idle", 480, 0, 10)];
  expect(fairnessPassed(cohorts)).toBe(true); expect(fairnessPassed(cohorts.slice(0, -1))).toBe(false);
  const missing = structuredClone(cohorts); missing[0]!.pop(); expect(fairnessPassed(missing)).toBe(false);
  const duplicate = structuredClone(cohorts); duplicate[1]![1]!.seed = 0; expect(fairnessPassed(duplicate)).toBe(false);
  const wrongAge = structuredClone(cohorts); wrongAge[3]![0]!.joinSeconds = 0; expect(fairnessPassed(wrongAge)).toBe(false);
  for (const age of [90, 150, 180]) {
    const failing = structuredClone(cohorts), index = failing.findIndex(lives => lives[0]!.policy === "idle" && lives[0]!.joinSeconds === age);
    failing[index] = cohort("idle", age, 8, 9.99); expect(fairnessPassed(failing)).toBe(false);
  }
});

test("idle openings retain a ten-second median during the first incumbent lives", () => {
  for (const age of [90, 150, 180]) {
    const lives = Array.from({ length: 20 }, (_, seed) => newcomerTrial(seed, "idle", age, 8, 10));
    // A survivor at ten seconds is sufficient evidence for this lower-bound gate.
    expect(survivalSummary(lives).medianSeconds).toBeGreaterThanOrEqual(10);
  }
}, 30000);
