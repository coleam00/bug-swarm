import { expect, test } from "bun:test";
import { isId, nameKey, plausible, validFinish, validateName } from "./rules";
import { needsReview, parseFinish, REVIEW_SCORE } from "./rules";
import { UPGRADE_IDS } from "../shared/upgrades";
import { BLOCKED_WORDS } from "./blocked-words";
const finish = { playerId: crypto.randomUUID(), score: 62, squashes: 6, seconds: 2, touch: true };

test("only scores strictly above the owner review threshold are held", () => {
  expect(REVIEW_SCORE).toBe(3000);
  expect([2999, 3000, 3001].map(needsReview)).toEqual([false, false, true]);
});

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

test.each([20000, 600000])("squash allowance uses submitted gameplay seconds even after %i ms of wall time", elapsed => {
  const result = (seconds: number, squashes: number) => ({ ...finish, seconds, squashes, score: squashes * 10 + seconds });
  expect(plausible(result(20, 120), 1000, 1000 + elapsed)).toBe(false);
  expect(plausible(result(20, 90), 1000, 1000 + elapsed)).toBe(true);
  expect(plausible(result(20, 91), 1000, 1000 + elapsed)).toBe(false);
  expect(plausible(result(1, 4), 1000, 1000 + elapsed)).toBe(true);
  expect(plausible(result(1, 5), 1000, 1000 + elapsed)).toBe(false);
  expect(plausible(result(0, 0), 1000, 1000 + elapsed)).toBe(true);
  expect(plausible(result(0, 1), 1000, 1000 + elapsed)).toBe(false);
});

test("submitted gameplay duration is capped at 300 seconds despite longer wall time", () => {
  const boundary = { ...finish, seconds: 300, squashes: 0, score: 300 };
  expect(plausible(boundary, 1000, 601000)).toBe(true);
  expect(plausible({ ...boundary, seconds: 301, score: 301 }, 1000, 601000)).toBe(false);
});
test("name rules trim and allow exactly the published character set and lengths", () => {
  expect(validateName("  Robot-7_ ok  ")).toEqual({ name: "Robot-7_ ok" });
  for (const name of [null, "a", "12345678901234567", "🤖", "a<b", "a\nb", "éé", "  "]) expect(validateName(name).error).toBeDefined();
  expect(validateName("ab").name).toBe("ab"); expect(validateName("1234567890123456").name).toBeDefined();
  expect(nameKey(" Mixed-0 ")).toBe("mixed-0");
});
test.each([
  "xxFuCKxx", "5h1t", "b1tch", "cunt", "n1gg3r", "f4gg0t", "nigga", "f u c k", "fuuuck",
  "F-U-C-K", "f_u_c_k", "F_u-U cK", "sh17", "8itch", "8-1_7 c H", "n i g g a", "faggot",
  "ass", "a-s-s", "badass", "bullshit", "wanker", "kike", "chink", "dyke", "retard", "spastic",
  "blowjob", "porn", "hentai", "Scunthorpefuck", "classicfuck", "Hancockfuck", "therapistfuck",
  "Scunthorpe2", "Hancock2",
  "fag123", "coon123", "ass123", "cum123", "tit123", "poof123", "jizz123",
  "F_4_G-123", "c00n_123", "fag888", "fag000", "coon-222",
  "455123", "a55123", "717123", "b008123", "p155123",
  "Larsenfuck", "Draperfuck", "Anushkafuck", "Annalisa2", "Dickens2", "Sam Hancockfuck",
])("moderation rejects %s, including folded vocabulary and combined evasions", name => {
  expect(validateName(name).error).toBeDefined();
});

test.each([
  "Scunthorpe", "classic", "class", "assistant", "Cassie", "Cassandra", "Cassidy", "Jason", "Mason",
  "Thomas", "Jasmine", "Lucas", "Hancock", "Hitchcock", "Cockburn", "Peacock", "Dickinson", "Dickson",
  "Essex", "Sussex", "Middlesex", "Annalise", "analysis", "canal", "therapist", "Robot", "Robot-7_ ok",
  "ArchonFan", "AdminHelper", "SCUN-TH0RPE", "Hanncock",
  "Larsen", "Draper", "Anushka", "Annalisa", "Dickens", "Sam Hancock",
  "Arsen", "Arsene", "Arsenio", "Anush", "Anusha", "Annaliese", "Dickenson", "Van Dyke",
  "Jason123", "classic123", "Cassie123", "Tito123", "Ali123", "Lars123", "Larson", "Sam Jones",
])("ordinary names and words remain eligible: %s", name => {
  expect(validateName(` ${name} `)).toEqual({ name });
});

test.each([
  "colemedin", "cole medin", "dynamous", "archon", "admin", "moderator", "C0L3_M3D1N",
  "D-Y N4M0U5", "AARCh0nn", "4 D M 1 N", "M0D3R470R",
])("reserved equality uses the same normalization: %s", name => {
  expect(validateName(name)).toEqual({ error: "That name is reserved" });
});

test("the curated vocabulary has a few hundred entries that are refused", () => {
  expect(BLOCKED_WORDS.length).toBeGreaterThanOrEqual(250);
  for (const word of BLOCKED_WORDS) {
    expect(validateName(word).error).toBeDefined();
  }
});
test("result requires nonnegative safe integers and an identity and touch boolean", () => {
  expect(validFinish(finish)).toBe(true); expect(isId(finish.playerId)).toBe(true);
  for (const value of [-1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    for (const key of ["score", "squashes", "seconds"]) expect(validFinish({ ...finish, [key]: value })).toBe(false);
  }
  expect(validFinish({ ...finish, touch: 1 })).toBe(false); expect(validFinish(null)).toBe(false);
  expect(validFinish({ ...finish, playerId: "bad" })).toBe(false);
});
test("submitted seconds never exceed server elapsed time and scores must match exactly", () => {
  expect(plausible(finish, 1000, 2999)).toBe(false);
  expect(plausible(finish, 1000, 3000)).toBe(true);
  expect(plausible({ ...finish, score: 63 }, 1000, 3000)).toBe(false);
  expect(plausible({ ...finish, score: 2, squashes: 0 }, 1000, 0)).toBe(false);
  expect(plausible({ ...finish, score: 0, seconds: 0, squashes: 0 }, 1000, 0)).toBe(true);
});
