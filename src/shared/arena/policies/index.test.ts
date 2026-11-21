import { expect, test } from "bun:test";
import { createPolicy, intercept, policyInput, type Observation } from "./index";
import { lifeDefaults } from "../types";
import { createBug } from "../bugs/registry";
import { createArena, joinPlayer, stepArena } from "../simulation";
import { downPlayer } from "../revive";
const player = { ...lifeDefaults(), id: "a", name: "Pilot", team: "tabs" as const, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0 };

test("aimer prefers exposed targets, withholds guarded shots and retains an edge-aware flank side", () => {
  const b = createBug("beetle", 1, 1100, 1200), exposed = createBug("crawler", 2, 1200, 1400);
  const state = createPolicy(83), observation = { pickups: [], globs: [], tick: 0, players: [player], bugs: [b] };
  const first = policyInput("aimer", observation, player, state);
  expect(first.fire).toBe(false); expect(state.flankId).toBe(b.id); expect(state.flankSide).toBe(1);
  policyInput("aimer", observation, player, state); expect(state.flankSide).toBe(1);
  const input = policyInput("aimer", { ...observation, bugs: [b, exposed] }, player, state);
  expect(input.fire).toBe(true); expect(input.aim).toBeCloseTo(Math.PI / 2); expect(state.flankId).toBeUndefined();
  const edge = { ...player, y: 30 }, edgeBug = { ...b, y: 30 };
  policyInput("aimer", { pickups: [], globs: [], tick: 0, players: [edge], bugs: [edgeBug] }, edge, state); expect(state.flankSide).toBe(-1);
  policyInput("aimer", { pickups: [], globs: [], tick: 0, players: [], bugs: [] }, { ...player, status: "out" }, state); expect(state.flankId).toBeUndefined();
});

test("solo aimer circles into an exposed angle and kills a turning beetle; a teammate can draw its shell away", () => {
  for (const teammate of [false, true]) {
    const a = createArena(83), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!;
    Object.assign(p, { x: 1300, y: 1200 });
    const b = createBug("beetle", 900, 1200, 1200); a.bugs = [b];
    if (teammate) {
      const q = joinPlayer(a, { id: "b", name: "Friend", team: "spaces" })!;
      Object.assign(q, { x: 1250, y: 1200, immuneUntil: 60000 }); p.x = 1100;
    }
    const state = createPolicy(83); let fired = false, survived = true;
    for (let i = 0; i < 1200 && a.bugs.some(b => b.id === 900); i++) {
      a.bugs = a.bugs.filter(b => b.id === 900); // Isolate this maneuver from unrelated pressure.
      a.spawnCredits.clear();
      const input = policyInput("aimer", { pickups: [], globs: a.globs, tick: a.tick, players: [...a.players.values()], bugs: a.bugs }, p, state);
      fired ||= input.fire; stepArena(a, new Map([[p.id, input]])); survived &&= p.status === "active";
    }
    expect(fired).toBe(true); expect(a.bugs.some(b => b.id === 900)).toBe(false);
    expect(p.kills).toBe(1); expect(p.score).toBeGreaterThanOrEqual(66); expect(survived).toBe(true);
  }
});

test("aimer reads visible locked corridor, prefers earliest tell/id, holds perpendicular dodge through dash and chooses edge clearance", () => {
  const b = createBug("dasher", 2, 960, 1200); Object.assign(b, { phase: "windup", phaseUntil: 700 });
  const state = createPolicy(71), observation = { globs: [], pickups: [], tick: 0, players: [player], bugs: [b] };
  const first = policyInput("aimer", observation, player, state); expect(first.move.y).toBeGreaterThan(0.25); expect(first.fire).toBe(true);
  b.phase = "dash"; player.y += 100;
  const crowd = createBug("crawler", 9, player.x, player.y + 40);
  expect(policyInput("aimer", { ...observation, globs: [], tick: 0, bugs: [b, crowd] }, player, state).move.y).toBeLessThan(0);
  expect(state.dodgeId).toBe(b.id); expect(state.dodgeY).toBe(1); player.y -= 100;
  b.phase = "recovery"; policyInput("aimer", observation, player, state); expect(state.dodgeId).toBeUndefined();
  b.phase = "windup";
  const early = { ...b, id: 3, phaseUntil: 650 }, tie = { ...early, id: 1 };
  policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [player], bugs: [b, early, tie] }, player, state); expect(state.dodgeId).toBe(1);
  const edge = { ...player, y: 2380 }, edgeBug = { ...b, y: 2380 }, edgeState = createPolicy(1);
  expect(policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [edge], bugs: [edgeBug] }, edge, edgeState).move.y).toBeLessThan(-0.5);
  expect(edgeState.dodgeY).toBe(-1);
  expect(policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [player], bugs: [{ ...b, facing: Math.PI / 2 }] }, player, createPolicy(1)).move.x).not.toBe(0);
});
test("mover aims along motion; aimer leads available targets, fires only in range and bursts with hysteresis", () => {
  const observation = { globs: [], pickups: [], tick: 0, players: [player], bugs: [{ id: 1, kind: "crawler" as const, hp: 1, facing: 0, x: 1600, y: 1200, vx: 0, vy: 140 }] }, before = structuredClone(observation);
  const mover = policyInput("mover", observation, player, createPolicy(1)); expect(mover.fire).toBe(true); expect(mover.aim).toBe(Math.atan2(mover.move.y, mover.move.x));
  const state = createPolicy(1), aimed = policyInput("aimer", observation, player, state); expect(aimed.fire).toBe(true); expect(aimed.aim).toBeGreaterThan(0);
  expect(policyInput("aimer", observation, { ...player, heat: 12 }, state).fire).toBe(false);
  expect(policyInput("aimer", observation, { ...player, heat: 6 }, state).fire).toBe(false);
  expect(policyInput("aimer", observation, { ...player, heat: 3 }, state).fire).toBe(true);
  expect(policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [player], bugs: [] }, player, state).fire).toBe(false);
  expect(policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [player], bugs: [{ ...observation.bugs[0]!, x: 2300 }] }, player, state).fire).toBe(false);
  expect(intercept(400, 0, 1000, 0)).toBeNull(); expect(intercept(400, 0, 0, 0)).toBeCloseTo(400 / 900);
  expect(observation).toEqual(before);
});
test("mover dodges a nearby side threat while aimer retreats inside its desired separation", () => {
  const waypoint = () => ({ ...createPolicy(1), steps: 1, x: 1800, y: 1200 });
  const empty = { globs: [], pickups: [], tick: 0, players: [player], bugs: [] };
  expect(policyInput("mover", empty, player, waypoint()).move.y).toBe(0);
  const dodge = policyInput("mover", { globs: [], pickups: [], tick: 0, players: [player], bugs: [{ id: 1, kind: "crawler", hp: 1, facing: 0, x: 1200, y: 1250, vx: 0, vy: 0 }] }, player, waypoint());
  expect(dodge.move.y).toBeLessThan(0); expect(dodge.fire).toBe(true); expect(dodge.aim).toBe(Math.atan2(dodge.move.y, dodge.move.x));
  const target = { id: 1, kind: "crawler" as const, hp: 1, facing: 0, x: 1400, y: 1200, vx: 0, vy: 0 };
  expect(policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [player], bugs: [target] }, player, createPolicy(1)).move.x).toBeLessThan(0);
  expect(policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [player], bugs: [{ ...target, x: 1900 }] }, player, createPolicy(1)).move.x).toBeGreaterThan(0);
});

test("aimer approaches the nearest cross-team downed player, holds contact, and yields to danger", () => {
  const target = { ...player, id: "b", team: "spaces" as const, status: "downed" as const, hits: 0, x: 1500 };
  const tied = { ...target, id: "aa", x: 900 };
  const input = (players: Observation["players"] = [target], bugs: Observation["bugs"] = []) =>
    policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [player, ...players], bugs }, player, createPolicy(1));
  expect(input()).toMatchObject({ move: { x: 1, y: 0 }, fire: false });
  expect(input([target, tied]).move.x).toBe(-1);
  expect(input([{ ...target, x: 1290 }])).toMatchObject({ move: { x: 0, y: 0 }, fire: false });
  expect(input([{ ...target, x: 1650 }]).move.x).toBe(1);
  const bug = { id: 1, kind: "crawler" as const, hp: 1, facing: 0, x: 1400, y: 1200, vx: 0, vy: 0 };
  expect(input([target], [bug]).move.x).toBeLessThan(0);
  expect(input([target], [{ ...bug, x: 1400.001 }])).toMatchObject({ move: { x: 1, y: 0 }, fire: false });
  for (const status of ["downed", "out"] as const) for (const policy of ["aimer", "mover"] as const)
    expect(policyInput(policy, { globs: [], pickups: [], tick: 0, players: [target], bugs: [bug] }, { ...player, status }, createPolicy(1))).toMatchObject({ move: { x: 0, y: 0 }, fire: false });
  for (const invalid of [{ ...target, x: 1650.001 }, { ...target, status: "active" as const }, { ...target, status: "out" as const }])
    expect(input([invalid]).move).not.toEqual({ x: 1, y: 0 });
});

test("shared aimer policy reaches contact and completes a rescue through the real simulation", () => {
  const arena = createArena(1), rescuer = joinPlayer(arena, { id: "a", name: "Rescuer", team: "tabs" })!;
  const target = joinPlayer(arena, { id: "b", name: "Downed", team: "spaces" })!;
  Object.assign(rescuer, { x: 1200, y: 1200 }); Object.assign(target, { x: 1600, y: 1200 }); downPlayer(arena, target);
  const policy = createPolicy(1);
  for (let i = 0; i < 100 && target.status === "downed"; i++) {
    arena.bugs = [];
    const input = policyInput("aimer", { globs: [], pickups: [], tick: 0, players: [...arena.players.values()], bugs: [] }, rescuer, policy);
    expect(input.fire).toBe(false); stepArena(arena, new Map([[rescuer.id, input]]));
  }
  expect(target.status).toBe("active"); expect(rescuer.score).toBe(50); expect(target.life).toBe(1);
});

test("aimer sidesteps a threatening tell before resuming a nearby rescue", () => {
  const target = { ...player, id: "b", status: "downed" as const, hits: 0, x: 1500 };
  const bug = createBug("dasher", 71, 960, 1200);
  Object.assign(bug, { phase: "windup", phaseUntil: 700 });
  const state = createPolicy(71), observation = { globs: [], pickups: [], tick: 0, players: [player, target], bugs: [bug] };
  const dodge = policyInput("aimer", observation, player, state);
  expect(dodge.move.y).toBeGreaterThan(0.25); expect(dodge.fire).toBe(true);
  bug.phase = "recovery";
  expect(policyInput("aimer", observation, player, state)).toMatchObject({ move: { x: 1, y: 0 }, fire: false });
  expect(state.dodgeId).toBeUndefined();
});

test("glob dodging chooses earliest threat/id and wall clearance, ignores receding globs, resumes rescue", () => {
  const target = { ...player, id: "rescue", status: "downed" as const, x: 1500 };
  const g = { id: 10, x: 1000, y: 1200, vx: 320, vy: 0, born: 0 }, state = createPolicy(78);
  const observation = { pickups: [], players: [player, target], bugs: [], globs: [g, { ...g, id: 2 }], tick: 0 };
  const dodge = policyInput("aimer", observation, player, state); expect(dodge.move.y).toBeGreaterThan(0.5); expect(state.globDodgeId).toBe(2);
  const side = state.globDodgeY; policyInput("aimer", observation, { ...player, y: 1205 }, state); expect(state.globDodgeY).toBe(side);
  expect(policyInput("aimer", { ...observation, globs: [{ ...g, vx: -320 }] }, player, state)).toMatchObject({ move: { x: 1, y: 0 }, fire: false });
  const edge = { ...player, y: 2380 };
  expect(policyInput("aimer", { ...observation, players: [edge], globs: [{ ...g, y: edge.y }] }, edge, createPolicy(1)).move.y).toBeLessThan(-0.5);
  policyInput("aimer", { ...observation, tick: 41 }, player, state); expect(state.globDodgeId).toBeUndefined();
});

test.each([1, 78, 900])("seed %i: the shared aimer escapes an incoming glob in the simulation", seed => {
  const a = createArena(seed), p = joinPlayer(a, { id: "a", name: "Pilot", team: "tabs" })!, state = createPolicy(seed);
  p.x = p.y = 1200; p.spawnProtectedUntil = 0;
  a.globs.push({ id: a.nextId++, x: 1000, y: 1200, vx: 320, vy: 0, born: 0 });
  const target = joinPlayer(a, { id: "b", name: "Rescue", team: "spaces" })!; target.x = 1500; target.y = 1200; downPlayer(a, target);
  for (let i = 0; i < 30; i++) {
    const input = policyInput("aimer", { pickups: [], players: [...a.players.values()], bugs: a.bugs, globs: a.globs, tick: a.tick }, p, state);
    stepArena(a, new Map([[p.id, { ...input, fire: false }]]));
  }
  expect(p.hits).toBe(3); expect(state.globDodgeId).toBeUndefined();
});
