import { expect, test } from "bun:test";
import { REFACTOR_BOMB } from "../../shared/upgrades";
import { createSimulation, IDLE, step } from "./simulation";
import { pick } from "./upgrade-fixture.test-support";
import { openChoice } from "./upgrades";
import { Effects } from "./fx";
import { Feedback } from "./fx/feedback";

test.each([1, 2, 3])("bomb with %i picks clears automatically once, scores every victim, and recharges in game time", count => {
  const s = createSimulation(1); s.spawnIn = s.fireIn = Infinity;
  for (let i = 0; i < count; i++) pick(s, REFACTOR_BOMB);
  const bugs = () => { s.bugs = [{ id: s.nextId++, kind: "base", ...s.robot }, { id: s.nextId++, kind: "fast", x: 10, y: 10 }]; };
  bugs(); s.shots.push({ ...s.robot, vx: 1, vy: 0, life: 1 });
  step(s, IDLE, 0.01);
  expect(s.bugs).toHaveLength(0); expect(s.squashes).toBe(2); expect(s.hits).toBe(0);
  expect(s.bombDetonations).toBe(1); expect(s.bombOrigin).toEqual(s.robot);
  const ready = s.bombReadyAt;
  expect(ready - s.time).toBeCloseTo(30 / count);
  openChoice(s.upgrades); const frozen = structuredClone(s);
  step(s, IDLE, 1000); expect(s).toEqual(frozen);
  s.upgrades.offer = null; // isolate cooldown from the next acquisition
  s.time = ready - 0.02; bugs(); s.invulnerableUntil = Infinity;
  step(s, IDLE, 0.01); expect(s.bombDetonations).toBe(1);
  step(s, IDLE, 0.01); expect(s.bombDetonations).toBe(2);
  expect(s.squashes).toBe(4); expect(s.score).toBe(40 + s.seconds);
});

test("empty arena keeps bomb armed; a repeat pick recalculates from the previous detonation", () => {
  const s = createSimulation(1); s.spawnIn = s.fireIn = Infinity;
  pick(s, REFACTOR_BOMB); step(s, IDLE, 1);
  expect(s.bombDetonations).toBe(0); expect(s.bombReadyAt).toBe(0);
  s.bugs.push({ id: 1, kind: "base", x: 10, y: 10 }); step(s, IDLE, 0.01);
  const last = s.bombLastAt;
  s.time += 16; pick(s, REFACTOR_BOMB);
  expect(s.bombReadyAt).toBe(last + 15);
  s.bugs.push({ id: 2, kind: "base", ...s.robot }); step(s, IDLE, 0.01);
  expect(s.bombDetonations).toBe(2); expect(s.hits).toBe(0);
});

test("bomb feedback uses bounded pools without losing scores, and reuses one expiring ring", () => {
  const s = createSimulation(1), fx = new Effects(), feedback = new Feedback(fx, 300);
  s.spawnIn = s.fireIn = Infinity; pick(s, REFACTOR_BOMB);
  for (let i = 0; i < 400; i++) s.bugs.push({ id: i, kind: "base", x: i, y: 10 });
  fx.advance(0); feedback.beforeStep(s); step(s, IDLE, 0.01, feedback); feedback.afterStep(s, 0.01);
  expect(s.squashes).toBe(400); expect(s.score).toBe(4000); expect(s.hits).toBe(0);
  expect(fx.labels.count).toBe(fx.labels.capacity); expect(fx.particles.count).toBe(fx.particles.capacity);
  expect(fx.ring.life).toBe(0.5); expect(fx.ring.x).toBe(s.robot.x);
  const ring = fx.ring;
  for (let t = 50; t <= 600; t += 50) fx.advance(t);
  expect(fx.ring.life).toBe(0);
  fx.bomb(1, 2, 300); expect(fx.ring).toBe(ring); expect(fx.ring.x).toBe(1);
  fx.reset(); expect(fx.ring.life).toBe(0);
});
