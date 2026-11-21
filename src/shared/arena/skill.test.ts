import { expect, test } from "bun:test";
import { skillSeed, skillMatrix, median } from "./skill";
test("fixed-seed combat and private policy randomness replay exactly", () => {
  expect(skillSeed(4, "aimer", 400)).toEqual(skillSeed(4, "aimer", 400));
  expect(median([3, 1, 4, 2])).toBe(2.5);
});
test("20 seeds × 8 bots × 180s: aimer median score is positive and at least twice mover", () => {
  const [mover, aimer] = skillMatrix(); expect(mover!.seeds).toHaveLength(20); expect(aimer!.seeds).toHaveLength(20);
  for (const result of [mover!, aimer!]) {
    expect(result.seeds.map(s => s.seed)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    for (const seed of result.seeds) { expect(seed.players).toBe(8); expect(seed.playerSeconds).toBeCloseTo(8 * 180, 6); }
  }
  expect(mover!.medianScore).toBeGreaterThan(0); expect(aimer!.medianScore).toBeGreaterThanOrEqual(2 * mover!.medianScore);
}, 30000);
