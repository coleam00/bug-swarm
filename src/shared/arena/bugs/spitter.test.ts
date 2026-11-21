import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena } from "../simulation";
import { createBug } from "./registry";
import { spitter } from "./spitter";
import { neutralInput } from "../types";

function scene() {
  const a = createArena(78), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  p.x = p.y = 1200;
  const b = createBug("spitter", a.nextId++, 800, 1200); a.bugs.push(b);
  return { a, p, b };
}
test("spitter approaches, retreats, strafes inside 350–450 and selects active targets with id ties", () => {
  const { a, p, b } = scene();
  b.x = 600; spitter.move(b, a.players.values(), 0); expect(b.vx).toBeGreaterThan(130); expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(140);
  b.x = 1000; spitter.move(b, a.players.values(), 0); expect(b.vx).toBeLessThan(-130);
  b.x = 800; spitter.move(b, a.players.values(), 0); expect(b.vx).toBe(0); expect(Math.abs(b.vy)).toBe(35);
  for (let i = 0; i < 100; i++) { spitter.move(b, a.players.values(), 0); b.x += b.vx * 0.05; b.y += b.vy * 0.05; }
  expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeGreaterThan(350); expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeLessThan(450);
  b.x = 800; b.y = 1200;
  const q = { ...p, id: "b", x: 400 }; spitter.move(b, [q, p], 0); expect(b.facing).toBe(0);
  p.status = "downed"; spitter.move(b, [q, p], 0); expect(Math.abs(b.facing)).toBe(Math.PI);
  q.status = "out"; spitter.move(b, [q, p], 0); expect(b.vx).toBe(0); expect(b.vy).toBe(0);
});
test("two movement calls per tick yield 1700ms movement, 500ms swell, one current-position shot every 2200ms", () => {
  const { a, p, b } = scene();
  for (let i = 0; i < 33; i++) stepArena(a, new Map());
  expect(b.phase).toBe("move"); stepArena(a, new Map()); expect(b.phase).toBe("swell"); expect(b.phaseUntil).toBe(2200);
  const position = { x: b.x, y: b.y };
  for (let i = 0; i < 9; i++) stepArena(a, new Map());
  expect(a.globs).toHaveLength(0); expect({ x: b.x, y: b.y }).toEqual(position);
  const before = p.y;
  stepArena(a, new Map([[p.id, { ...neutralInput(), move: { x: 0, y: 1 } }]]));
  expect(p.y).toBeGreaterThan(before); expect(p.vy).toBeGreaterThan(0);
  expect(a.globs).toHaveLength(1); const g = a.globs[0]!; expect(g.born).toBe(2200);
  expect(Math.atan2(g.vy, g.vx)).toBeCloseTo(Math.atan2(p.y - b.y, p.x - b.x));
  expect(Math.hypot(g.x - b.x, g.y - b.y)).toBeCloseTo(28); expect(Math.hypot(g.vx, g.vy)).toBeCloseTo(320);
  // Teleport out of the projectile's path, keeping the source alive.
  p.y = 1700; for (let i = 0; i < 44; i++) stepArena(a, new Map());
  expect(a.globs.some(g => g.born === 4400)).toBe(true);
  const late = createBug("spitter", 999, 500, 500, 10000); expect(late.phaseUntil).toBe(11700);
});
test("a killed final-swell spitter cannot emit; a targetless cycle is consumed without banking", () => {
  const { a, p, b } = scene(); a.tick = 43; Object.assign(b, { phase: "swell", phaseUntil: 2200, hp: 1 });
  a.shots.push({ id: a.nextId++, owner: p.id, life: 1, born: 2150, x: b.x, y: b.y, vx: 900, vy: 0 });
  stepArena(a, new Map()); expect(a.bugs).toHaveLength(0); expect(a.globs).toHaveLength(0); expect(p.score).toBe(33);
  const next = scene(); next.a.tick = 43; Object.assign(next.b, { phase: "swell", phaseUntil: 2200 }); next.p.status = "out";
  stepArena(next.a, new Map()); expect(next.a.globs).toHaveLength(0); expect(next.b.phaseUntil).toBe(3900);
  next.p.status = "active"; stepArena(next.a, new Map([[next.p.id, neutralInput()]])); expect(next.a.globs).toHaveLength(0);
});
test.each(["move", "swell"])("spitter takes two ordinary hits and awards kind value in %s", phase => {
  const { a, p, b } = scene(); Object.assign(b, { phase, phaseUntil: phase === "swell" ? 500 : 1700 });
  for (let i = 0; i < 2; i++) {
    a.shots.push({ id: a.nextId++, owner: p.id, life: 1, born: a.tick * 50, x: b.x, y: b.y, vx: 900, vy: 0 });
    stepArena(a, new Map()); expect(a.events[0]!.type).toBe(i ? "kill" : "hit");
  }
  expect(p.kills).toBe(1); expect(p.score).toBe(36);
});
