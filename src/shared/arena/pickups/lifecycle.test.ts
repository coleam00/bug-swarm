import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena } from "../simulation";
import { createBug } from "../bugs/registry";
import { nextRandom } from "../random";
import { collectPickups, dropPickup } from "./lifecycle";
import { MAX_PICKUPS } from "../constants";
import { neutralInput, type ArenaState } from "../types";

// Invert the LCG to exercise either side of each probability threshold exactly.
function beforeRoll(value: number) { return Number((BigInt(value) - 1013904223n) * 4276115653n & 0xffffffffn); }
function floor(a: ArenaState, x = 1200, y = 1200) {
  const p = { id: a.nextId++, kind: "shield" as const, x, y, expiresAt: a.tick * 50 + 12000 }; a.pickups.push(p); return p;
}
test("seeded successful drops can deliver shield, spread and rapid rather than a shield-only catalog", () => {
  const kinds = [];
  for (const roll of [0, 1000, 1500]) {
    const a = createArena(79); a.pickupRandom = beforeRoll(roll);
    dropPickup(a, "crawler", 500, 500, 0); expect(a.pickups).toHaveLength(1); kinds.push(a.pickups[0]!.kind);
  }
  expect(kinds.sort()).toEqual(["rapid", "shield", "spread"]);
});
test("specified 2%, 6%, 6%, 15% rates accept the last roll below each threshold and reject above", () => {
  for (const [kind, chance] of [["crawler", 0.02], ["dasher", 0.06], ["spitter", 0.06], ["beetle", 0.15]] as const) {
    const a = createArena(79), threshold = Math.ceil(chance * 4294967296);
    for (const [roll, drops] of [[threshold - 1, 1], [threshold, 0], [4294967295, 0], [0, 1]]) {
      a.pickups = []; a.pickupRandom = beforeRoll(roll!);
      dropPickup(a, kind, 100, 200, 500);
      expect(a.pickups).toHaveLength(drops!);
      if (drops) expect(a.pickups[0]).toMatchObject({ x: 100, y: 200, expiresAt: 12550 });
    }
  }
});
test("seeded drops replay independently of spawn randomness, including rolls rejected by the floor cap", () => {
  const replay = () => {
    const a = createArena(79), spawnRandom = a.random;
    const drops: number[] = [];
    for (let i = 0; i < 1000; i++) { a.pickups = []; dropPickup(a, "crawler", 100, 200, 0); if (a.pickups.length) drops.push(i); }
    expect(a.random).toBe(spawnRandom); return drops;
  };
  const sequence = replay(); expect(sequence).toEqual(replay());
  const a = createArena(79); for (let i = 0; i < MAX_PICKUPS; i++) floor(a, i * 100, 100);
  const ids = a.pickups.map(p => p.id), nextId = a.nextId;
  a.pickupRandom = beforeRoll(0); dropPickup(a, "beetle", 500, 500, 0);
  expect(a.pickupRandom).toBe(0); expect(a.nextId).toBe(nextId); expect(a.pickups.map(p => p.id)).toEqual(ids);
});
test("only lethal impacts roll; drops use the impact position and cannot be collected in that step", () => {
  const a = createArena(79), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  p.x = p.y = 1200; const b = createBug("dasher", a.nextId++, 1225, 1200); a.bugs.push(b);
  const shot = () => a.shots.push({ id: a.nextId++, owner: p.id, life: p.life, x: b.x, y: b.y, vx: 900, vy: 0, born: a.tick * 50 });
  a.pickupRandom = beforeRoll(0); const random = a.pickupRandom; shot(); stepArena(a, new Map());
  expect(b.hp).toBe(1); expect(a.pickupRandom).toBe(random); expect(a.pickups).toEqual([]);
  shot(); stepArena(a, new Map()); expect(a.bugs).toEqual([]); expect(a.pickupRandom).not.toBe(random);
  expect(a.pickups).toHaveLength(1); expect(a.pickups[0]).toMatchObject({ x: a.events[0]!.x, y: a.events[0]!.y, expiresAt: 12100 });
  expect(p.effects).toEqual({}); stepArena(a, new Map()); expect(a.pickups).toEqual([]); expect(p.effects.shield).toBe(20100);
});
test("several lethal hits in one step never exceed six floor pickups", () => {
  const a = createArena(79), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  for (let i = 0; i < 5; i++) floor(a, 100 + i * 100, 100);
  // This stream starts with two consecutive sub-2% crawler rolls.
  let seed = 0; while (nextRandom(seed) / 4294967296 >= 0.02 || nextRandom(nextRandom(seed)) / 4294967296 >= 0.02) seed++;
  a.pickupRandom = seed;
  for (let i = 0; i < 3; i++) { const b = createBug("crawler", a.nextId++, 500 + i * 100, 500); a.bugs.push(b); a.shots.push({ id: a.nextId++, owner: p.id, life: 1, x: b.x, y: b.y, vx: 900, vy: 0, born: 0 }); }
  stepArena(a, new Map()); expect(p.kills).toBe(3); expect(a.pickups).toHaveLength(6);
  // Chance rolls continue at capacity, without allocating or banking extra drops.
  expect(a.pickupRandom).not.toBe(seed);
});

test("armour bounces do not roll drops, while a lethal rear hit on a beetle does", () => {
  const a = createArena(79), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  p.x = p.y = 1200; const b = createBug("beetle", a.nextId++, 1600, 1200); a.bugs = [b];
  a.pickupRandom = beforeRoll(0); const random = a.pickupRandom;
  const shot = (side: number) => a.shots.push({ id: a.nextId++, owner: p.id, life: p.life, x: b.x + side * 25, y: b.y, vx: -side * 900, vy: 0, born: a.tick * 50 });
  shot(1); stepArena(a, new Map());
  expect(b.hp).toBe(5); expect(a.events[0]!.type).toBe("bounce"); expect(a.pickups).toEqual([]); expect(a.pickupRandom).toBe(random);
  b.hp = 1; shot(-1); stepArena(a, new Map());
  expect(a.events[0]!.type).toBe("kill"); expect(a.pickups).toHaveLength(1); expect(a.pickupRandom).not.toBe(random);
});
test("a moving bug drops at the swept impact rather than either end of its step", () => {
  const a = createArena(79), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  p.x = p.y = 1200; a.pickupRandom = beforeRoll(0);
  a.bugs.push(createBug("crawler", a.nextId++, 1325, 1200));
  a.shots.push({ id: a.nextId++, owner: p.id, life: 1, x: 1300, y: 1200, vx: 900, vy: 0, born: 0 });
  stepArena(a, new Map());
  expect(a.pickups).toHaveLength(1); expect(a.pickups[0]!.x).toBeCloseTo(1325 - 140 * 10 / 1040, 6);
  expect(a.pickups[0]!.y).toBe(1200); expect(a.pickups[0]!.x).toBe(a.events[0]!.x);
});
test("floor expiry is exactly twelve seconds; an expired overlap never grants an effect", () => {
  const a = createArena(79), pickup = floor(a);
  for (let i = 0; i < 239; i++) stepArena(a, new Map()); expect(a.pickups).toEqual([pickup]);
  stepArena(a, new Map()); expect(a.pickups).toEqual([]);
  const p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!; floor(a, p.x, p.y).expiresAt = 12000;
  stepArena(a, new Map()); expect(p.effects).toEqual({});
});
test("swept earliest touch wins across teams independently of insertion order; equal times use player id", () => {
  for (const reverse of [false, true]) for (const tie of [false, true]) {
    const a = createArena(79);
    for (const id of reverse ? ["b", "a"] : ["a", "b"]) joinPlayer(a, { id, name: `Pilot-${id}`, team: id === "a" ? "tabs" : "spaces" });
    const p = a.players.get("a")!, q = a.players.get("b")!;
    Object.assign(p, { x: 1165, y: 1200 }); Object.assign(q, { x: tie ? 1165 : 1168, y: 1200 }); floor(a);
    stepArena(a, new Map([[p.id, { ...neutralInput(), move: { x: 1, y: 0 } }], [q.id, { ...neutralInput(), move: { x: 1, y: 0 } }]]));
    expect(a.pickups).toEqual([]); expect(p.effects).toEqual(tie ? { shield: 20000 } : {}); expect(q.effects).toEqual(tie ? {} : { shield: 20000 });
  }
});
test("swept near-tangent crossings collect even with both endpoints outside; inactive players cannot collect", () => {
  const a = createArena(79), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  Object.assign(p, { x: 1195.5, y: 1229.9 }); floor(a);
  stepArena(a, new Map([[p.id, { ...neutralInput(), move: { x: 1, y: 0 } }]])); expect(p.effects.shield).toBe(20000);
  for (const status of ["downed", "out"] as const) { p.effects = {}; Object.assign(p, { status, x: 1200, y: 1200 }); floor(a); collectPickups(a, 50); expect(p.effects).toEqual({}); }
});
