import { expect, test } from "bun:test";
import { STEP } from "./config";
import { createSimulation, chooseUpgrade, IDLE, step } from "./simulation";
import { FixedStepper } from "./loop";
import { Effects } from "./fx";
import { Feedback } from "./fx/feedback";
import { UPGRADE_IDS } from "../../shared/upgrades";

test("20, 40, 60-second choices freeze complete state, reject invalid/stale picks, and remain deterministic", () => {
  const a = createSimulation(73), b = createSimulation(73);
  a.invulnerableUntil = b.invulnerableUntil = Infinity;
  for (let n = 1; n <= 7; n++) {
    while (!a.upgrades.offer) step(a, IDLE, STEP);
    while (!b.upgrades.offer) step(b, { x: Math.sin(b.time), y: Math.cos(b.time), target: null }, STEP);
    expect(a.time).toBe(n * 20); expect(a.seconds).toBe(n * 20);
    expect(a.seed).toBe(b.seed); expect(a.upgrades.offer).toEqual(b.upgrades.offer); expect(new Set(a.upgrades.offer).size).toBe(3);
    const frozen = structuredClone(a), spawnSeed = a.seed;
    for (let i = 0; i < 100; i++) expect(step(a, { x: 1, y: 1, target: null }, 10)).toBe(0);
    expect(a).toEqual(frozen);
    const absent = UPGRADE_IDS.find(id => !a.upgrades.offer!.includes(id))!;
    expect(chooseUpgrade(a, n, absent)).toBe(false);
    expect(chooseUpgrade(a, n - 1, a.upgrades.offer![0]!)).toBe(false);
    expect(chooseUpgrade(a, n, a.upgrades.offer![0]!)).toBe(true);
    expect(chooseUpgrade(a, n, absent)).toBe(false); expect(a.seed).toBe(spawnSeed);
    chooseUpgrade(b, n, b.upgrades.offer![2]!);
  }
});

test("crossing steps use only active time and terminal contact wins over a boundary choice", () => {
  const s = createSimulation(1); s.time = 19.99; s.spawnIn = s.fireIn = Infinity;
  const x = s.robot.x;
  expect(step(s, { x: 1, y: 0, target: null }, 2)).toBeCloseTo(0.01);
  expect(s.time).toBe(20); expect(s.robot.x - x).toBeCloseTo(1.8); expect(s.upgrades.offer).toHaveLength(3);
  const dead = createSimulation(1); dead.time = 19.99; dead.hits = 2; dead.spawnIn = dead.fireIn = Infinity;
  dead.bugs = [{ id: 1, kind: "base", ...dead.robot }];
  step(dead, IDLE, 1); expect(dead.dead).toBe(true); expect(dead.upgrades.offer).toBeNull();
});

test("fixed loop discards boundary overshoot and long pause; feedback receives the shortened interval", () => {
  const s = createSimulation(1), fx = new Effects(), feedback = new Feedback(fx);
  let duration = -1;
  const after = feedback.afterStep.bind(feedback);
  feedback.afterStep = (state, dt) => { duration = dt; after(state, dt); };
  const loop = new FixedStepper(feedback);
  s.time = 19.995; s.spawnIn = s.fireIn = Infinity;
  loop.advance(0, s, IDLE); loop.advance(100, s, IDLE);
  expect(duration).toBeCloseTo(0.005); expect(s.time).toBe(20);
  const frozen = structuredClone(s); loop.advance(600000, s, IDLE); expect(s).toEqual(frozen);
  chooseUpgrade(s, 1, s.upgrades.offer![0]!);
  loop.advance(900000, s, IDLE); expect(s.time).toBe(20);
  loop.advance(900017, s, IDLE); expect(s.time).toBeCloseTo(20 + STEP);
});
