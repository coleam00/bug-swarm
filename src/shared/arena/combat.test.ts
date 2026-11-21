import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena, respawnPlayer, endLife } from "./simulation";
import { fireAndAdvance, circleEntry } from "./combat";
import { crawler } from "./bugs/crawler";
import { spawnBug, safeSpawn } from "./spawn";
import { CRAWLER_SPEED, MAX_BUGS, MUZZLE_OFFSET, SHOT_SPEED, STEP_MS } from "./constants";
import { neutralInput, type Bug } from "./types";
function fixture() { const a = createArena(21), p = joinPlayer(a, { id: "a", name: "Robot", team: "tabs" })!; p.x = p.y = 1200; return { a, p }; }
const bug = (id: number, x: number, y = 1200): Bug => ({ id, kind: "crawler", x, y, vx: 0, vy: 0 });
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
  const { a, p } = fixture(); joinPlayer(a, { id: "friend", name: "Friend", team: "spaces" })!.x = 1240;
  a.bugs.push(bug(9, 1260), bug(8, 1250), bug(7, 1250));
  fireAndAdvance(a, new Map([[p.id, { ...neutralInput(), fire: true }]]), 0);
  expect(a.bugs.map(b => b.id)).toEqual([9, 8]); expect(p.kills).toBe(1); expect(p.score).toBe(11); expect(a.shots).toHaveLength(0);
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
  q.x = 1400; q.y = 1200; const b = bug(4, 1300); crawler.move(b, [q, p]); expect(b.vx).toBe(-CRAWLER_SPEED);
  p.hits = 0; crawler.move(b, [p, q]); expect(b.vx).toBe(CRAWLER_SPEED); p.hits = 3;
  a.tick = 21; p.immuneUntil = 0; a.bugs = [bug(5, 1200), bug(6, 1200)];
  stepArena(a, new Map()); expect(p.hits).toBe(2); expect(a.bugs).toHaveLength(2); expect(p.score).toBe(0);
  for (let i = 0; i < 19; i++) stepArena(a, new Map()); expect(p.hits).toBe(2);
  stepArena(a, new Map()); expect(p.hits).toBe(1);
  for (let i = 0; i < 20; i++) stepArena(a, new Map()); expect(p.hits).toBe(0); expect(a.ended).toHaveLength(1);
  expect(endLife(a, p.id)).toBeNull(); expect(respawnPlayer(a, p.id, 9)).toBeNull();
  const old = p.life; expect(respawnPlayer(a, p.id, old)).toBe(p); expect(p.life).toBe(old + 1); expect(p.hits).toBe(3); expect(p.heat).toBe(0);
  expect(respawnPlayer(a, p.id, old + 1)).toBeNull(); expect(p.immuneUntil).toBe(a.tick * STEP_MS + 1000);
});
test("waves start at first step and every 30s, scale with living count, trickle, cap and keep spawn clearance", () => {
  const { a, p } = fixture(); stepArena(a, new Map()); expect(a.wave).toBe(1); expect(a.bugs).toHaveLength(9);
  expect(a.bugs.every(b => Math.hypot(b.x - p.x, b.y - p.y) >= 493)).toBe(true);
  a.bugs = []; a.tick = 599; a.spawnCredit = 0; stepArena(a, new Map()); expect(a.wave).toBe(1); expect(a.bugs).toHaveLength(0);
  stepArena(a, new Map()); expect(a.wave).toBe(2); expect(a.bugs).toHaveLength(12);
  a.bugs = []; a.spawnCredit = 0.99; stepArena(a, new Map()); expect(a.bugs).toHaveLength(1);
  a.bugs = []; for (let i = 0; i < 151; i++) spawnBug(a); expect(a.bugs).toHaveLength(MAX_BUGS);
  expect(a.bugs.every(b => Math.hypot(b.x - p.x, b.y - p.y) >= 500)).toBe(true);
  const safe = safeSpawn(a); expect(Number.isFinite(safe.x)).toBe(true);
  p.hits = 0; a.tick = 1200; a.bugs = []; a.spawnCredit = 0.9; stepArena(a, new Map()); expect(a.wave).toBe(3); expect(a.bugs).toHaveLength(0); expect(a.spawnCredit).toBe(0);
});
test("kills precede contact; terminal scores freeze and cancel shots while dead inputs do nothing", () => {
  const { a, p } = fixture(); a.tick = 21; p.immuneUntil = 0; p.hits = 1;
  a.bugs = [bug(1, 1225), bug(2, 1200)];
  stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]]));
  expect(p.score).toBe(11); expect(p.hits).toBe(0); expect(a.shots).toHaveLength(0); expect(a.ended[0]!.score).toBe(11);
  const x = p.x; stepArena(a, new Map([[p.id, { move: { x: 1, y: 0 }, aim: 2, fire: true }]]));
  expect(p.x).toBe(x); expect(p.score).toBe(11); expect(a.ended).toHaveLength(0); expect(a.shots).toHaveLength(0);
});
test("trickle resolves exact seconds for fractional credits and exhausted spawn placement terminates", () => {
  const a = createArena(3);
  for (let i = 0; i < 4; i++) joinPlayer(a, { id: String(i), name: `bot-${i}`, team: "tabs" });
  a.tick = 1; for (let i = 0; i < 20; i++) stepArena(a, new Map()); expect(a.bugs).toHaveLength(2);
  const full = createArena(1);
  for (let i = 0; i < 20; i++) { const p = joinPlayer(full, { id: String(i), name: `bot-${i}`, team: "tabs" })!; p.x = 240 + i % 5 * 480; p.y = 300 + Math.floor(i / 5) * 600; }
  expect(spawnBug(full)).toBe(false); expect(full.bugs).toHaveLength(0);
});
