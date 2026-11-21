import { expect, test } from "bun:test";
import { personalLevel } from "./level";

test("personal level follows pressure milestones and caps at four", () => {
  for (const [age, level] of [
    [-1, 1], [0, 1], [59.95, 1], [60, 2], [60.05, 2],
    [119.95, 2], [120, 3], [120.05, 3],
    [239.95, 3], [240, 4], [240.05, 4], [3600, 4],
  ]) expect(personalLevel(age!)).toBe(level!);
});
