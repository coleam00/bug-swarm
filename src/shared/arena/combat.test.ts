import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena, respawnPlayer, endLife } from "./simulation";
import { fireAndAdvance, circleEntry } from "./combat";
import { crawler } from "./bugs/crawler";
import { createBug } from "./bugs/registry";
import { spawnBug, safeSpawn } from "./spawn";
import { CRAWLER_SPEED, MAX_BUGS, MAX_SHOTS, MAX_PLAYERS, MUZZLE_OFFSET, SHOT_RATE, SHOT_SPEED, STEP_MS } from "./constants";
import { parseServer, serializeSnapshot } from "./protocol";
import { neutralInput, type Bug } from "./types";
function fixture() { const a = createArena(21), p = joinPlayer(a, { id: "a", name: "Robot", team: "tabs" })!; p.x = p.y = 1200; return { a, p }; }
const bug = (id: number, x: number, y = 1200): Bug => ({ id, kind: "crawler", hp: 1, facing: 0, x, y, vx: 0, vy: 0 });

test("surviving impacts credit accuracy without a kill; lethal shooter receives one kind-valued award", () => {
  for (const split of [false, true]) {
    const { a, p } = fixture(), q = joinPlayer(a, { id: "b", name: "Other", team: "spaces" })!;
    const b = createBug("dasher", 999, 1250, 1200); a.bugs.push(b);
    const hit = (owner: string) => { a.shots.push({ id: a.nextId++, owner, life: 1, x: 1230, y: 1200, vx: 900, vy: 0, born: 0 }); fireAndAdvance(a, new Map(), 0); };
    hit(p.id); expect(b.hp).toBe(1); expect(p.streak).toBe(1); expect(p.score).toBe(0); expect(p.kills).toBe(0);
    expect(a.events).toHaveLength(1); expect(a.events[0]).toMatchObject({ type: "hit", kind: "dasher", points: 0 });
    hit(split ? q.id : p.id);
    expect(a.bugs).toHaveLength(0); expect(a.events).toHaveLength(2); expect(a.events[1]).toMatchObject({ type: "kill", kind: "dasher", points: split ? 27.5 : 30 });
    expect(p.streak).toBe(split ? 1 : 2); expect(p.kills).toBe(split ? 0 : 1); expect(q.kills).toBe(split ? 1 : 0);
    expect(split ? q.points : p.points).toBe(split ? 275 : 300);
  }
});

test("a projectile damages a recovering dasher without interrupting its recovery", () => {
  const { a, p } = fixture(), b = createBug("dasher", a.nextId++, 960, 1200); a.bugs.push(b);
  const step = () => stepArena(a, new Map()); step(); p.y = 1400;
  while (a.tick * 50 < 1150) step();
  expect(b.phase).toBe("recovery"); const until = b.phaseUntil;
  a.shots.push({ id: a.nextId++, owner: p.id, life: p.life, born: 1150, x: b.x, y: b.y, vx: 900, vy: 0 });
  step();
  expect(b.hp).toBe(1); expect(b.phase).toBe("recovery"); expect(b.phaseUntil).toBe(until);
  expect(a.events).toHaveLength(1); expect(a.events[0]).toMatchObject({ type: "hit", kind: "dasher", points: 0 });
});

test("nonlethal hit remains eligible for contact; projectile meets the stationary part of a wall stop", () => {
  const { a, p } = fixture(); p.spawnProtectedUntil = 0;
  const b = createBug("dasher", 999, 1210, 1200); a.bugs.push(b);
  a.shots.push({ id: a.nextId++, owner: p.id, life: 1, x: 1210, y: 1200, vx: 900, vy: 0, born: 0 });
  stepArena(a, new Map()); expect(b.hp).toBe(1); expect(p.hits).toBe(2); expect(p.kills).toBe(0);
  Object.assign(b, { x: 2399, y: 1200, vx: 490, vy: 0 });
  a.shots.push({ id: a.nextId++, owner: p.id, life: 1, x: 2378, y: 1200, vx: 900, vy: 0, born: 50 });
  fireAndAdvance(a, new Map(), 50);
  expect(a.bugs).toHaveLength(0); expect(a.events.at(-1)!.x).toBe(2400);
});
test("release/repress preserves the six-per-second cooldown and full-room snapshot bounds", () => {
  const a = createArena(1), inputs = new Map();
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = joinPlayer(a, { id: crypto.randomUUID(), name: `bot-${i}`, team: "tabs" })!;
    p.x = p.y = 1200;
  }
  const births: number[] = [], owner = a.players.keys().next().value!;
  for (let time = 0; time < 1000; time += STEP_MS) {
    for (const p of a.players.values()) inputs.set(p.id, { ...neutralInput(), fire: time % 100 === 0 });
    const next = a.nextId; fireAndAdvance(a, inputs, time); a.tick++;
    for (const shot of a.shots) if (shot.owner === owner && shot.id >= next) births.push(shot.born);
    expect(a.shots.length).toBeLessThanOrEqual(MAX_SHOTS);
    expect(parseServer(serializeSnapshot({ v: 1, type: "snapshot", arenaId: "room", tick: a.tick, wave: a.wave,
      bugs: a.bugs, shots: a.shots, events: a.events, players: [...a.players.values()].map(p => ({ ...p, ackSeq: 0 })) }))).not.toBeNull();
  }
  expect(births.length).toBeLessThanOrEqual(SHOT_RATE);
  for (let i = 1; i < births.length; i++) expect(births[i]! - births[i - 1]!).toBeGreaterThanOrEqual(1000 / SHOT_RATE - 1e-8);
  // A long release makes the next shot ready, without accumulating a burst.
  for (let time = 1000; time < 2000; time += STEP_MS) fireAndAdvance(a, new Map(), time);
  const next = a.nextId; fireAndAdvance(a, new Map([[owner, { ...neutralInput(), fire: true }]]), 2000);
  expect(a.nextId - next).toBe(1); expect(a.shots[0]!.born).toBe(2000);
});
test("shots start at the barrel, travel at 900/s, keep fractional 6/s cadence and expire once", () => {
  const { a, p } = fixture(), inputs = new Map([[p.id, { ...neutralInput(), fire: true }]]);
  fireAndAdvance(a, inputs, 0); expect(a.shots[0]!.x).toBe(1200 + MUZZLE_OFFSET + SHOT_SPEED * 0.05);
  expect(a.shots[0]!.born).toBe(0); p.streak = 4;
  for (let t = 50; t < 900; t += 50) fireAndAdvance(a, inputs, t);
  expect(a.shots).toHaveLength(5); expect(p.streak).toBe(0); expect(a.shots[0]!.born).toBeCloseTo(1000 / 6);
  const first = a.shots[0]!, x = first.x; fireAndAdvance(a, new Map(), 900); expect(first.x - x).toBeCloseTo(45);
  for (let t = 950; t < 2000; t += 50) fireAndAdvance(a, new Map(), t);
  expect(a.shots).toHaveLength(0); p.streak = 9; fireAndAdvance(a, new Map(), 2000); expect(p.streak).toBe(9);
});
test("swept collision selects first entry, breaks ties by id, crosses moving targets and passes players", () => {
  const { a, p } = fixture(), teammate = joinPlayer(a, { id: "friend", name: "Friend", team: "spaces" })!;
  teammate.x = 1240; teammate.y = p.y;
  a.bugs.push(bug(9, 1260), bug(8, 1250), bug(7, 1250));
  fireAndAdvance(a, new Map([[p.id, { ...neutralInput(), fire: true }]]), 0);
  expect(a.bugs.map(b => b.id)).toEqual([9, 8]); expect(p.kills).toBe(1); expect(p.score).toBe(11); expect(a.shots).toHaveLength(0);
  expect(teammate.hits).toBe(3); expect(a.bugs.some(b => b.id === 7)).toBe(false);
  expect(circleEntry(-100, 0, 200, 0, 15)).toBeCloseTo(0.425);
  expect(circleEntry(-100, 30, 200, -60, 15)).not.toBeNull();
  a.bugs = [{ ...bug(11, 1250, 1250), vy: -1000 }]; p.nextShotAt = 50;
  fireAndAdvance(a, new Map([[p.id, { ...neutralInput(), fire: true }]]), 50); expect(p.kills).toBe(2);
});
test("hit order awards 11,12; miss resets future multiplier, caps at 3 and contested kills award once", () => {
  const { a, p } = fixture(); const fire = new Map([[p.id, { ...neutralInput(), fire: true }]]);
  for (let n = 0; n < 2; n++) { a.bugs = [bug(100 + n, 1240)]; p.nextShotAt = n * 50; fireAndAdvance(a, fire, n * 50); }
  expect(p.score).toBe(23);
  a.shots.push({ id: 90, owner: p.id, life: 1, born: 0, x: 2390, y: 1200, vx: 900, vy: 0 }); fireAndAdvance(a, new Map(), 100); expect(p.streak).toBe(0);
  a.bugs = [bug(110, 1240)]; p.nextShotAt = 150; fireAndAdvance(a, fire, 150); expect(p.score).toBe(34);
  p.streak = 99; a.bugs = [bug(111, 1240)]; p.nextShotAt = 200; fireAndAdvance(a, fire, 200); expect(p.score).toBe(64);
  const q = joinPlayer(a, { id: "b", name: "Other", team: "tabs" })!; q.x = q.y = 1200;
  a.bugs = [bug(112, 1240)]; p.nextShotAt = q.nextShotAt = 250;
  fireAndAdvance(a, new Map([[p.id, { ...neutralInput(), fire: true }], [q.id, { ...neutralInput(), fire: true }]]), 250);
  expect(p.kills + q.kills).toBe(5); expect(q.kills).toBe(0);
});
test("held stream reaches 18th shot, locks for 1.5s, cools during lockout and resumes without catchup", () => {
  const { a, p } = fixture(), fire = new Map([[p.id, { ...neutralInput(), fire: true }]]);
  for (let t = 0; t < 2800; t += 50) fireAndAdvance(a, fire, t);
  expect(p.heat).toBe(17); expect(p.overheatUntil).toBe(0);
  fireAndAdvance(a, fire, 2800); expect(p.overheatUntil).toBeCloseTo(17 * 1000 / 6 + 1500);
  const id = a.nextId;
  for (let t = 2850; t < 4300; t += 50) fireAndAdvance(a, fire, t);
  expect(a.nextId).toBe(id); expect(p.heat).toBeCloseTo(9.2);
  fireAndAdvance(a, fire, 4300); expect(a.nextId).toBe(id + 1); expect(p.heat).toBeCloseTo(10);
  fireAndAdvance(a, new Map(), 4350); expect(p.heat).toBeCloseTo(9.7);
  fireAndAdvance(a, fire, 10000); expect(a.nextId).toBe(id + 2);
});
test("crawler targets nearest living player with stable ties; contact persists, immunity gates three-hit death", () => {
  const { a, p } = fixture(), q = joinPlayer(a, { id: "b", name: "Other", team: "tabs" })!;
  q.x = 1400; q.y = 1200; const b = bug(4, 1300); crawler.move(b, [q, p], 0); expect(b.vx).toBe(-CRAWLER_SPEED);
  // Farther "a" must not override nearer "b" simply because its id sorts first.
  p.x = 900; crawler.move(b, [q, p], 0); expect(b.vx).toBe(CRAWLER_SPEED); expect(b.vy).toBe(0); p.x = 1200;
  p.hits = 0; crawler.move(b, [p, q], 0); expect(b.vx).toBe(CRAWLER_SPEED); p.hits = 3;
  a.tick = 21; p.immuneUntil = 0; p.spawnProtectedUntil = 0; a.bugs = [bug(5, 1200), bug(6, 1200)];
  stepArena(a, new Map()); expect(p.hits).toBe(2); expect(a.bugs).toHaveLength(2); expect(p.score).toBe(0);
  for (let i = 0; i < 19; i++) stepArena(a, new Map()); expect(p.hits).toBe(2);
  stepArena(a, new Map()); expect(p.hits).toBe(1);
  for (let i = 0; i < 20; i++) stepArena(a, new Map()); expect(p.hits).toBe(0); expect(a.ended).toHaveLength(1);
  expect(a.ended[0]!.seconds).toBe((a.tick - p.startedTick) * STEP_MS / 1000);
  expect(endLife(a, p.id)).toBeNull(); expect(respawnPlayer(a, p.id, 9)).toBeNull();
  const death = { x: p.x, y: p.y }, old = p.life;
  a.bugs = [bug(1000, death.x, death.y)];
  expect(respawnPlayer(a, p.id, old)).toBe(p); expect(p.life).toBe(old + 1); expect(p.hits).toBe(3); expect(p.heat).toBe(0);
  expect(Math.hypot(p.x - death.x, p.y - death.y)).toBeGreaterThanOrEqual(300);
  expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(28);
  expect(respawnPlayer(a, p.id, old + 1)).toBeNull(); expect(p.immuneUntil).toBe(0); expect(p.spawnProtectedUntil).toBe(a.tick * STEP_MS + 2000);
});
test("waves start at first step and every 30s without spawn bursts; personal requests respect the cap", () => {
  const { a, p } = fixture(); stepArena(a, new Map()); expect(a.wave).toBe(1); expect(a.bugs).toHaveLength(0);
  a.tick = 599; a.spawnCredits.set(p.id, 0); stepArena(a, new Map()); expect(a.wave).toBe(1); expect(a.bugs).toHaveLength(0);
  stepArena(a, new Map()); expect(a.wave).toBe(2); expect(a.bugs).toHaveLength(0);
  a.spawnCredits.set(p.id, 0.99); stepArena(a, new Map()); expect(a.bugs).toHaveLength(1);
  a.bugs = []; for (let i = 0; i < 151; i++) spawnBug(a, p); expect(a.bugs).toHaveLength(MAX_BUGS);
  expect(a.bugs.every(b => Math.hypot(b.x - p.x, b.y - p.y) >= 600 - 1e-8)).toBe(true);
  const safe = safeSpawn(a); expect(Number.isFinite(safe.x)).toBe(true);
  endLife(a, p.id); a.tick = 1200; a.bugs = []; stepArena(a, new Map());
  expect(a.wave).toBe(3); expect(a.bugs).toHaveLength(0); expect(a.spawnCredits.has(p.id)).toBe(false);
});
test("kills precede contact; terminal scores freeze and cancel shots while dead inputs do nothing", () => {
  const { a, p } = fixture(); a.tick = 21; p.immuneUntil = 0; p.hits = 1;
  a.bugs = [bug(1, 1225), bug(2, 1200)];
  stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]]));
  expect(p.score).toBe(11); expect(p.hits).toBe(0); expect(a.shots).toHaveLength(0); expect(a.ended[0]!.score).toBe(11);
  const x = p.x; stepArena(a, new Map([[p.id, { move: { x: 1, y: 0 }, aim: 2, fire: true }]]));
  expect(p.x).toBe(x); expect(p.score).toBe(11); expect(a.ended).toHaveLength(0); expect(a.shots).toHaveLength(0);
});
test("separate life credits do not pool fractional requests; exhausted spawn placement terminates", () => {
  const a = createArena(3);
  for (let i = 0; i < 4; i++) joinPlayer(a, { id: String(i), name: `bot-${i}`, team: "tabs" });
  a.tick = 1; for (let i = 0; i < 20; i++) stepArena(a, new Map()); expect(a.bugs).toHaveLength(0);
  for (const credit of a.spawnCredits.values()) expect(credit).toBeCloseTo(0.13575);
  const full = createArena(1);
  for (let i = 0; i < 20; i++) { const p = joinPlayer(full, { id: String(i), name: `bot-${i}`, team: "tabs" })!; p.x = 240 + i % 5 * 480; p.y = 300 + Math.floor(i / 5) * 600; }
  expect(spawnBug(full, full.players.get("0")!)).toBe(false); expect(full.bugs).toHaveLength(0);
  for (const p of full.players.values()) full.spawnCredits.set(p.id, 0.999);
  stepArena(full, new Map()); expect(full.bugs).toHaveLength(0); expect(full.spawnCursor).toBe(-1);
  for (const credit of full.spawnCredits.values()) expect(credit).toBeLessThan(1);
  for (const p of full.players.values()) if (p.id !== "0") endLife(full, p.id);
  stepArena(full, new Map()); expect(full.bugs).toHaveLength(0);
});
