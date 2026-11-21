import { expect, test } from "bun:test";
import { beetle, angleDifference, shellBlocks } from "./beetle";
import { createBug } from "./registry";
import { createArena, joinPlayer, stepArena } from "../simulation";
import { fireAndAdvance } from "../combat";

function fixture() {
  const a = createArena(83), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  const b = createBug("beetle", 900, 1200, 1200); a.bugs.push(b);
  return { a, p, b };
}
test("beetle tracks nearest active player with id ties, forward speed and one limited turn per step", () => {
  const { a, p, b } = fixture(), q = joinPlayer(a, { id: "b", name: "Other", team: "spaces" })!;
  // The closer player wins in either insertion order, regardless of id.
  Object.assign(p, { x: 1200, y: 1400 }); Object.assign(q, { x: 1200, y: 1100 });
  for (const players of [[p, q], [q, p]]) {
    a.players = new Map(players.map(player => [player.id, player]));
    Object.assign(b, { x: 1200, y: 1200, facing: 0 });
    stepArena(a, new Map());
    expect(b.facing).toBeCloseTo(-Math.PI / 40); // 90 degrees/s over 50 ms.
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(84); // 0.6 * 140, independent of tuning imports.
    expect(b.x).toBeCloseTo(1200 + Math.cos(Math.PI / 40) * 4.2);
    expect(b.y).toBeCloseTo(1200 - Math.sin(Math.PI / 40) * 4.2);
  }
  // Equal distances choose the lower id even when it was inserted last.
  Object.assign(b, { x: 1200, y: 1200, facing: 0 }); p.y = 1300;
  stepArena(a, new Map());
  expect(b.facing).toBeCloseTo(Math.PI / 40);
  const facing = b.facing; beetle.move(b, a.players.values(), 50); expect(b.facing).toBe(facing);
  p.status = "downed"; beetle.move(b, a.players.values(), 50, 50); expect(b.facing).toBeCloseTo(0);
  q.status = "out"; beetle.move(b, a.players.values(), 100, 50);
  expect(b.vx).toBe(0); expect(b.vy).toBe(0); expect(b.facing).toBeCloseTo(0);
  expect(b.hp).toBe(5); expect(beetle.points).toBe(60);
});
test("steering wraps the shortest angle, never overshoots, and chooses positive half turns", () => {
  const { p, b } = fixture();
  b.facing = Math.PI - 0.02; p.x = b.x - 100; p.y = b.y - 1;
  beetle.move(b, [p], 0, 50); expect(b.facing).toBeCloseTo(Math.atan2(-1, -100));
  b.facing = 0; p.y = b.y; beetle.move(b, [p], 0, 50); expect(b.facing).toBeCloseTo(Math.PI / 40);
  expect(angleDifference(-Math.PI)).toBe(Math.PI);
});
test("inclusive shell sector and swept contacts: front bounces, sides and rear damage across wrapped headings", () => {
  for (const facing of [0, Math.PI - 0.1, -Math.PI + 0.1]) for (const angle of [0, Math.PI / 3, -Math.PI / 3, Math.PI / 3 - 0.001, Math.PI / 3 + 0.001, -Math.PI / 2, Math.PI]) {
    const { a, p, b } = fixture(); b.facing = facing; p.streak = 9; p.points = 100; p.score = 10;
    const x = Math.cos(facing + angle), y = Math.sin(facing + angle), blocked = Math.abs(angle) <= Math.PI / 3;
    expect(shellBlocks(facing, x, y)).toBe(blocked);
    a.shots.push({ id: 1, owner: p.id, life: 1, x: b.x + x * 60, y: b.y + y * 60, vx: -x * 900, vy: -y * 900, born: 0 });
    // The shooter's current position does not decide armour.
    p.x = b.x - x * 100; p.y = b.y - y * 100;
    fireAndAdvance(a, new Map(), 0);
    expect(b.hp).toBe(blocked ? 5 : 4); expect(p.streak).toBe(blocked ? 0 : 10);
    expect(p.points).toBe(100); expect(p.score).toBe(10); expect(p.kills).toBe(0);
    expect(a.shots).toHaveLength(0); expect(a.events).toHaveLength(1);
    expect(a.events[0]!.type).toBe(blocked ? "bounce" : "hit");
    if (blocked) expect(Math.hypot(a.events[0]!.x - b.x, a.events[0]!.y - b.y)).toBeCloseTo(22);
    p.streak = 3; fireAndAdvance(a, new Map(), 50); expect(p.streak).toBe(3);
  }
});
test("armour uses off-centre entry, moving centres and the stopped segment at a world edge", () => {
  for (const wall of [false, true]) {
    const { a, p, b } = fixture(); Object.assign(b, { x: wall ? 2399 : 1200, vx: 84, facing: Math.PI });
    a.shots.push({ id: 1, owner: p.id, life: 1, x: b.x - 60, y: b.y + 15, vx: 900, vy: 0, born: 0 });
    fireAndAdvance(a, new Map(), 0); expect(b.hp).toBe(5); expect(a.events[0]!.type).toBe("bounce");
    expect(a.events[0]!.y).toBeGreaterThan(b.y);
  }
  const { a, p, b } = fixture(); b.facing = Math.PI;
  // A grazing front-to-back shot hits the exposed side of the circle.
  a.shots.push({ id: 1, owner: p.id, life: 1, x: 1160, y: 1224, vx: 900, vy: 0, born: 0 });
  fireAndAdvance(a, new Map(), 0); expect(b.hp).toBe(4);
});
test("a blocked first victim consumes the shot before a vulnerable bug behind it", () => {
  const { a, p, b } = fixture(); b.facing = Math.PI;
  const behind = createBug("crawler", 901, 1230, 1200); a.bugs.push(behind);
  a.shots.push({ id: 1, owner: p.id, life: 1, x: 1170, y: 1200, vx: 900, vy: 0, born: 0 });
  fireAndAdvance(a, new Map(), 0); expect(b.hp).toBe(5); expect(behind.hp).toBe(1); expect(a.events).toHaveLength(1);
});
test("coincident impacts use inverse shot direction, clamp shell sparks and reset only the shooter", () => {
  for (const [x, vx, blocked] of [[1200, -900, true], [1200, 900, false], [2400, -900, true]] as const) {
    const { a, p, b } = fixture(), q = joinPlayer(a, { id: "b", name: "Other", team: "spaces" })!;
    b.x = x; p.streak = 4; q.streak = 7;
    a.shots.push({ id: 1, owner: p.id, life: 1, x, y: b.y, vx, vy: 0, born: 0 });
    fireAndAdvance(a, new Map(), 0);
    expect(b.hp).toBe(blocked ? 5 : 4); expect(p.streak).toBe(blocked ? 0 : 5); expect(q.streak).toBe(7);
    expect(a.events[0]!.type).toBe(blocked ? "bounce" : "hit");
    expect(a.events[0]!.x).toBe(blocked ? Math.min(2400, x + 22) : x); expect(a.shots).toHaveLength(0);
  }
});
test("five damaging hits score 90, capped multiplier scores 180, and only the lethal teammate gets the kill", () => {
  for (const mode of ["solo", "cap", "split"]) {
    const { a, p, b } = fixture(), q = joinPlayer(a, { id: "b", name: "Other", team: "spaces" })!;
    if (mode === "cap") p.streak = 100;
    for (let i = 0; i < 5; i++) {
      const owner = mode === "split" && i === 4 ? q : p;
      a.shots.push({ id: i + 1, owner: owner.id, life: 1, x: 1170, y: 1200, vx: 900, vy: 0, born: 0 });
      fireAndAdvance(a, new Map(), 0);
    }
    expect(a.bugs).toHaveLength(0); expect(a.events.map(e => e.type)).toEqual(["hit", "hit", "hit", "hit", "kill"]);
    expect(mode === "split" ? q.points : p.points).toBe(mode === "solo" ? 900 : mode === "cap" ? 1800 : 660);
    expect(p.kills).toBe(mode === "split" ? 0 : 1); expect(q.kills).toBe(mode === "split" ? 1 : 0);
  }
});
