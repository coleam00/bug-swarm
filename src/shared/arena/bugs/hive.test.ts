import { expect, test } from "bun:test";
import { createArena, joinPlayer, endLife, leavePlayer, respawnPlayer, stepArena } from "../simulation";
import { createBug } from "./registry";
import { hive, spawnHive, contributeHive, rewardHive } from "./hive";
import { hivePlacement } from "./hive-placement";
import { MAX_BUGS, STEP_MS, WAVE_MS, HIVE_SPEED } from "../constants";
import { spawnBug, pushBugsFromSpawn } from "../spawn";
import { downPlayer } from "../revive";
import type { ArenaState, CombatPlayer } from "../types";

function setup(count = 1) {
  const s = createArena(84);
  for (let i = 0; i < count; i++) joinPlayer(s, { id: String(i), name: `Pilot${i}`, team: i % 2 ? "tabs" : "spaces" });
  return s;
}
function hit(s: ArenaState, p: CombatPlayer) {
  const b = s.bugs.find(b => b.kind === "hive")!;
  s.shots.push({ id: s.nextId++, owner: p.id, life: p.life, x: b.x, y: b.y, vx: 900, vy: 0, born: s.tick * STEP_MS });
  stepArena(s, new Map());
}

test("fifth-wave boundaries spawn exactly one hive, reserve capacity, consume surviving triggers", () => {
  for (const wave of [5, 10, 15]) {
    const s = setup(), p = s.players.get("0")!;
    for (let i = 0; i < MAX_BUGS - 1; i++) s.bugs.push(createBug("crawler", s.nextId++, 100, 100));
    expect(spawnBug(s, p)).toBe(false);
    s.tick = (wave - 1) * WAVE_MS / STEP_MS - 1; s.wave = wave - 1;
    stepArena(s, new Map()); expect(s.hive).toBeUndefined();
    stepArena(s, new Map()); expect(s.wave).toBe(wave); expect(s.bugs).toHaveLength(MAX_BUGS);
    const b = s.bugs.find(b => b.kind === "hive")!;
    expect(b.hp).toBe(180); expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeGreaterThan(600);
    const encounter = s.hive!, broodAt = encounter.broodAt; contributeHive(s, b, p, 2);
    s.tick = (wave + 4) * WAVE_MS / STEP_MS; s.wave = wave + 4;
    stepArena(s, new Map()); expect(s.hive).toBe(encounter); expect(encounter.contributions.get(p.id)?.damage).toBe(2);
    expect(s.bugs.filter(b => b.kind === "hive")).toHaveLength(1); expect(s.hive!.broodAt).toBeGreaterThan(broodAt);
    b.hp = 1; hit(s, p); expect(s.hive).toBeUndefined();
    s.tick = (wave + 5) * WAVE_MS / STEP_MS; s.wave = wave + 5;
    stepArena(s, new Map()); expect(s.hive).toBeUndefined();
    s.tick = (wave + 9) * WAVE_MS / STEP_MS; s.wave = wave + 9;
    stepArena(s, new Map()); expect(s.hive).toBeDefined(); expect(s.bugs.filter(b => b.kind === "hive")).toHaveLength(1);
  }
});

test("placement finds corners, edge bisectors and interior circumcenters deterministically, including degenerate sites", () => {
  expect(hivePlacement([])).toMatchObject({ x: 1200, y: 1200 });
  expect(hivePlacement([{ x: 1200, y: 1200 }])).toMatchObject({ x: 48, y: 48 });
  const corners = [{ x: 48, y: 48 }, { x: 2352, y: 48 }, { x: 48, y: 2352 }, { x: 2352, y: 2352 }];
  expect(hivePlacement(corners)).toMatchObject({ x: 1200, y: 1200 });
  expect(hivePlacement([...corners].reverse())).toEqual(hivePlacement(corners));
  expect(hivePlacement([...corners, corners[0]!])).toEqual(hivePlacement(corners));
  const edge = hivePlacement([{ x: 48, y: 1200 }, { x: 2352, y: 1200 }]);
  expect(edge).toMatchObject({ x: 1200, y: 48 });
  expect(hivePlacement([{ x: 48, y: 48 }, { x: 1200, y: 48 }, { x: 2352, y: 48 }])).toMatchObject({ y: 2352 });
});

test("HP counts active/downed lives, excludes out, freezes at spawn, and permits zero or twenty", () => {
  for (const count of [0, 1, 20]) {
    const s = setup(count); spawnHive(s, 0); const b = s.bugs[0]!;
    expect(b.hp).toBe(120 + 60 * count); expect(b.maxHp).toBe(b.hp);
    if (count) endLife(s, "0");
    expect(b.maxHp).toBe(120 + 60 * count);
  }
  const s = setup(3); downPlayer(s, s.players.get("1")!, 0); endLife(s, "2"); spawnHive(s, 0);
  expect(s.bugs[0]!.maxHp).toBe(240);
});

test("crowded arrival remains harmless for the entire warning and starts full attack delays", () => {
  const s = setup(16); let i = 0;
  for (const p of s.players.values()) { p.x = 48 + i % 4 * 768; p.y = 48 + Math.floor(i++ / 4) * 768; }
  expect(hivePlacement(s.players.values()).clearance).toBeLessThan(600);
  spawnHive(s, 0); const b = s.bugs[0]!, p = s.players.get("0")!;
  Object.assign(p, { x: b.x, y: b.y, spawnProtectedUntil: 0 });
  expect(b.phase).toBe("arrival"); expect(s.hive).toMatchObject({ broodAt: 6000, ringAt: 8000 });
  for (let n = 0; n < 40; n++) { hit(s, p); expect(p.hits).toBe(3); expect(b.hp).toBe(1080); expect(s.bugs).toHaveLength(1); expect(s.globs).toHaveLength(0); }
  expect(b.phase).toBe("active"); s.shots = []; hit(s, p); expect(p.hits).toBe(2); expect(b.hp).toBe(1079);
});

test("exact 600 clearance activates immediately; densest cluster beats lone nearest player, stable ties and bounds", () => {
  // Cover the clipped rectangle with grid cells whose circumradius is 600.
  const s = setup(16); const span = 600 * Math.SQRT2; let i = 0;
  for (const p of s.players.values()) { p.x = Math.min(2352, 48 + (i % 4) * span); p.y = Math.min(2352, 48 + Math.floor(i++ / 4) * span); }
  // Test the activation predicate at an exact corner distance, with all other candidates covered.
  const sites = [...s.players.values()];
  const pos = hivePlacement(sites); expect(pos.clearance).toBeCloseTo(600);
  spawnHive(s, 0); expect(s.bugs[0]!.phase).toBe("active");
  const a = setup(3), [p, q, r] = [...a.players.values()]; spawnHive(a, 0); const b = a.bugs[0]!;
  Object.assign(b, { x: 1200, y: 1200 }); Object.assign(p!, { x: 1150, y: 1200 }); Object.assign(q!, { x: 1600, y: 1200 }); Object.assign(r!, { x: 1700, y: 1200 });
  hive.move(b, a.players.values(), 0); expect(b.vx).toBe(HIVE_SPEED); expect(b.vy).toBe(0);
  q!.status = r!.status = "out"; hive.move(b, a.players.values(), 0); expect(b.vx).toBe(-HIVE_SPEED);
  p!.status = "out"; hive.move(b, a.players.values(), 0); expect(b.vx).toBe(0);
  p!.status = "active"; p!.x = 14; b.x = 48; hive.move(b, a.players.values(), 0); expect(b.vx).toBe(0);
  // Equal solitary clusters choose nearest, then codepoint id, independent of iteration order.
  Object.assign(b, { x: 1200, y: 1200 }); Object.assign(p!, { x: 800, y: 1200 }); Object.assign(q!, { x: 1600, y: 1200, status: "active" });
  hive.move(b, [q!, p!], 0); expect(b.vx).toBe(-HIVE_SPEED);
  q!.x = 1500; hive.move(b, [p!, q!], 0); expect(b.vx).toBe(HIVE_SPEED);
});

test("three crawlers per four seconds, twelve radial slow globs per six, no movement emissions or cap debt", () => {
  const s = setup(); spawnHive(s, 0); const b = s.bugs[0]!;
  for (let i = 0; i < 79; i++) stepArena(s, new Map()); expect(s.bugs.filter(b => b.kind === "crawler")).toHaveLength(0);
  stepArena(s, new Map()); expect(s.bugs.filter(b => b.kind === "crawler")).toHaveLength(3);
  for (let i = 0; i < 40; i++) stepArena(s, new Map()); expect(s.globs).toHaveLength(12);
  for (let i = 0; i < 12; i++) { const g = s.globs[i]!; expect(g.source).toBe("hive"); expect(g.born).toBe(6000); expect(Math.hypot(g.vx, g.vy)).toBeCloseTo(180); expect(g.vx).toBeCloseTo(Math.cos(i * Math.PI / 6) * 180); expect(g.vy).toBeCloseTo(Math.sin(i * Math.PI / 6) * 180); }
  hive.move(b, s.players.values(), 6000); hive.move(b, s.players.values(), 6000); expect(s.globs).toHaveLength(12);
  while (s.bugs.length < MAX_BUGS - 1) s.bugs.push(createBug("crawler", s.nextId++, 100, 100));
  hive.attack!(b, s, 8000); expect(s.bugs).toHaveLength(MAX_BUGS); s.bugs = [b];
  hive.attack!(b, s, 8050); expect(s.bugs).toHaveLength(1); hive.attack!(b, s, 12000); expect(s.bugs).toHaveLength(4);
});

test("actual combat shares conserve 300 plus 50 each, bypass streak multiplier and retain downed credit", () => {
  const s = setup(4); spawnHive(s, 0); const b = s.bugs[0]!;
  const players = [...s.players.values()]; b.hp = 10;
  for (let i = 0; i < 4; i++) {
    players[i]!.streak = 100;
    for (let j = 0; j <= i; j++) {
      if (i === 3 && j === 3) players[1]!.downedUntil = (s.tick + 1) * STEP_MS;
      hit(s, players[i]!);
    }
    if (i === 1) downPlayer(s, players[i]!, s.tick);
  }
  expect(s.bugs.some(b => b.kind === "hive")).toBe(false); expect(s.hive).toBeUndefined();
  expect(players.map(p => p.score)).toEqual([80, 110, 140, 170]); expect(players.reduce((sum, p) => sum + p.score, 0)).toBe(500);
  expect(players.map(p => p.kills)).toEqual([0, 0, 0, 1]);
  expect(players[1]!.status).toBe("out"); expect(s.ended).toMatchObject([{ playerId: "1", score: 110 }]);
  expect(s.events.find(e => e.type === "kill")).toMatchObject({ kind: "hive", points: 0, rewards: players.map(p => ({ playerId: p.id, life: 1, amount: p.score })) });
});

test("rounding ties use player id; ended/departed/reconnected lives lose old damage, revived lives retain it", () => {
  const s = setup(8); spawnHive(s, 0); const b = s.bugs[0]!;
  for (const p of s.players.values()) contributeHive(s, b, p, 1);
  endLife(s, "0"); respawnPlayer(s, "0", 1); leavePlayer(s, "1"); joinPlayer(s, { id: "1", name: "Again", team: "tabs" });
  contributeHive(s, b, s.players.get("0")!, 1); // Replacement credit only.
  downPlayer(s, s.players.get("2")!, 0); Object.assign(s.players.get("2")!, { status: "active", hits: 1, downedUntil: 0 });
  const rewards = rewardHive(s);
  expect(rewards).toHaveLength(7); expect(rewards.some(r => r.playerId === "1")).toBe(false);
  expect(rewards.find(r => r.playerId === "0")).toMatchObject({ life: 2, amount: 93 });
  expect(rewards.find(r => r.playerId === "7")!.amount).toBe(92); expect(rewards.reduce((n, r) => n + r.amount, 0)).toBe(650);
  const unequal = setup(20); spawnHive(unequal, 0);
  contributeHive(unequal, unequal.bugs[0]!, unequal.players.get("0")!, 1319);
  contributeHive(unequal, unequal.bugs[0]!, unequal.players.get("1")!, 1);
  expect(rewardHive(unequal).map(r => r.amount)).toEqual([350, 50]);
});

test("solo is allowed, lethal boundary suppresses attacks, surviving brood/globs and respawn displacement keep their state", () => {
  const s = setup(), p = s.players.get("0")!; spawnHive(s, 0); const b = s.bugs[0]!;
  const encounter = s.hive; pushBugsFromSpawn(s, { x: b.x, y: b.y }); expect(s.hive).toBe(encounter);
  // Return in bounds after explicit test displacement.
  b.x = b.y = 900; s.tick = 119;
  s.hive!.broodAt = s.hive!.ringAt = 6000; b.hp = 1;
  hit(s, p); expect(p.score).toBe(350); expect(s.globs).toHaveLength(0); expect(s.bugs).toHaveLength(0);
  const solo = setup(), player = solo.players.get("0")!; spawnHive(solo, 0); const boss = solo.bugs[0]!;
  player.immuneUntil = 100000;
  Object.assign(boss, { x: 800, y: 800 });
  for (let i = 0; i < 179; i++) hit(solo, player);
  expect(boss.hp).toBe(1); const brood = solo.bugs.filter(b => b.kind === "crawler").map(b => b.id), globs = solo.globs.map(g => g.id);
  hit(solo, player); expect(player.score).toBe(350); expect(solo.bugs.map(b => b.id)).toEqual(brood); expect(solo.globs.map(g => g.id)).toEqual(globs);
});
