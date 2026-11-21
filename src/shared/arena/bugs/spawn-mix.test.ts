import { expect, test } from "bun:test";
import { dasherShare, spawnKind } from "./spawn-mix";
import { createArena, joinPlayer } from "../simulation";
import { spawnBug } from "../spawn";
import { createBug } from "./registry";

test("beetles unlock at five with a constant tenth share, preserve dashers and fall back at ten live", () => {
  for (const wave of [4, 5, 8, 900]) {
    const beetle = wave >= 5 ? 0.1 : 0, crawler = 1 - dasherShare(wave) - beetle - (wave >= 4 ? 1 / 8 : 0);
    const counts = { crawler: 0, dasher: 0, spitter: 0, beetle: 0, hive: 0 };
    for (let i = 0; i < 3000; i++) counts[spawnKind(wave, () => (i + 0.5) / 3000)]++;
    expect(counts.beetle).toBe(beetle * 3000); expect(counts.dasher).toBeCloseTo(dasherShare(wave) * 3000, 0);
    expect(spawnKind(wave, () => crawler - 1e-8)).toBe("crawler");
    expect(spawnKind(wave, () => crawler + 1e-8)).toBe("dasher");
    if (beetle) {
      expect(spawnKind(wave, () => 0.9 - 1e-8)).toBe("spitter");
      expect(spawnKind(wave, () => 0.9 + 1e-8)).toBe("beetle");
    }
  }
  const bugs = Array.from({ length: 9 }, (_, id) => createBug("beetle", id, 0, 0)); let draws = 0;
  const random = () => { draws++; return 0.95; };
  expect(spawnKind(5, random, bugs)).toBe("beetle"); bugs.push(createBug("beetle", 9, 0, 0));
  for (let i = 0; i < 20; i++) expect(spawnKind(5, random, bugs)).toBe("crawler");
  expect(draws).toBe(21); bugs.pop(); expect(spawnKind(5, random, bugs)).toBe("beetle");
});
test("wave shares unlock at three, rise to one quarter at eight, and solo kind consumes no randomness", () => {
  expect(spawnKind(2, () => { throw Error("unnecessary random draw"); })).toBe("crawler");
  expect(dasherShare(3)).toBe(1 / 6); expect(dasherShare(8)).toBe(1 / 4); expect(dasherShare(900)).toBe(1 / 4);
  expect(dasherShare(5)).toBeGreaterThan(dasherShare(3));
  for (const wave of [3, 5, 8]) {
    const threshold = 1 - dasherShare(wave) - (wave >= 4 ? 1 / 8 : 0) - (wave >= 5 ? 0.1 : 0);
    expect(spawnKind(wave, () => threshold - 0.0001)).toBe("crawler");
    expect(spawnKind(wave, () => threshold + 0.0001)).toBe("dasher");
  }
});

test("spitters unlock at four, keep exactly one eighth share, and transfer capped share to crawlers", () => {
  for (const wave of [3, 4, 8, 1000]) {
    const counts = { crawler: 0, dasher: 0, spitter: 0, beetle: 0, hive: 0 };
    for (let i = 0; i < 2400; i++) counts[spawnKind(wave, () => (i + 0.5) / 2400)]++;
    expect(counts.spitter).toBe(wave < 4 ? 0 : 300); expect(counts.dasher / 2400).toBeCloseTo(dasherShare(wave));
    expect(counts.hive).toBe(0);
    const capped = Array.from({ length: 12 }, (_, id) => createBug("spitter", id, 0, 0));
    const cappedCounts = { crawler: 0, dasher: 0, spitter: 0, beetle: 0, hive: 0 };
    for (let i = 0; i < 2400; i++) cappedCounts[spawnKind(wave, () => (i + 0.5) / 2400, capped)]++;
    expect(cappedCounts.spitter).toBe(0); expect(cappedCounts.dasher).toBe(counts.dasher);
    expect(cappedCounts.beetle).toBe(counts.beetle); expect(cappedCounts.crawler).toBe(counts.crawler + counts.spitter);
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
  expect(bugs.filter(b => b.kind === "beetle")).toHaveLength(10);
  const dashers = bugs.filter(b => b.kind === "dasher"); expect(dashers.length).toBeGreaterThan(20); expect(dashers.length).toBeLessThan(55);
  expect(dashers.every(b => b.hp === 2 && b.phase === "approach" && b.phaseUntil === 0)).toBe(true);
});
