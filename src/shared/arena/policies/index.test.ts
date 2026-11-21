import { expect, test } from "bun:test";
import { createPolicy, intercept, policyInput } from "./index";
import { lifeDefaults } from "../types";
const player = { ...lifeDefaults(), id: "a", name: "Pilot", team: "tabs" as const, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0 };
test("mover aims along motion; aimer leads available targets, fires only in range and bursts with hysteresis", () => {
  const observation = { players: [player], bugs: [{ id: 1, kind: "crawler" as const, x: 1600, y: 1200, vx: 0, vy: 140 }] }, before = structuredClone(observation);
  const mover = policyInput("mover", observation, player, createPolicy(1)); expect(mover.fire).toBe(true); expect(mover.aim).toBe(Math.atan2(mover.move.y, mover.move.x));
  const state = createPolicy(1), aimed = policyInput("aimer", observation, player, state); expect(aimed.fire).toBe(true); expect(aimed.aim).toBeGreaterThan(0);
  expect(policyInput("aimer", observation, { ...player, heat: 12 }, state).fire).toBe(false);
  expect(policyInput("aimer", observation, { ...player, heat: 6 }, state).fire).toBe(false);
  expect(policyInput("aimer", observation, { ...player, heat: 3 }, state).fire).toBe(true);
  expect(policyInput("aimer", { players: [player], bugs: [] }, player, state).fire).toBe(false);
  expect(policyInput("aimer", { players: [player], bugs: [{ ...observation.bugs[0]!, x: 2300 }] }, player, state).fire).toBe(false);
  expect(intercept(400, 0, 1000, 0)).toBeNull(); expect(intercept(400, 0, 0, 0)).toBeCloseTo(400 / 900);
  expect(observation).toEqual(before);
});
