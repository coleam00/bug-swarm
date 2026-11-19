import { expect, test } from "bun:test";
import { Particles } from "./particles";
import { Trails } from "./trails";
import { FloatingText } from "./floating-text";
import { Effects } from "./index";

for (const [name, create] of [
  ["particles", () => new Particles(2)], ["trails", () => new Trails(2)], ["floating text", () => new FloatingText(2)],
] as const) {
  test(`${name}: fixed storage, cap/drop, exact expiry, reuse and reset`, () => {
    const pool = create(), storage = [pool.x, pool.y, pool.vx, pool.vy, pool.life, pool.duration];
    const a = pool.emit(1, 2, 10, -2, 0.25), b = pool.emit(3, 4, 0, 0, 0.5);
    expect(a).not.toBe(b); expect(pool.count).toBe(2);
    expect(pool.emit(99, 99, 0, 0, 1)).toBe(-1); expect(pool.x[a]).toBe(1);
    pool.update(0.125); expect(pool.x[a]).toBe(2.25); expect(pool.y[a]).toBe(1.75);
    pool.update(0.125); expect(pool.life[a]).toBe(0); expect(pool.count).toBe(1);
    expect(pool.emit(5, 6, -1, 1, 0.25)).toBe(a);
    pool.update(0.25); expect(pool.count).toBe(0);
    for (let n = 0; n < 100; n++) { pool.emit(n, n, 1, 1, 1); pool.update(1); pool.reset(); }
    [pool.x, pool.y, pool.vx, pool.vy, pool.life, pool.duration].forEach((value, i) => expect(value).toBe(storage[i]!));
    pool.emit(1, 1, 0, 0, 1); pool.reset(); expect(pool.count).toBe(0);
    expect(pool.emit(0, 0, 0, 0, 0)).toBe(-1); expect(pool.count).toBe(0);
  });
}

test("particle spread is seeded, bounded and reproducible after reset", () => {
  const a = new Particles(10), b = new Particles(10);
  a.burst(10, 20); b.burst(10, 20); expect(a.vx).toEqual(b.vx); expect(a.life).toEqual(b.life);
  expect(a.count).toBe(8); a.burst(10, 20); expect(a.count).toBe(10);
  a.reset(); a.burst(10, 20); expect(a.vx.subarray(0, 8)).toEqual(b.vx.subarray(0, 8));
  a.update(0.45); expect(a.count).toBe(0);
});

test("trail samples only movement, caps sampling at 40 Hz and resets cooldown", () => {
  const trail = new Trails();
  for (let i = 0; i < 1000; i++) trail.movement(i, 0, false, 0.001);
  expect(trail.count).toBe(0);
  for (let i = 0; i < 1000; i++) trail.movement(i, 0, true, 0.001);
  expect(trail.count).toBe(40);
  trail.update(0.18); expect(trail.count).toBe(0);
  trail.reset(); trail.movement(1, 2, true, 0); expect(trail.count).toBe(1);
});

test("effects expire after a terminal hit, clamp suspended time and reset without replacing pools", () => {
  const fx = new Effects(), particles = fx.particles, labels = fx.labels;
  fx.advance(0); fx.hit(); fx.squash(10, 20); fx.advance(10000);
  expect(fx.time).toBeCloseTo(1 / 12); expect(fx.flash).toBeGreaterThan(0);
  fx.hit(); fx.hit(); expect(fx.shake.remaining).toBe(0.16);
  for (let time = 10017; time < 11000; time += 17) {
    fx.advance(time); expect(Math.hypot(fx.shake.x, fx.shake.y)).toBeLessThanOrEqual(4.000001);
  }
  expect(fx.flash).toBe(0); expect(fx.shake.remaining).toBe(0); expect(fx.shake.x).toBe(0); expect(fx.shake.y).toBe(0);
  expect(fx.labels.count).toBe(0); expect(fx.particles.count).toBe(0);
  fx.hit(); fx.squash(1, 2); fx.reset(); fx.advance(50000);
  expect(fx.time).toBe(0); expect(fx.flash).toBe(0); expect(fx.labels.count).toBe(0);
  expect(fx.particles).toBe(particles); expect(fx.labels).toBe(labels);
});
