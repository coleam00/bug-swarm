import { test, expect } from "bun:test";
import { CombatCoverage, type CombatSample } from "./combat-coverage";
function samples(at: number, life = 1, status: CombatSample["status"] = "active"): CombatSample[] {
  return ["A", "B"].map(name => ({ name, life, status, fire: at % 1500 < 750, shot: at % 1500 < 750,
    command: { at, serial: at + 1, life, input: { move: { x: 1, y: 0 }, aim: at / 1000, fire: at % 1500 < 750 } } }));
}
test("60 seconds requires sustained real aim, fire and shots; ordinary bursts and replacement lives count", () => {
  const coverage = new CombatCoverage(["A", "B"]);
  for (let at = 0; at <= 71000; at += 100) coverage.observe(at, samples(at, at < 20000 ? 1 : 2, at >= 10000 && at < 20000 ? "out" : "active"));
  expect(coverage.creditedMs).toBe(60000); expect(() => coverage.requireComplete()).not.toThrow();
});
test("ten seconds of fighting followed by fifty seconds idle or dead cannot pass", () => {
  const coverage = new CombatCoverage(["A", "B"]);
  for (let at = 0; at <= 10000; at += 100) coverage.observe(at, samples(at));
  const idle = samples(11000); idle.forEach(s => { s.command = undefined; s.fire = s.shot = false; });
  for (let at = 11000; at <= 60000; at += 100) coverage.observe(at, idle);
  expect(() => coverage.requireComplete()).toThrow("Only 10000 ms");
  for (let at = 11000; at <= 60000; at += 100) coverage.observe(at, samples(at, 1, "out"));
  expect(() => coverage.requireComplete()).toThrow("Only 10000 ms");
});
test("fresh movement/aim alone, or fire commands without browser fire and shots, cannot earn combat credit", () => {
  for (const field of ["fire", "shot"] as const) {
    const coverage = new CombatCoverage(["A", "B"]);
    expect(() => { for (let at = 0; at <= 5100; at += 100) { const s = samples(at); s[1]![field] = false; coverage.observe(at, s); } }).toThrow("lacks repeated aim");
  }
});
