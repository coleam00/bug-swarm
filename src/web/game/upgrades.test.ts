import { expect, test } from "bun:test";
import { UPGRADE_IDS } from "../../shared/upgrades";
import { acquiredUpgrades, createUpgrades, openChoice, selectUpgrade } from "./upgrades";

test("offers are seeded, distinct, independent of picks, and reject stale or absent choices", () => {
  const a = createUpgrades(73), b = createUpgrades(73);
  expect(selectUpgrade(a, 0, UPGRADE_IDS[0])).toBe(false);
  for (let i = 1; i <= 12; i++) {
    openChoice(a); openChoice(b);
    expect(a.offer).toEqual(b.offer); expect(new Set(a.offer).size).toBe(3);
    expect(selectUpgrade(a, i - 1, a.offer![0]!)).toBe(false);
    const omitted = UPGRADE_IDS.find(id => !a.offer!.includes(id))!;
    expect(selectUpgrade(a, i, omitted)).toBe(false);
    expect(selectUpgrade(a, i, a.offer![0]!)).toBe(true);
    expect(selectUpgrade(a, i, omitted)).toBe(false);
    selectUpgrade(b, i, b.offer![2]!);
  }
  const summary = acquiredUpgrades(a);
  expect(summary.reduce((sum, item) => sum + item.count, 0)).toBe(12);
  expect(Object.isFrozen(summary)).toBe(true);
  expect(summary.every(Object.isFrozen)).toBe(true);
});
