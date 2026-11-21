import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena } from "./simulation";
import { createBug } from "./bugs/registry";
import { neutralInput } from "./types";
function scene(x = 1500, y = 1200) {
  const a = createArena(78), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  p.x = p.y = 1200; p.spawnProtectedUntil = 0;
  const g = { id: a.nextId++, x, y, vx: -320, vy: 0, born: 0 }; a.globs.push(g);
  return { a, p, g };
}
test("globs travel 16 units/tick without their source and expire at two seconds or world exit", () => {
  const { a, p, g } = scene(2000, 1600); p.status = "out";
  stepArena(a, new Map()); expect(g.x).toBe(1984);
  for (let i = 1; i < 39; i++) stepArena(a, new Map()); expect(a.globs).toHaveLength(1);
  stepArena(a, new Map()); expect(a.globs).toHaveLength(0); expect(g.x).toBe(1360);
  const edge = scene(10, 800); stepArena(edge.a, new Map()); expect(edge.a.globs).toHaveLength(0); expect(edge.g.x).toBe(0);
});
test("stationary player is hit, perpendicular movement escapes, and swept grazing counts", () => {
  for (const moving of [false, true]) {
    const { a, p } = scene();
    for (let i = 0; i < 25; i++) stepArena(a, new Map([[p.id, { ...neutralInput(), move: { x: 0, y: moving ? 1 : 0 } }]]));
    expect(p.hits).toBe(moving ? 3 : 2);
  }
  const f = scene(1230, 1222.9); stepArena(f.a, new Map()); stepArena(f.a, new Map()); expect(f.p.hits).toBe(2);
});
test("interception consumes both projectiles once, gives fixed +5 and accuracy, no kill, preserves multiplier for next bug", () => {
  const { a, p } = scene(1260); p.streak = 10;
  for (let i = 0; i < 2; i++) a.shots.push({ id: a.nextId++, owner: p.id, life: 1, born: 0, x: 1230, y: 1200, vx: 900, vy: 0 });
  stepArena(a, new Map()); expect(a.globs).toHaveLength(0); expect(a.shots).toHaveLength(1);
  expect(p.score).toBe(5); expect(p.streak).toBe(11); expect(p.kills).toBe(0); expect(a.events).toHaveLength(1); expect(a.events[0]).toMatchObject({ type: "glob-pop", points: 5 });
  const shot = a.shots[0]!; a.bugs.push(createBug("crawler", a.nextId++, shot.x + 30, shot.y));
  stepArena(a, new Map()); expect(p.score).toBe(27); expect(p.kills).toBe(1);
});
test.each(["early", "late", "tie"])("%s interception respects earliest player contact", timing => {
  const { a, p } = scene(1230);
  // Player contact at (30 - 23)/320 seconds; relative shot speed is 1220.
  const x = timing === "early" ? 1200 : timing === "late" ? 1190 : 1230 - 12 - 1220 * 7 / 320;
  a.shots.push({ id: a.nextId++, owner: p.id, life: 1, born: 0, x, y: 1200, vx: 900, vy: 0 });
  stepArena(a, new Map()); expect(p.hits).toBe(timing === "late" ? 2 : 3); expect(p.score).toBe(timing === "late" ? 0 : 5); expect(a.globs).toHaveLength(0);
});
test("nearer bugs block interception, stale-life and downed owners never receive credit", () => {
  const f = scene(1300); f.a.bugs.push(createBug("crawler", f.a.nextId++, 1240, 1200));
  f.a.shots.push({ id: f.a.nextId++, owner: f.p.id, life: 1, born: 0, x: 1230, y: 1200, vx: 900, vy: 0 });
  stepArena(f.a, new Map()); expect(f.p.score).toBe(11); expect(f.a.globs).toHaveLength(1);
  for (const stale of [true, false]) {
    const f = scene(1260); if (!stale) { f.p.status = "downed"; f.p.hits = 0; f.p.downedUntil = 10000; }
    f.a.shots.push({ id: f.a.nextId++, owner: f.p.id, life: stale ? 2 : 1, born: 0, x: 1230, y: 1200, vx: 900, vy: 0 });
    stepArena(f.a, new Map()); expect(f.p.score).toBe(0); expect(f.a.globs).toHaveLength(1); expect(f.a.shots).toHaveLength(0);
  }
});
test("contact consumes globs through protection/immunity, downs on last hit, ignores inactive players", () => {
  for (const protectedBy of ["spawnProtectedUntil", "immuneUntil"] as const) {
    const f = scene(1224); f.p[protectedBy] = 500; stepArena(f.a, new Map()); expect(f.p.hits).toBe(3); expect(f.a.globs).toHaveLength(0);
  }
  const f = scene(1224); f.p.hits = 1; stepArena(f.a, new Map()); expect(f.p.status).toBe("downed"); expect(f.p.downedUntil).toBe(10050);
  f.a.globs.push({ ...f.g, id: f.a.nextId++, x: 1224, born: 50 }); stepArena(f.a, new Map()); expect(f.a.globs).toHaveLength(1);
});
test("simultaneous player contacts use codepoint id ties independent of host locale", () => {
  const { a, p } = scene(1220), q = joinPlayer(a, { id: "Z", name: "Scout", team: "spaces" })!;
  Object.assign(q, { x: p.x, y: p.y, spawnProtectedUntil: 0 });
  stepArena(a, new Map()); expect(q.hits).toBe(2); expect(p.hits).toBe(3); expect(a.globs).toHaveLength(0);
});
test("rapid replacement cannot exceed twelve live globs", () => {
  const { a, p } = scene(); a.globs = []; p.x = p.y = 1800;
  for (let i = 0; i < 12; i++) a.bugs.push(createBug("spitter", a.nextId++, 100 + i * 30, 100));
  let maximum = 0, emitted = 0;
  for (let i = 0; i < 160; i++) {
    // Replace each source immediately after its emission, retaining its glob.
    stepArena(a, new Map()); maximum = Math.max(maximum, a.globs.length);
    if (a.globs.some(g => g.born === a.tick * 50)) {
      emitted++; a.bugs = a.bugs.map(b => b.kind === "spitter" ? createBug("spitter", a.nextId++, b.x, b.y, a.tick * 50) : b);
    }
  }
  expect(emitted).toBeGreaterThan(2); expect(maximum).toBe(12);
});
