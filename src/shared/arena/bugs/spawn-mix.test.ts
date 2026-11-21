import { expect, test } from "bun:test";
import { dasherShare, spawnKind } from "./spawn-mix";
import { createArena, joinPlayer } from "../simulation";
import { spawnBug } from "../spawn";
import { createBug } from "./registry";
test("wave shares unlock at three, rise to one quarter at eight, and solo kind consumes no randomness", () => {
  expect(spawnKind(2, () => { throw Error("unnecessary random draw"); })).toBe("crawler");
  expect(dasherShare(3)).toBe(1 / 6); expect(dasherShare(8)).toBe(1 / 4); expect(dasherShare(900)).toBe(1 / 4);
  expect(dasherShare(5)).toBeGreaterThan(dasherShare(3));
  for (const wave of [3, 5, 8]) {
    const threshold = 1 - dasherShare(wave) - (wave >= 4 ? 1 / 8 : 0);
    expect(spawnKind(wave, () => threshold - 0.0001)).toBe("crawler");
    expect(spawnKind(wave, () => threshold + 0.0001)).toBe("dasher");
  }
});

test("spitters unlock at four, keep exactly one eighth share, and transfer capped share to crawlers", () => {
  for (const wave of [3, 4, 8, 1000]) {
    const counts = { crawler: 0, dasher: 0, spitter: 0, hive: 0 };
    for (let i = 0; i < 2400; i++) counts[spawnKind(wave, () => (i + 0.5) / 2400)]++;
    expect(counts.spitter).toBe(wave < 4 ? 0 : 300); expect(counts.dasher / 2400).toBeCloseTo(dasherShare(wave));
    expect(counts.hive).toBe(0);
    expect(spawnKind(wave, () => 0.999, false)).toBe("dasher");
  }
  const a = createArena(78), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!; a.wave = 4; a.tick = 2000;
  for (let i = 0; i < 12; i++) a.bugs.push(createBug("spitter", a.nextId++, 100, 100, a.tick * 50));
  for (let i = 0; i < 137; i++) expect(spawnBug(a, p)).toBe(true);
  expect(a.bugs.filter(b => b.kind === "spitter")).toHaveLength(12); expect(a.bugs).toHaveLength(149); expect(spawnBug(a, p)).toBe(false);
});
test("seeded production spawning initializes registered kinds without changing placement", () => {
  const run = (wave: number) => {
    const a = createArena(71), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!; a.wave = wave;
    for (let i = 0; i < 149; i++) expect(spawnBug(a, p)).toBe(true);
    return a.bugs;
  };
  expect(run(2).every(b => b.kind === "crawler")).toBe(true);
  const bugs = run(8); expect(bugs).toEqual(run(8));
  const dashers = bugs.filter(b => b.kind === "dasher"); expect(dashers.length).toBeGreaterThan(20); expect(dashers.length).toBeLessThan(55);
  expect(dashers.every(b => b.hp === 2 && b.phase === "approach" && b.phaseUntil === 0)).toBe(true);
});
