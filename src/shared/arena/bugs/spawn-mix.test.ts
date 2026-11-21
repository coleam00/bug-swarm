import { expect, test } from "bun:test";
import { dasherShare, spawnKind } from "./spawn-mix";
import { createArena, joinPlayer } from "../simulation";
import { spawnBug } from "../spawn";
test("wave shares unlock at three, rise to one quarter at eight, and solo kind consumes no randomness", () => {
  expect(spawnKind(2, () => { throw Error("unnecessary random draw"); })).toBe("crawler");
  expect(dasherShare(3)).toBe(1 / 6); expect(dasherShare(8)).toBe(1 / 4); expect(dasherShare(900)).toBe(1 / 4);
  expect(dasherShare(5)).toBeGreaterThan(dasherShare(3));
  for (const wave of [3, 5, 8]) {
    const threshold = 1 - dasherShare(wave);
    expect(spawnKind(wave, () => threshold - 0.0001)).toBe("crawler");
    expect(spawnKind(wave, () => threshold + 0.0001)).toBe("dasher");
  }
});
test("seeded production spawning initializes registered kinds without changing placement", () => {
  const run = (wave: number) => {
    const a = createArena(71), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!; a.wave = wave;
    for (let i = 0; i < 150; i++) expect(spawnBug(a, p)).toBe(true);
    return a.bugs;
  };
  expect(run(2).every(b => b.kind === "crawler")).toBe(true);
  const bugs = run(8); expect(bugs).toEqual(run(8));
  const dashers = bugs.filter(b => b.kind === "dasher"); expect(dashers.length).toBeGreaterThan(20); expect(dashers.length).toBeLessThan(55);
  expect(dashers.every(b => b.hp === 2 && b.phase === "approach" && b.phaseUntil === 0)).toBe(true);
});
