import { expect, test } from "bun:test";
import { bombRecharge, nextPickDescription, REFACTOR_BOMB, shieldCapacity, TEST_SHIELD } from "./upgrades";

test("cards describe first, repeated and capped shield refills and diminishing bomb recharge", () => {
  for (const [picks, capacity] of [[1, 1], [2, 2], [4, 4], [20, 4]] as const) {
    expect(shieldCapacity(picks)).toBe(capacity);
    expect(nextPickDescription(TEST_SHIELD, picks - 1)).toContain(`block ${capacity}`);
  }
  expect(nextPickDescription(TEST_SHIELD, 4)).toContain("maximum capacity");
  expect(bombRecharge(0)).toBe(Infinity);
  for (const [picks, seconds] of [[1, 30], [2, 22.5], [10, 16.5]] as const) {
    expect(bombRecharge(picks)).toBe(seconds);
    expect(nextPickDescription(REFACTOR_BOMB, picks - 1)).toContain(`${seconds}s`);
  }
});
