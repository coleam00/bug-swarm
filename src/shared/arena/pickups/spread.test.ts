import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena } from "../simulation";
import { neutralInput } from "../types";
import { PICKUP_KINDS } from "./registry";
test("the pickup catalog delivers all three required kinds", () => {
  expect([...PICKUP_KINDS].sort()).toEqual(["rapid", "shield", "spread"]);
});
test("spread emits three independently travelling shots in a twenty-degree fan with heat per projectile", () => {
  const a = createArena(79), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  p.x = p.y = 1200;
  a.pickups.push({ id: a.nextId++, kind: "spread", x: p.x, y: p.y, expiresAt: 12000 });
  stepArena(a, new Map([[p.id, { ...neutralInput(), aim: 0.6, fire: true }]]));
  expect(a.shots).toHaveLength(3); expect(p.heat).toBe(3);
  const directions = a.shots.map(s => Math.atan2(s.vy, s.vx));
  expect(directions[0]).toBeCloseTo(0.6 - Math.PI / 18); expect(directions[1]).toBeCloseTo(0.6); expect(directions[2]).toBeCloseTo(0.6 + Math.PI / 18);
  expect(new Set(a.shots.map(s => s.id)).size).toBe(3);
  const before = a.shots.map(s => ({ ...s })); stepArena(a, new Map());
  for (let i = 0; i < 3; i++) { expect(a.shots[i]!.x - before[i]!.x).toBeCloseTo(before[i]!.vx * 0.05); expect(a.shots[i]!.y - before[i]!.y).toBeCloseTo(before[i]!.vy * 0.05); }
});
test("spread lasts exactly eight seconds and a second pickup refreshes without stacking pellets or time", () => {
  const a = createArena(79), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!; p.x = p.y = 1200;
  const grant = () => { a.pickups.push({ id: a.nextId++, kind: "spread", x: p.x, y: p.y, expiresAt: a.tick * 50 + 12000 }); stepArena(a, new Map()); };
  grant(); expect(p.effects.spread).toBe(8000);
  for (let i = 0; i < 79; i++) stepArena(a, new Map()); grant(); expect(p.effects.spread).toBe(12000);
  while (a.tick < 239) { a.bugs = []; stepArena(a, new Map()); }
  expect(p.effects.spread).toBe(12000); stepArena(a, new Map()); expect(p.effects.spread).toBeUndefined();
  stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]])); expect(a.shots).toHaveLength(1);
  a.shots = []; p.nextShotAt = a.tick * 50; grant(); grant();
  stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]])); expect(a.shots).toHaveLength(3);
});
