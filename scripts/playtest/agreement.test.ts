import { test, expect } from "bun:test";
import { comparePage, compareBoard, compareResult, visibleEffect, visiblePlayers } from "./agreement";
import { createArena, joinPlayer, stepArena } from "../../src/shared/arena/simulation";
import type { Snapshot } from "../../src/shared/arena/protocol";
import type { PageObservation, ServerObservation } from "./types";
import { TEAM_COLOURS } from "../../src/shared/teams";
function fixture() {
  const state = createArena(86);
  joinPlayer(state, { id: "local", name: "PilotA", team: "tabs" });
  joinPlayer(state, { id: "remote", name: "PilotB", team: "spaces" });
  const snapshots: ServerObservation["snapshots"] = [];
  for (let i = 0; i < 5; i++) {
    stepArena(state, new Map([["remote", { move: { x: 1, y: 0 }, aim: 0, fire: false }]]));
    snapshots.push(structuredClone({ observedAt: 800 + i * 50, v: 1, type: "snapshot", arenaId: "room", tick: state.tick, wave: state.wave, players: [...state.players.values()].map(p => ({ ...p, ackSeq: 0 })), bugs: state.bugs, shots: state.shots, globs: state.globs, events: state.events }));
  }
  const s = snapshots[4]!, local = s.players[0]!, remote = { ...s.players[1]!, x: (snapshots[2]!.players[1]!.x + snapshots[3]!.players[1]!.x) / 2 };
  const page: PageObservation = { now: 1000, text: "", fps: 60, frameMs: 1, result: null, frame: {
    at: 1000, epoch: 1000, receivedAt: 975, frame: 10, generation: 1, playerId: local.id, local, snapshot: s, width: 1280, height: 720, camera: { x: 0, y: 0 }, scale: 1,
    players: [local, remote], interpolation: { a: 3, b: 4, fraction: .5, transitions: [["local", 1], ["remote", 1]] },
    paint: { players: [local, remote].map(p => ({ ...p, colour: TEAM_COLOURS[p.team], reviveRing: false })), bugs: [], effects: [], shots: [], minimap: [local, remote].map(p => ({ id: p.id, colour: TEAM_COLOURS[p.team] })), hud: { score: local.score, hits: local.hits, population: 2, wave: s.wave } }, input: { left: false, right: false, fire: false },
  } };
  const server = { generation: 1, snapshots, lives: [] } as unknown as ServerObservation;
  return { page: structuredClone(page), server };
}
test("time-aligned delayed remote interpolation passes against independent history", () => {
  const { page, server } = fixture(); expect(() => comparePage(page, server)).not.toThrow();
  page.frame!.local.x += 40; page.frame!.paint.players[0]!.x += 40; expect(() => comparePage(page, server)).not.toThrow();
  page.frame!.local.x += .001; expect(() => comparePage(page, server)).toThrow("Local prediction");
});
test("remote tolerance is two world units; stopped local tolerance is two", () => {
  const { page, server } = fixture(); page.frame!.players[1]!.x += 2; page.frame!.paint.players[1]!.x += 2;
  expect(() => comparePage(page, server, undefined, true)).not.toThrow();
  page.frame!.players[1]!.x += .001; expect(() => comparePage(page, server)).toThrow("Remote position");
});
for (const [label, mutate] of Object.entries({
  membership: (p: PageObservation) => p.frame!.players.pop(),
  colour: (p: PageObservation) => { p.frame!.paint.players[0]!.colour = "red"; },
  minimap: (p: PageObservation) => { p.frame!.paint.minimap.pop(); },
  hud: (p: PageObservation) => { p.frame!.paint.hud!.score++; },
  fraction: (p: PageObservation) => { p.frame!.interpolation.fraction += .2; },
  name: (p: PageObservation) => { p.frame!.players[1]!.name = "Wrong"; },
  team: (p: PageObservation) => { p.frame!.players[1]!.team = "tabs"; },
  life: (p: PageObservation) => { p.frame!.players[1]!.life++; },
  score: (p: PageObservation) => { p.frame!.players[1]!.score++; },
  status: (p: PageObservation) => { p.frame!.players[1]!.status = "downed"; },
  stale: (p: PageObservation) => { p.now += 501; },
  snapshot: (p: PageObservation) => { p.frame!.receivedAt -= 501; },
  generation: (p: PageObservation) => { p.frame!.generation++; },
  missing: (p: PageObservation) => { p.frame = null; },
})) test(`agreement rejects ${label}`, () => { const { page, server } = fixture(); mutate(page); expect(() => comparePage(page, server)).toThrow(); });
test("freshness boundary passes, frozen frames and missing history fail", () => {
  const { page, server } = fixture(); page.now += 500; expect(() => comparePage(page, server)).not.toThrow();
  expect(() => comparePage(page, server, page.frame!)).toThrow("Frozen");
  server.snapshots = server.snapshots.filter(s => s.tick !== 3); expect(() => comparePage(page, server)).toThrow("Missing authoritative history");
});
test("visibility requires actual painted robots/effects with matching tick", () => {
  const { page } = fixture(), f = page.frame!;
  expect(() => visiblePlayers([f], ["remote"])).not.toThrow(); f.paint.players.pop(); expect(() => visiblePlayers([f], ["remote"])).toThrow();
  expect(() => visibleEffect(f, 7, 5)).toThrow(); f.paint.effects.push({ id: 7, tick: 5, at: 1000, x: 5, y: 5, kind: "crawler", type: "kill", points: 10 });
  expect(() => visibleEffect(f, 7, 5)).not.toThrow(); expect(() => visibleEffect(f, 7, 6)).toThrow();
  expect(() => visibleEffect(f, 7, 5, 0)).not.toThrow(); expect(() => visibleEffect(f, 7, 5, -1)).toThrow("deadline");
});
test("board rejects reordered, omitted and incorrect rows; results reject unsaved/wrong score/best/rank", () => {
  const expected = [{ name: "PilotA", score: 30 }, { name: "PilotB", score: 20 }], rows = expected.map((r,i) => ({ rank: i+1, ...r }));
  expect(() => compareBoard(rows, expected)).not.toThrow(); expect(() => compareBoard(rows.slice().reverse(), expected)).toThrow(); expect(() => compareBoard(rows.slice(0,1), expected)).toThrow();
  rows[0]!.score++; expect(() => compareBoard(rows, expected)).toThrow();
  const actual = { score: 30, best: 40, standing: "Your best is #1 of 2", save: "Score saved" }, result = { score: 30, best: 40, standing: actual.standing };
  expect(() => compareResult(actual, result)).not.toThrow();
  for (const changed of [{ score: 31 }, { best: 41 }, { standing: "Your best is #2 of 2" }, { save: "Saving" }]) expect(() => compareResult({ ...actual, ...changed }, result)).toThrow();
});
