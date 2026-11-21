import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena, endLife, respawnPlayer, leavePlayer } from "../simulation";
import { createBug } from "../bugs/registry";
import { damagePlayer } from "../damage";
import { downPlayer } from "../revive";
import { SHIELD_MS, STEP_MS } from "../constants";
import { neutralInput } from "../types";

function setup() {
  const arena = createArena(79), p = joinPlayer(arena, { id: "a", name: "Pilot", team: "tabs" })!;
  Object.assign(p, { x: 1200, y: 1200, spawnProtectedUntil: 0 });
  return { arena, p };
}
function grant(f: ReturnType<typeof setup>) {
  f.arena.pickups.push({ id: f.arena.nextId++, kind: "shield", x: f.p.x, y: f.p.y, expiresAt: f.arena.tick * STEP_MS + 12000 });
  stepArena(f.arena, new Map());
}
test.each(["crawler", "dasher"] as const)("shield absorbs one eligible %s contact, preserves life/score/streak and grants hit immunity", kind => {
  const f = setup(), { arena, p } = f; grant(f);
  p.effects.spread = p.effects.rapid = 8000;
  p.points = 100; p.score = 10; p.streak = 7;
  arena.bugs.push(createBug(kind, arena.nextId++, p.x, p.y), createBug("crawler", arena.nextId++, p.x, p.y));
  stepArena(arena, new Map());
  expect(p.effects).toEqual({ spread: 8000, rapid: 8000 }); expect(p.hits).toBe(3); expect(p.immuneUntil).toBe(1050);
  expect(p).toMatchObject({ status: "active", life: 1, score: 10, streak: 7, kills: 0 });
  for (let i = 0; i < 19; i++) stepArena(arena, new Map());
  expect(p.hits).toBe(3); stepArena(arena, new Map()); expect(p.hits).toBe(2);
});
test("twenty-second deadline is exact; same-kind collection replaces the timer without stacking charges", () => {
  const f = setup(); grant(f); expect(f.p.effects.shield).toBe(SHIELD_MS);
  for (let i = 0; i < 100; i++) { f.arena.bugs = []; stepArena(f.arena, new Map()); }
  const collectedAt = f.arena.tick * STEP_MS; grant(f);
  expect(f.p.effects).toEqual({ shield: collectedAt + SHIELD_MS });
  while (f.arena.tick * STEP_MS < collectedAt + SHIELD_MS - STEP_MS) { f.arena.bugs = []; stepArena(f.arena, new Map()); }
  expect(f.p.effects.shield).toBe(collectedAt + SHIELD_MS);
  stepArena(f.arena, new Map()); expect(f.p.effects).toEqual({});
  f.p.immuneUntil = 0; expect(damagePlayer(f.arena, f.p, f.arena.tick * STEP_MS)).toBe(true); expect(f.p.hits).toBe(2);
  grant(f); grant(f); f.p.immuneUntil = 0;
  damagePlayer(f.arena, f.p, f.arena.tick * STEP_MS); expect(f.p.hits).toBe(2); expect(f.p.effects).toEqual({});
});
test("protection and immunity precede shield; firing cancels only spawn protection", () => {
  const f = setup(); grant(f); const { arena, p } = f;
  p.spawnProtectedUntil = 1000;
  expect(damagePlayer(arena, p, 50)).toBe(false); expect(p.effects.shield).toBe(SHIELD_MS);
  p.spawnProtectedUntil = 0; p.immuneUntil = 1000;
  expect(damagePlayer(arena, p, 50)).toBe(false); expect(p.effects.shield).toBe(SHIELD_MS);
  stepArena(arena, new Map([[p.id, { ...neutralInput(), fire: true }]]));
  expect(arena.shots).toHaveLength(1); expect(p.effects.shield).toBe(SHIELD_MS);
  p.immuneUntil = 0; expect(damagePlayer(arena, p, SHIELD_MS)).toBe(true); expect(p.hits).toBe(2);
});
test("collection participates in the same step's firing and contact without pausing play", () => {
  const { arena, p } = setup(); p.spawnProtectedUntil = 2000;
  arena.pickups.push({ id: arena.nextId++, kind: "shield", x: p.x, y: p.y, expiresAt: 12000 });
  arena.bugs.push(createBug("crawler", arena.nextId++, p.x + 20, p.y));
  stepArena(arena, new Map([[p.id, { ...neutralInput(), aim: Math.PI, fire: true }]]));
  expect(arena.tick).toBe(1); expect(arena.shots).toHaveLength(1); expect(p.spawnProtectedUntil).toBe(0);
  expect(p.hits).toBe(3); expect(p.effects).toEqual({}); expect(p.immuneUntil).toBe(1000); expect(p.score).toBe(0);
});
test("downing, termination, departure and respawn clear effects; revival does not restore them", () => {
  const f = setup(); grant(f); f.p.effects.spread = f.p.effects.rapid = 8000; downPlayer(f.arena, f.p); expect(f.p.effects).toEqual({});
  const helper = joinPlayer(f.arena, { id: "b", name: "Helper", team: "spaces" })!;
  Object.assign(helper, { x: f.p.x, y: f.p.y });
  for (let i = 0; i < 40; i++) stepArena(f.arena, new Map());
  expect(f.p.status).toBe("active"); expect(f.p.effects).toEqual({}); grant(f);
  expect(helper.effects).toEqual({}); endLife(f.arena, f.p.id); expect(f.p.effects).toEqual({});
  respawnPlayer(f.arena, f.p.id, f.p.life); expect(f.p.effects).toEqual({}); grant(f);
  leavePlayer(f.arena, f.p.id); expect(f.p.effects).toEqual({}); expect(f.arena.players.has(f.p.id)).toBe(false);
});
