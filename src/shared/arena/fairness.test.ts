import { expect, test } from "bun:test";
import { createArena, joinPlayer, respawnPlayer, endLife, leavePlayer, stepArena } from "./simulation";
import { safeSpawn, pushBugsFromSpawn, spawnBug } from "./spawn";
import { threatRate } from "./threat";
import { MAX_BUGS, MAX_VIEW, STEP_MS, VISIBILITY_PADDING } from "./constants";
import { cameraFor } from "./view";
import { neutralInput, type Bug } from "./types";
const identity = (id = "p") => ({ id, name: "Pilot", team: "tabs" as const });
const bug = (id: number, x: number, y: number): Bug => ({ id, kind: "crawler", hp: 1, facing: 0, x, y, vx: 3, vy: 4 });
const inset = (p: { x: number; y: number }) => Math.min(p.x, p.y, 2400 - p.x, 2400 - p.y);

test("join and repeated respawns stay inside the inset, clear bugs and avoid living robots", () => {
  for (let seed = 0; seed < 20; seed++) {
    const a = createArena(seed), friend = joinPlayer(a, identity("friend"))!;
    a.bugs = Array.from({ length: 50 }, (_, i) => bug(i, 300 + i % 10 * 65, 300 + Math.floor(i / 10) * 65));
    const p = joinPlayer(a, identity())!;
    expect(Math.hypot(p.x - 450, p.y - 450)).toBeGreaterThan(1500);
    for (let life = 0; life < 8; life++) {
      expect(inset(p)).toBeGreaterThanOrEqual(450);
      expect(Math.hypot(p.x - friend.x, p.y - friend.y)).toBeGreaterThanOrEqual(28);
      expect(a.bugs.every(b => Math.hypot(b.x - p.x, b.y - p.y) >= 300 - 1e-8)).toBe(true);
      endLife(a, p.id); respawnPlayer(a, p.id, p.life);
    }
  }
});

test("crowded searches push only nearby bugs, straight outward, without kills, state loss or scoring", () => {
  const a = createArena(9), friend = joinPlayer(a, identity("friend"))!;
  friend.score = 37; friend.points = 370;
  a.bugs = Array.from({ length: 144 }, (_, i) => bug(i, 375 + i % 12 * 150, 375 + Math.floor(i / 12) * 150));
  const before = structuredClone(a.bugs), p = joinPlayer(a, identity())!;
  expect(inset(p)).toBeGreaterThanOrEqual(450); expect(a.bugs).toHaveLength(144);
  let pushes = 0;
  for (let i = 0; i < a.bugs.length; i++) {
    const b = a.bugs[i]!, old = before[i]!, distance = Math.hypot(old.x - p.x, old.y - p.y);
    expect({ ...b, x: old.x, y: old.y }).toEqual(old);
    expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeGreaterThanOrEqual(300 - 1e-8);
    if (distance < 300) {
      pushes++; expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeCloseTo(300);
      expect((b.x - p.x) * (old.y - p.y) - (b.y - p.y) * (old.x - p.x)).toBeCloseTo(0);
    } else expect(b).toEqual(old);
    expect(inset(b)).toBeGreaterThanOrEqual(0);
  }
  expect(pushes).toBeGreaterThan(0); expect(friend.score).toBe(37); expect(p.score).toBe(0); expect(a.events).toEqual([]);
  expect(a.ended).toEqual([]);
});

test("coincident bugs get deterministic finite push directions and keep all other state", () => {
  const a = createArena(1), point = { x: 450, y: 450 };
  a.bugs = [bug(1, 450, 450), bug(2, 450, 450)];
  const b = structuredClone(a); pushBugsFromSpawn(a, point); pushBugsFromSpawn(b, point);
  expect(a).toEqual(b);
  for (const bug of a.bugs) { expect(Math.hypot(bug.x - 450, bug.y - 450)).toBeCloseTo(300); expect(bug.vx).toBe(3); }
});

test("spawn protection lasts two seconds, then uses independent one-second contact immunity", () => {
  const a = createArena(1), p = joinPlayer(a, identity())!;
  a.bugs = [bug(5, p.x, p.y)];
  for (let tick = 0; tick < 40; tick++) stepArena(a, new Map());
  expect(p.hits).toBe(3); expect(p.immuneUntil).toBe(0);
  stepArena(a, new Map()); expect(p.hits).toBe(2); expect(p.immuneUntil).toBe(3000);
  const fire = new Map([[p.id, { ...neutralInput(), aim: Math.PI, fire: true }]]);
  stepArena(a, fire); expect(p.immuneUntil).toBe(3000); expect(p.spawnProtectedUntil).toBe(0); expect(p.hits).toBe(2);
});

test("only an emitted shot ends spawn protection, before the same step's contacts", () => {
  const a = createArena(1), p = joinPlayer(a, identity())!;
  a.bugs = [bug(5, p.x, p.y)]; p.overheatUntil = 1000;
  const fire = new Map([[p.id, { ...neutralInput(), fire: true }]]);
  stepArena(a, fire); expect(p.spawnProtectedUntil).toBe(2000); expect(p.hits).toBe(3); expect(a.shots).toHaveLength(0);
  p.overheatUntil = 0; p.nextShotAt = 100; stepArena(a, fire); expect(p.spawnProtectedUntil).toBe(2000);
  stepArena(a, fire); expect(p.spawnProtectedUntil).toBe(0); expect(p.hits).toBe(2);
});

test("personal rate knots interpolate and clamp", () => {
  for (const [seconds, rate] of [[-3, 0.1], [0, 0.1], [30, 2.175], [60, 4.25], [90, 4.625], [120, 5], [180, 5.5], [240, 6], [900, 6]])
    expect(threatRate(seconds!)).toBeCloseTo(rate!);
});

test("integrated requests follow life age independently of wave or arena age, with no wave volume", () => {
  for (const arenaAge of [0, 480]) {
    const a = createArena(4); a.tick = arenaAge * 20; a.wave = arenaAge / 30;
    const p = joinPlayer(a, identity())!; p.x = p.y = 1200;
    for (const [seconds, expected, remainder] of [[60, 130, 0.5], [120, 408, 0], [240, 1068, 0], [300, 1428, 0]]) {
      while (a.tick < (arenaAge + seconds!) * 20) { a.bugs.length = 0; stepArena(a, new Map()); }
      expect(a.nextId - 1).toBe(expected!); expect(a.spawnCredits.get(p.id)).toBeCloseTo(remainder!);
    }
    expect(a.wave).toBe(arenaAge / 30 + 10);
  }
  const a = createArena(2); a.tick = 480 * 20;
  const p = joinPlayer(a, identity())!, q = joinPlayer(a, identity("q"))!; q.startedTick -= 120 * 20;
  stepArena(a, new Map());
  expect(a.spawnCredits.get(p.id)).toBeCloseTo((0.1 + threatRate(0.05)) / 40);
  expect(a.spawnCredits.get(q.id)).toBeCloseTo((5 + threatRate(120.05)) / 40);
  endLife(a, p.id); expect(a.spawnCredits.has(p.id)).toBe(false);
  respawnPlayer(a, p.id, p.life); expect(a.spawnCredits.get(p.id)).toBe(0); expect(p.startedTick).toBe(a.tick);
  expect(p.spawnProtectedUntil).toBe(a.tick * STEP_MS + 2000);
  leavePlayer(a, q.id); expect(a.spawnCredits.has(q.id)).toBe(false);
});

test("capacity consumes requests without debt and rotates successful allocation through stable slots", () => {
  const a = createArena(2);
  for (let i = 0; i < 20; i++) { const p = joinPlayer(a, identity(String(i)))!; p.x = p.y = 1200; }
  for (let round = 0; round < 40; round++) {
    a.bugs = Array.from({ length: MAX_BUGS - 1 }, (_, i) => bug(10000 + i, 0, 0));
    for (const p of a.players.values()) a.spawnCredits.set(p.id, 0.999);
    stepArena(a, new Map()); expect(a.bugs).toHaveLength(MAX_BUGS); expect(a.spawnCursor).toBe(round % 20);
    for (const credit of a.spawnCredits.values()) expect(credit).toBeLessThan(1);
  }
  a.bugs.length = 0; stepArena(a, new Map()); expect(a.bugs).toHaveLength(0);
});

test("bug births favour outer regions within the source annulus, in bounds and outside every living player's view", () => {
  const a = createArena(22), p = joinPlayer(a, identity())!, q = joinPlayer(a, identity("q"))!;
  p.x = p.y = 450; q.x = 1600; q.y = 1200;
  for (let i = 0; i < 150; i++) spawnBug(a, p);
  expect(a.bugs).toHaveLength(150);
  let outer = 0;
  for (const b of a.bugs) {
    const distance = Math.hypot(b.x - p.x, b.y - p.y);
    expect(distance).toBeGreaterThanOrEqual(600 - 1e-8); expect(distance).toBeLessThanOrEqual(900 + 1e-8); expect(inset(b)).toBeGreaterThanOrEqual(0);
    if (inset(b) < 450) outer++;
    for (const player of [p, q]) {
      const c = cameraFor(player.x, player.y, MAX_VIEW, MAX_VIEW);
      expect(b.x < c.x - VISIBILITY_PADDING || b.x > c.x + MAX_VIEW + VISIBILITY_PADDING || b.y < c.y - VISIBILITY_PADDING || b.y > c.y + MAX_VIEW + VISIBILITY_PADDING).toBe(true);
      expect(Math.hypot(b.x - player.x, b.y - player.y)).toBeGreaterThanOrEqual(500);
    }
  }
  // This source has outer candidates; favour them over scattering attackers through the interior.
  expect(outer).toBeGreaterThan(a.bugs.length * 0.8);
});
