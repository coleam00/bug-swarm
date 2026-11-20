import { expect, test } from "bun:test";
import { Pool } from "./pool";
import { Particles } from "./particles";
import { Trails } from "./trails";
import { FloatingText } from "./floating-text";
import { Effects } from "./index";

test("pool: fixed storage, cap/drop, exact expiry, reuse and reset", () => {
  const pool = new Pool(2), storage = [pool.x, pool.y, pool.vx, pool.vy, pool.life, pool.duration];
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

test("particle spread is seeded, bounded and reproducible after reset", () => {
  const a = new Particles(10), b = new Particles(10);
  a.burst(10, 20); b.burst(10, 20); expect(a.vx).toEqual(b.vx); expect(a.life).toEqual(b.life);
  const count = a.count;
  expect(count).toBeGreaterThan(1); expect(count).toBeLessThanOrEqual(a.capacity);
  for (let i = 0; i < a.capacity; i++) a.burst(10, 20);
  expect(a.count).toBe(a.capacity);
  a.reset(); a.burst(10, 20); expect(a.count).toBe(count);
  expect(a.vx.subarray(0, count)).toEqual(b.vx.subarray(0, count));
  expect(a.vy.subarray(0, count)).toEqual(b.vy.subarray(0, count));
  expect(a.life.subarray(0, count)).toEqual(b.life.subarray(0, count));
  a.update(0.05);
  for (let i = 0; i < count; i++) expect(Math.hypot(a.x[i]! - 10, a.y[i]! - 20)).toBeGreaterThan(0);
  expect(Math.max(...a.x.subarray(0, count)) - Math.min(...a.x.subarray(0, count))).toBeGreaterThan(0);
  expect(Math.max(...a.y.subarray(0, count)) - Math.min(...a.y.subarray(0, count))).toBeGreaterThan(0);
  a.update(Math.max(...a.life)); expect(a.count).toBe(0);
});

test("floating squash text rises from its emission position", () => {
  const text = new FloatingText(); text.pop(100, 200); text.update(0.1);
  expect(text.count).toBe(1); expect(text.x[0]).toBe(100); expect(text.y[0]).toBeLessThan(200);
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
    if (fx.shake.remaining > 0) expect(Math.hypot(fx.shake.x, fx.shake.y)).toBeGreaterThan(0);
  }
  expect(fx.flash).toBe(0); expect(fx.shake.remaining).toBe(0); expect(fx.shake.x).toBe(0); expect(fx.shake.y).toBe(0);
  expect(fx.labels.count).toBe(0); expect(fx.particles.count).toBe(0);
  fx.hit(); fx.squash(1, 2); fx.reset(); fx.advance(50000);
  expect(fx.time).toBe(0); expect(fx.flash).toBe(0); expect(fx.labels.count).toBe(0);
  expect(fx.particles).toBe(particles); expect(fx.labels).toBe(labels);
});

test("live effects count occupied pool slots, expire and reset", () => {
  const fx = new Effects();
  expect(fx.liveCount).toBe(0);
  for (let i = 0; i < 2; i++) fx.particles.emit(0, 0, 0, 0, 0.0625);
  fx.trails.emit(0, 0, 0, 0, 0.125);
  for (let i = 0; i < 3; i++) fx.labels.emit(0, 0, 0, 0, 0.25);
  expect(fx.liveCount).toBe(6);
  fx.advance(0); fx.advance(62.5); expect(fx.liveCount).toBe(4);
  fx.advance(125); expect(fx.liveCount).toBe(3);
  fx.advance(187.5); fx.advance(250); expect(fx.liveCount).toBe(0);
  fx.particles.emit(0, 0, 0, 0, 10); fx.trails.emit(0, 0, 0, 0, 10); fx.labels.emit(0, 0, 0, 0, 10);
  fx.hit(); fx.bomb(0, 0, 100); expect(fx.liveCount).toBe(6);
  fx.reset(); expect(fx.liveCount).toBe(0);
});

test.each(["ring", "flash", "shake"] as const)("live effects count an active %s once until expiry", kind => {
  const fx = new Effects();
  if (kind === "ring") fx.bomb(0, 0, 100);
  else if (kind === "flash") fx.flash = 0.1;
  else fx.shake.hit();
  expect(fx.liveCount).toBe(1);
  fx.advance(0);
  for (let time = 62.5; time <= 562.5; time += 62.5) fx.advance(time);
  expect(fx.liveCount).toBe(0);
});

test("hits and bombs replace their active effects rather than growing the count", () => {
  const fx = new Effects();
  fx.hit(); expect(fx.liveCount).toBe(2);
  fx.bomb(0, 0, 100); expect(fx.liveCount).toBe(3);
  fx.advance(0); fx.advance(62.5);
  fx.hit(); fx.bomb(10, 20, 200); expect(fx.liveCount).toBe(3);
  fx.advance(125); expect(fx.liveCount).toBe(3);
  fx.advance(187.5); expect(fx.liveCount).toBe(2);
  fx.advance(250); expect(fx.liveCount).toBe(1);
  for (let time = 312.5; time <= 625; time += 62.5) fx.advance(time);
  expect(fx.liveCount).toBe(0);
});
