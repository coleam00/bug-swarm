import { expect, test } from "bun:test";
import { BUG_DEFINITIONS, STEP } from "../config";
import { FixedStepper } from "../loop";
import { chooseUpgrade, createSimulation, IDLE, step, type Bug } from "../simulation";
import { Effects } from "./index";
import { Feedback } from "./feedback";

function fixture() {
  const state = createSimulation(1), fx = new Effects(), feedback = new Feedback(fx);
  state.spawnIn = state.fireIn = 100;
  const advance = () => { feedback.beforeStep(state); step(state, IDLE, STEP, feedback); feedback.afterStep(state, STEP); };
  const shot = (x: number, y: number) => state.shots.push({ x, y, vx: 1, vy: 0, life: 1 });
  return { state, fx, feedback, advance, shot };
}

test.each(["base", "fast"] as const)("%s shot-only kills report precise post-movement positions and squash counts", (kind) => {
  const h = fixture();
  h.state.bugs.push({ id: 1, kind, x: 100, y: 300 }, { id: 2, kind, x: 500, y: 300 }, { id: 3, kind, x: 300, y: 100 });
  h.shot(100, 300); h.shot(300, 100); h.advance();
  expect(h.state.squashes).toBe(2); expect(h.fx.labels.count).toBe(2);
  expect(h.fx.labels.x[0]).toBeCloseTo(100 + BUG_DEFINITIONS[kind].speed * STEP); expect(h.fx.labels.y[0]).toBe(300);
  expect(h.fx.labels.x[1]).toBe(300); expect(h.fx.labels.y[1]).toBeCloseTo(100 + BUG_DEFINITIONS[kind].speed * STEP);
  expect(h.fx.flash).toBe(0); expect(h.state.hits).toBe(0);
});

test.each([false, true])("contact removals never award squash feedback (invulnerable=%s)", (invulnerable) => {
  const h = fixture(); h.state.invulnerableUntil = invulnerable ? 10 : 0;
  h.state.bugs.push({ id: 1, kind: "base", x: 300, y: 300 }, { id: 2, kind: "base", x: 310, y: 300 }); h.advance();
  expect(h.state.bugs).toHaveLength(0); expect(h.fx.labels.count).toBe(0); expect(h.fx.particles.count).toBe(0);
  expect(h.state.hits).toBe(invulnerable ? 0 : 1); expect(h.fx.flash).toBe(invulnerable ? 0 : 0.1);
  if (!invulnerable) { h.fx.flash = 0; h.fx.shake.reset(); }
  h.state.bugs.push({ id: 3, kind: "base", x: 300, y: 300 }); h.advance();
  expect(h.fx.flash).toBe(0); expect(h.fx.shake.remaining).toBe(0);
});

test("a shot kill inside contact range gets +10; a simultaneous contact gets one hit", () => {
  const h = fixture();
  h.state.bugs.push({ id: 1, kind: "base", x: 310, y: 300 }, { id: 2, kind: "base", x: 290, y: 300 });
  h.shot(320, 300); h.advance();
  expect(h.state.squashes).toBe(1); expect(h.fx.labels.count).toBe(1); expect(h.fx.labels.x[0]).toBeGreaterThan(300);
  expect(h.state.hits).toBe(1); expect(h.fx.flash).toBe(0.1); expect(h.fx.shake.remaining).toBe(0.16);
});

test("a shot takes precedence over contact and produces no hit flash", () => {
  const h = fixture(); h.state.bugs.push({ id: 1, kind: "base", x: 310, y: 300 }); h.shot(320, 300); h.advance();
  expect(h.fx.labels.count).toBe(1); expect(h.state.hits).toBe(0); expect(h.fx.flash).toBe(0);
});

test("a bug spawned and squashed in the same step is observed", () => {
  const h = fixture(); h.state.spawnIn = 0;
  // Arrange the projectile at the actual seeded, post-movement spawn position.
  const probe = createSimulation(1); probe.spawnIn = 0; probe.fireIn = 100; step(probe, IDLE, STEP);
  const bug = probe.bugs[0]!; h.shot(bug.x, bug.y); h.advance();
  expect(h.state.squashes).toBe(1); expect(h.fx.labels.count).toBe(1);
  expect(h.fx.labels.x[0]).toBe(bug.x); expect(h.fx.labels.y[0]).toBe(bug.y);
});

test("five catch-up steps retain every squash and movement trail before a draw", () => {
  const h = fixture(), loop = new FixedStepper(h.feedback), moving = { x: 1, y: 0, target: null };
  h.state.bugs.push({ id: 1, kind: "base", x: 100, y: 300 }, { id: 2, kind: "base", x: 500, y: 300 });
  h.shot(100, 300);
  // This shot cannot reach the second bug on the first step, but does in catch-up.
  h.state.shots.push({ x: 450, y: 300, vx: 600, vy: 0, life: 1 });
  const firstStep = structuredClone(h.state); step(firstStep, moving, STEP);
  expect(firstStep.squashes).toBe(1);
  h.fx.advance(0); loop.advance(0, h.state, moving); h.fx.advance(100); loop.advance(100, h.state, moving);
  expect(h.state.time).toBeCloseTo(STEP * 5); expect(h.state.squashes).toBe(2); expect(h.fx.labels.count).toBe(2);
  expect(h.fx.labels.x[0]).toBeLessThan(150); expect(h.fx.labels.x[1]).toBeGreaterThan(450);
  expect(h.fx.labels.life[0]).toBe(0.65); expect(h.fx.trails.count).toBeGreaterThan(0);
});

test("bounded snapshot overflow omits only untracked cosmetics", () => {
  const fx = new Effects(), feedback = new Feedback(fx, 2);
  const bugs: Bug[] = [{ id: 1, kind: "base", x: 1, y: 2 }, { id: 2, kind: "base", x: 3, y: 4 }, { id: 3, kind: "base", x: 5, y: 6 }];
  feedback.beforeKills(bugs, 0); feedback.afterKills([bugs[1]!], 2);
  expect(fx.labels.count).toBe(1); expect(fx.labels.x[0]).toBe(1);
  fx.reset(); feedback.reset(); feedback.afterKills([], 0); expect(fx.labels.count).toBe(0);
});

test("terminal hit emits once, stops new trails, decays after death and restarts cleanly", () => {
  const h = fixture(); h.state.hits = 2; h.state.bugs.push({ id: 1, kind: "base", x: 300, y: 300 });
  const loop = new FixedStepper(h.feedback); h.fx.advance(0); loop.advance(0, h.state, IDLE);
  h.fx.advance(17); loop.advance(17, h.state, IDLE);
  expect(h.state.dead).toBe(true); expect(h.fx.flash).toBe(0.1); expect(h.fx.trails.count).toBe(0);
  h.fx.advance(100); loop.advance(100, h.state, IDLE);
  expect(h.fx.flash).toBeLessThan(0.1);
  for (let time = 117; time < 1000; time += 17) { h.fx.advance(time); loop.advance(time, h.state, IDLE); }
  expect(h.fx.flash).toBe(0); expect(h.fx.shake.remaining).toBe(0);
  h.fx.reset(); h.feedback.reset(); loop.reset();
  const fresh = createSimulation(1); loop.advance(1000, fresh, IDLE); loop.advance(1017, fresh, IDLE);
  expect(h.fx.labels.count).toBe(0); expect(h.fx.trails.count).toBe(0); expect(h.fx.flash).toBe(0);
});

test.each([
  { seed: 1, arena: { width: 450, height: 800 } },
  { seed: 42, arena: { width: 800, height: 450 } },
  { seed: 12345, arena: { width: 600, height: 600 } },
])("observation never changes complete simulation state (seed $seed, $arena)", ({ seed, arena }) => {
  const plain = createSimulation(seed, arena), observed = createSimulation(seed, arena), fx = new Effects(), feedback = new Feedback(fx);
  const input = { x: 0, y: 0, target: null };
  for (let i = 0; i < 3600; i++) {
    input.x = Math.sin(i / 75); input.y = Math.cos(i / 93);
    fx.advance(i * 1000 / 60); feedback.beforeStep(observed);
    step(plain, input, STEP); step(observed, input, STEP, feedback); feedback.afterStep(observed, STEP);
    expect(observed).toEqual(plain);
    if (plain.upgrades.offer) {
      const number = plain.upgrades.choiceNumber, id = plain.upgrades.offer[(number - 1) % 3]!;
      chooseUpgrade(plain, number, id); chooseUpgrade(observed, number, id);
    }
  }
});
