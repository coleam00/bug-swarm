import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena } from "../simulation";
import { neutralInput } from "../types";
import { MAX_SHOTS } from "../constants";
import { parseServer, serializeSnapshot } from "../protocol";
test("rapid fires at 10.8 volleys per second with half heat; combining spread retains three pellets per volley", () => {
  for (const spread of [false, true]) {
    const a = createArena(79), p = joinPlayer(a, { id: crypto.randomUUID(), name: "Pilot", team: "tabs" })!; p.x = p.y = 1200;
    a.pickups.push({ id: a.nextId++, kind: "rapid", x: p.x, y: p.y, expiresAt: 12000 });
    if (spread) a.pickups.push({ id: a.nextId++, kind: "spread", x: p.x, y: p.y, expiresAt: 12000 });
    const births: number[] = [], seen = new Set<number>();
    for (let tick = 0; tick < 20; tick++) {
      stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]]));
      for (const s of a.shots) if (!seen.has(s.id)) { seen.add(s.id); births.push(s.born); }
    }
    expect(births).toHaveLength(spread ? 33 : 11); expect(p.heat).toBeCloseTo(spread ? 16.5 : 5.5);
    const volleys = [...new Set(births)]; expect(volleys).toHaveLength(11);
    for (let i = 1; i < volleys.length; i++) expect(volleys[i]! - volleys[i - 1]!).toBeCloseTo(1000 / 10.8);
  }
});
test("fractional heat at rapid expiry and a final spread volley clamp to capacity before lockout", () => {
  for (const spread of [false, true]) {
    const a = createArena(79), p = joinPlayer(a, { id: crypto.randomUUID(), name: "Pilot", team: "tabs" })!;
    p.heat = 17.5; p.effects = { rapid: 0, ...(spread ? { spread: 8000 } : {}) };
    stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]]));
    expect(p.overheatUntil).toBe(1500); expect(p.heat).toBeLessThanOrEqual(18);
    expect(parseServer(serializeSnapshot({ globs: [], v: 1, type: "snapshot", arenaId: "heat", tick: a.tick, wave: a.wave,
      players: [{ ...p, ackSeq: 0 }], bugs: a.bugs, shots: a.shots, events: a.events, pickups: a.pickups }))).not.toBeNull();
  }
});
test("rapid refresh replaces its eight-second deadline and expiry restores ordinary heat and firing interval", () => {
  const a = createArena(79), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!; p.x = p.y = 1200;
  const grant = () => { a.pickups.push({ id: a.nextId++, kind: "rapid", x: p.x, y: p.y, expiresAt: a.tick * 50 + 12000 }); stepArena(a, new Map()); };
  grant(); expect(p.effects.rapid).toBe(8000); while (a.tick < 80) stepArena(a, new Map());
  grant(); expect(p.effects.rapid).toBe(12000);
  while (a.tick < 239) { a.bugs = []; stepArena(a, new Map()); }
  expect(p.effects.rapid).toBe(12000); stepArena(a, new Map()); expect(p.effects.rapid).toBeUndefined();
  stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]]));
  expect(p.heat).toBe(1); expect(p.nextShotAt - a.shots[0]!.born).toBeCloseTo(1000 / 6);
  a.shots = []; p.heat = 0; grant(); grant();
  stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]])); expect(p.heat).toBe(0.5);
  expect(p.nextShotAt - a.shots[0]!.born).toBeCloseTo(1000 / 10.8);
});
test("twenty combined boosted guns respect the shared projectile/impact budget and round-trip snapshots", () => {
  const a = createArena(79), inputs = new Map();
  for (let i = 0; i < 20; i++) {
    const p = joinPlayer(a, { id: crypto.randomUUID(), name: `Pilot-${i}`, team: "tabs" })!; p.x = p.y = 1200;
    p.effects = { rapid: 8000, spread: 8000, shield: 20000 }; inputs.set(p.id, { ...neutralInput(), fire: true });
  }
  let peak = 0;
  for (let tick = 0; tick < 180; tick++) {
    a.bugs = []; stepArena(a, inputs); peak = Math.max(peak, a.shots.length);
    expect(a.shots.length + a.events.length).toBeLessThanOrEqual(MAX_SHOTS);
    expect(parseServer(serializeSnapshot({ globs: [], v: 1, type: "snapshot", arenaId: "boosted", tick: a.tick, wave: a.wave, pickups: a.pickups,
      bugs: a.bugs, shots: a.shots, events: a.events, players: [...a.players.values()].map(p => ({ ...p, ackSeq: 0 })) }))).not.toBeNull();
  }
  expect(peak).toBeGreaterThanOrEqual(540);
});
