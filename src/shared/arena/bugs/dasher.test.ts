import { expect, test } from "bun:test";
import { createArena, joinPlayer, stepArena } from "../simulation";
import { createBug } from "./registry";
import { dasher } from "./dasher";
import { DASHER_DASH_SPEED, DASHER_RECOVERY_SPEED } from "../constants";
import { neutralInput } from "../types";
function fixture() {
  const a = createArena(71), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
  p.x = 1200; p.y = 1200; p.spawnProtectedUntil = 0;
  const b = createBug("dasher", a.nextId++, 960, 1200); a.bugs.push(b);
  const step = (x = 0, y = 0) => stepArena(a, new Map([[p.id, { ...neutralInput(), move: { x, y } }]]));
  return { a, p, b, step };
}
test("wind-up locks nearest living target with id ties; exact phase boundaries, straight dash and slow recovery", () => {
  const { a, p, b, step } = fixture();
  const q = { ...p, id: "b", x: 960, y: 1440 };
  dasher.move(b, [q, { ...p, id: "dead", x: 960, hits: 0 }, p], 0);
  expect(b).toMatchObject({ hp: 2, phase: "windup", phaseUntil: 700, facing: 0, vx: 0, vy: 0 });
  p.y = 1400;
  for (let i = 0; i < 13; i++) step();
  expect(b.phase).toBe("windup"); expect(b.x).toBe(960);
  step(); expect(a.tick * 50).toBe(700); expect(b.phase).toBe("dash"); expect(b.vx).toBe(DASHER_DASH_SPEED);
  for (let i = 0; i < 8; i++) { step(); expect(b.facing).toBe(0); expect(b.y).toBe(1200); }
  expect(b.phase).toBe("dash"); step();
  expect(a.tick * 50).toBe(1150); expect(b.x).toBeCloseTo(1180.5); expect(b.phase).toBe("recovery");
  expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(DASHER_RECOVERY_SPEED);
  for (let i = 0; i < 19; i++) step(); expect(b.phase).toBe("recovery");
  step(); expect(a.tick * 50).toBe(2150); expect(b.phase).toBe("windup"); expect(b.phaseUntil).toBe(2850);
});
test("stationary target takes contact, perpendicular movement during tell escapes the same dash", () => {
  for (const dodge of [false, true]) {
    const { p, step } = fixture(); step();
    for (let i = 0; i < 22; i++) step(0, dodge ? 1 : 0);
    expect(p.hits).toBe(dodge ? 3 : 2);
  }
});
test("committed wind-up/dash finish without a living target; idle phases stop", () => {
  const { b, p } = fixture(); dasher.move(b, [p], 0); p.hits = 0;
  dasher.move(b, [p], 700); expect(b.phase).toBe("dash"); expect(b.vx).toBe(DASHER_DASH_SPEED);
  dasher.move(b, [p], 1150); expect(b.phase).toBe("recovery"); expect(b.vx).toBe(0);
  dasher.move(b, [p], 2150); expect(b.phase).toBe("approach"); expect(b.vx).toBe(0);
});
test("swept dash grazes player between separated endpoints; wall stop preserves locked facing and timer", () => {
  const { a, p, b, step } = fixture();
  Object.assign(b, { x: 1187.75, y: 1229, phase: "dash", phaseUntil: 450, facing: 0 });
  expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeGreaterThan(30);
  step(); expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeGreaterThan(30); expect(p.hits).toBe(2);
  Object.assign(b, { x: 2390, y: 1200, facing: Math.PI / 4 }); step();
  expect(b.x).toBe(2400); expect(b.y).toBeCloseTo(1210); expect(b.vx).toBe(0); expect(b.phaseUntil).toBe(450);
  step(); expect(b.x).toBe(2400); expect(b.y).toBeCloseTo(1210); expect(b.facing).toBe(Math.PI / 4);
  expect(a.events).toHaveLength(0);
});
