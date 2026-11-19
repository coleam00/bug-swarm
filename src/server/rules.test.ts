import { expect, test } from "bun:test";
import { isId, nameKey, plausible, validFinish, validateName, MAX_SQUASHES_PER_SECOND } from "./rules";
import { parseFinish } from "./rules";
import { UPGRADE_IDS } from "../shared/upgrades";
const finish = { playerId: crypto.randomUUID(), score: 62, squashes: 6, seconds: 2, touch: true };

test("finish normalizes legacy and reordered builds and validates pick capacity", () => {
  expect(parseFinish(finish)?.upgrades).toEqual([]);
  const result = { ...finish, seconds: 80 };
  const upgrades = UPGRADE_IDS.map(id => ({ id, count: 1 }));
  expect(parseFinish({ ...result, upgrades: [...upgrades].reverse() })?.upgrades).toEqual(upgrades);
  for (const bad of [null, {}, "x", [null], [{ id: "unknown", count: 1 }],
    [upgrades[0], upgrades[0]], [...upgrades, upgrades[0]],
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"].map(count => [{ id: UPGRADE_IDS[0], count }])]) {
    expect(parseFinish({ ...result, upgrades: bad })).toBeNull();
  }
  expect(parseFinish({ ...finish, seconds: 19, upgrades: [upgrades[0]] })).toBeNull();
  expect(parseFinish({ ...finish, seconds: 20, upgrades: [upgrades[0]] })).not.toBeNull();
  expect(parseFinish({ ...result, upgrades: [{ ...upgrades[0], count: 5 }] })).toBeNull();
});

test("faster spawning retains the six squashes per second cap: boundary accepted, one more rejected", () => {
  expect(MAX_SQUASHES_PER_SECOND).toBe(6);
  const seconds = 60, squashes = MAX_SQUASHES_PER_SECOND * seconds;
  const boundary = { ...finish, seconds, squashes, score: squashes * 10 + seconds };
  expect(plausible(boundary, 1000, 61000)).toBe(true);
  expect(plausible({ ...boundary, squashes: squashes + 1, score: boundary.score + 10 }, 1000, 61000)).toBe(false);
});
test("name rules trim and allow exactly the published character set and lengths", () => {
  expect(validateName("  Robot-7_ ok  ")).toEqual({ name: "Robot-7_ ok" });
  for (const name of [null, "a", "12345678901234567", "🤖", "a<b", "a\nb", "éé", "  "]) expect(validateName(name).error).toBeDefined();
  expect(validateName("ab").name).toBe("ab"); expect(validateName("1234567890123456").name).toBeDefined();
  expect(nameKey(" Mixed-0 ")).toBe("mixed-0");
});
test("blocked substrings ignore case and precisely the five swaps", () => {
  for (const name of ["xxFuCKxx", "5h1t", "b1tch", "cunt", "n1gg3r", "f4gg0t"]) expect(validateName(name).error).toContain("isn't allowed");
  expect(validateName("robot").error).toBeUndefined();
});
test("result requires nonnegative safe integers and an identity and touch boolean", () => {
  expect(validFinish(finish)).toBe(true); expect(isId(finish.playerId)).toBe(true);
  for (const value of [-1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    for (const key of ["score", "squashes", "seconds"]) expect(validFinish({ ...finish, [key]: value })).toBe(false);
  }
  expect(validFinish({ ...finish, touch: 1 })).toBe(false); expect(validFinish(null)).toBe(false);
  expect(validFinish({ ...finish, playerId: "bad" })).toBe(false);
});
test("server elapsed boundaries give seconds two seconds slack but never squash slack", () => {
  expect(plausible(finish, 1000, 2000)).toBe(true);
  expect(plausible(finish, 1000, 1999)).toBe(false);
  expect(plausible({ ...finish, score: 63, seconds: 3 }, 1000, 2000)).toBe(true);
  expect(plausible({ ...finish, score: 64, seconds: 4 }, 1000, 2000)).toBe(false);
  expect(plausible({ ...finish, score: 63 }, 1000, 2000)).toBe(false);
  expect(plausible({ ...finish, score: 2, squashes: 0 }, 1000, 0)).toBe(true);
});
