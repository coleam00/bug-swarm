import { expect, test } from "bun:test";
import { parseClient, parseServer, serializeSnapshot, type Hello, type InputMessage, type ArenaError, type Snapshot, type Welcome } from "./protocol";
import { createArena, joinPlayer } from "./simulation";
import { MAX_PLAYERS, PLAYER_RADIUS, PLAYER_SPEED, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { MAX_BUGS, MAX_SHOTS, MAX_EVENTS, SERVER_MESSAGE_BYTES } from "./constants";
import { createBug } from "./bugs/registry";
const hello: Hello = { v: 1, type: "hello", playerId: crypto.randomUUID(), name: "Robot", team: "tabs", touch: false, buildId: "test" };
const input: InputMessage = { v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 1, y: 0 }, aim: 0, fire: false };

test("crawler validation accepts stationary and moving crawlers but rejects speed, phase and timer state", () => {
  const bug = createBug("crawler", 1, 1200, 1200);
  const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "room", tick: 1, wave: 1, players: [], bugs: [bug], shots: [], events: [] };
  const parse = () => parseServer(serializeSnapshot(snapshot));
  expect(parse()).not.toBeNull(); Object.assign(bug, { vx: 84, vy: 112 }); expect(parse()).not.toBeNull();
  const valid = { ...bug };
  for (const fields of [{ vx: 1000 }, { vx: 100, vy: 100 }, { phase: "windup" }, { phaseUntil: 750 },
    { phase: "approach", phaseUntil: 0 }, { phase: null }, { phaseUntil: null }]) {
    snapshot.bugs[0] = { ...valid, ...fields } as any; expect(parse()).toBeNull();
  }
});

test("registered kind validation accepts each dasher phase and hit/kill events, rejects malformed state", () => {
  const b = createBug("dasher", 1, 1200, 1200);
  const s: Snapshot = { v: 1, type: "snapshot", arenaId: "room", tick: 1, wave: 3, players: [], bugs: [b], shots: [], events: [] };
  const parse = () => parseServer(serializeSnapshot(s));
  for (const [phase, until, vx] of [["approach", 0, 140], ["windup", 750, 0], ["dash", 500, 490], ["recovery", 1050, 35]] as const) {
    Object.assign(b, { phase, phaseUntil: until, vx }); expect(parse()).not.toBeNull();
  }
  const valid = { ...b };
  for (const fields of [{ hp: 0 }, { hp: 3 }, { hp: 1.5 }, { hp: undefined }, { phase: "other" }, { phase: undefined }, { phaseUntil: 50 }, { phaseUntil: 1051 }, { phaseUntil: null }, { facing: null }, { facing: 4 }, { vx: 36 }, { kind: "constructor" }]) {
    Object.assign(b, valid, fields); expect(parse()).toBeNull();
  }
  Object.assign(b, valid, { phase: "windup", phaseUntil: 750, vx: 0.001 }); expect(parse()).toBeNull();
  Object.assign(b, valid, { phase: "dash", phaseUntil: 500, vx: 0, vy: 490 }); expect(parse()).toBeNull();
  const angle = 0.70049;
  Object.assign(b, { facing: angle, vx: Math.cos(angle) * 490, vy: Math.sin(angle) * 490 }); expect(parse()).not.toBeNull();
  Object.assign(b, valid);
  s.events = [{ id: 2, tick: 1, kind: "dasher", type: "hit", x: 1200, y: 1200, points: 0 }]; expect(parse()).not.toBeNull();
  const e = s.events[0]!;
  for (const fields of [{ type: "other" }, { points: 1 }, { kind: "unknown" }]) { s.events[0] = { ...e, ...fields } as any; expect(parse()).toBeNull(); }
  s.events[0] = { ...e, type: "kill", points: 27.5 }; expect(parse()).not.toBeNull();
  s.events[0].points = 75; expect(parse()).not.toBeNull(); s.events[0].points = 75.1; expect(parse()).toBeNull();
});
test("restart packets require a finalized restart result; legacy life results remain valid", () => {
  const result = { v: 1, type: "life_over", playerId: hello.playerId, life: 1, score: 21, kills: 2, seconds: 1.1, touch: true, save: "saved", reason: "restart" };
  const parse = (result?: unknown) => parseServer(JSON.stringify({ v: 1, type: "server_restart", ...(result === undefined ? {} : { result }) }));
  expect(parse()).not.toBeNull(); expect(parse(result)).not.toBeNull(); expect(parse({ ...result, save: "failed" })).not.toBeNull();
  for (const bad of [null, { ...result, save: "pending" }, { ...result, reason: "death" }, { ...result, reason: undefined }, { ...result, score: -1 }, { ...result, score: "21" }]) expect(parse(bad)).toBeNull();
  expect(parseServer(JSON.stringify({ ...result, reason: undefined }))).not.toBeNull();
  expect(parseServer(JSON.stringify({ ...result, reason: "unknown" }))).toBeNull();
});
test("directional protocol accepts validated envelopes and full-room snapshots over 1 KiB", () => {
  expect(parseClient(JSON.stringify(hello))).toEqual(hello); expect(parseClient(JSON.stringify(input))).toEqual(input);
  const welcome: Welcome = { v: 1, type: "welcome", playerId: hello.playerId, arenaId: "room", buildId: "test", world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    constants: { stepMs: STEP_MS, playerSpeed: PLAYER_SPEED, playerRadius: PLAYER_RADIUS, maxPlayers: MAX_PLAYERS } };
  expect(parseServer(JSON.stringify(welcome))).toEqual(welcome);
  const error: ArenaError = { v: 1, type: "error", code: "name-refused", message: "Pick another." }; expect(parseServer(JSON.stringify(error))).toEqual(error);
  const arena = createArena(3);
  for (let i = 0; i < 20; i++) joinPlayer(arena, { id: crypto.randomUUID(), name: `bot-${i}`, team: "spaces" });
  const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "room", tick: 1, wave: 1, bugs: [], shots: [], events: [], players: [...arena.players.values()].map(p => ({ ...p, ackSeq: 0 })) };
  const raw = JSON.stringify(snapshot); expect(raw.length).toBeGreaterThan(1024); expect(parseServer(raw)).toEqual(snapshot); expect(parseClient(raw)).toBeNull();
  snapshot.players[0]!.name = "<script>"; expect(parseServer(JSON.stringify(snapshot))).toBeNull();
  expect(parseServer(JSON.stringify(hello))).toBeNull(); expect(parseClient(JSON.stringify(welcome))).toBeNull();
});
test("maximum full snapshot fits 64KiB and rejects corrupt combat entities/results", () => {
  const arena = createArena(2);
  for (let i = 0; i < 20; i++) joinPlayer(arena, { id: crypto.randomUUID(), name: "WideWWWWWWWWWWWW", team: "tabs" });
  const players = [...arena.players.values()].map(p => ({ ...p, heat: 17.9991, streak: 999999, points: 9999999, score: 9999999, kills: 999999, immuneUntil: 9999999, spawnProtectedUntil: 9999999, overheatUntil: 9999999, nextShotAt: 9999999, ackSeq: 99999999 }));
  const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: crypto.randomUUID(), tick: 9999999, wave: 9999, players,
    bugs: Array.from({ length: MAX_BUGS }, (_, i) => ({ id: i, kind: "dasher", hp: 2, facing: 2.356, phase: "recovery", phaseUntil: 500000950, x: 1234.56789, y: 1234.56789, vx: -24.748737, vy: 24.748737 })),
    shots: Array.from({ length: MAX_SHOTS }, (_, i) => ({ id: MAX_BUGS + i, owner: players[i % 20]!.id, life: 1, x: 1234.56789, y: 1234.56789, vx: 636.3961, vy: -636.3961, born: 499999949.12345 })),
    events: Array.from({ length: MAX_EVENTS }, (_, i) => ({ id: 1000 + i, tick: 9999999, x: 1234.56789, y: 1234.56789, points: 75, type: "kill" as const, kind: "dasher" as const })) };
  const raw = serializeSnapshot(snapshot); expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(SERVER_MESSAGE_BYTES); expect(parseServer(raw)).not.toBeNull();
  // Downed/out owners cancel their shots, while other owners can still fill
  // their per-player projectile bounds. Check every population split.
  for (const status of ["downed", "out"] as const) for (let count = 1; count <= MAX_PLAYERS; count++) {
    const split = structuredClone(snapshot);
    for (const p of split.players.slice(0, count)) {
      p.status = status; p.hits = 0;
      if (status === "downed") { p.downedUntil = split.tick * STEP_MS + 10000; p.reviveMs = 1950; p.reviving = true; }
      else p.result = { v: 1, type: "life_over", playerId: p.id, life: p.life, score: p.score, kills: p.kills, seconds: 9999999.999, touch: false, save: "pending", reason: "restart" };
    }
    split.shots = split.shots.filter(s => split.players.find(p => p.id === s.owner)!.status === "active");
    const wire = serializeSnapshot(split);
    expect(new TextEncoder().encode(wire).byteLength).toBeLessThan(SERVER_MESSAGE_BYTES); expect(parseServer(wire)).not.toBeNull();
  }
  const corrupt = JSON.parse(raw); corrupt.players[0].result = null; expect(parseServer(JSON.stringify(corrupt))).toBeNull();
  for (const value of [undefined, -1, "2000", null]) {
    const corrupt = JSON.parse(raw); corrupt.players[0].spawnProtectedUntil = value; expect(parseServer(JSON.stringify(corrupt))).toBeNull();
  }
  snapshot.bugs[0]!.vx = 1e6; expect(parseServer(serializeSnapshot(snapshot))).toBeNull(); snapshot.bugs[0]!.vx = 0;
  snapshot.shots[0]!.owner = crypto.randomUUID(); expect(parseServer(serializeSnapshot(snapshot))).toBeNull();
});
test("UTF-8 cap measures bytes: 1024 accepted, 1025 dropped, malformed and unknown counted", () => {
  const prefix = JSON.stringify({ ...input, extra: "é" });
  const bytes = new TextEncoder().encode(prefix).byteLength;
  const exact = prefix + " ".repeat(1024 - bytes), reasons: string[] = [];
  expect(parseClient(exact, r => reasons.push(r))).not.toBeNull();
  expect(parseClient(exact + " ", r => reasons.push(r))).toBeNull();
  expect(parseClient("{", r => reasons.push(r))).toBeNull();
  expect(parseClient(JSON.stringify({ ...input, v: 2 }), r => reasons.push(r))).toBeNull();
  expect(reasons).toEqual(["oversized", "malformed", "unknown"]);
});

test("snapshot life states require consistent health, deadlines, progress and terminal results", () => {
  const arena = createArena(1), p = joinPlayer(arena, { id: hello.playerId, name: "Robot", team: "tabs" })!;
  const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "room", tick: 100, wave: 1, players: [{ ...p, ackSeq: 0 }], bugs: [], shots: [], events: [] };
  const downed = { ...snapshot.players[0]!, status: "downed" as const, hits: 0, downedUntil: 15000, reviveMs: 1950, reviving: true };
  snapshot.players = [downed]; expect(parseServer(serializeSnapshot(snapshot))).not.toBeNull();
  for (const patch of [{ status: undefined }, { status: "dead" }, { hits: 1 }, { downedUntil: 5000 }, { downedUntil: 15001 }, { downedUntil: null },
    { reviveMs: -1 }, { reviveMs: 2000 }, { reviveMs: null }, { reviving: 1 }, { reviving: undefined }, { vx: 1 },
    { status: "active", hits: 1 }, { status: "out" },
    { result: { v: 1, type: "life_over", playerId: p.id, life: 1, score: 0, kills: 0, seconds: 5, touch: false, save: "pending" } }]) {
    snapshot.players = [{ ...downed, ...patch } as typeof downed]; expect(parseServer(serializeSnapshot(snapshot))).toBeNull();
  }
  snapshot.players = [{ ...downed, status: "out", reviveMs: 0, downedUntil: 0, reviving: false }];
  expect(parseServer(serializeSnapshot(snapshot))).not.toBeNull();
});
test("reject unsafe/nonfinite/schema inputs, binary and future types; name refusals reach hello handler", () => {
  for (const value of [{ ...input, seq: 0 }, { ...input, seq: Number.MAX_SAFE_INTEGER + 1 }, { ...input, aim: null }, { ...input, fire: 1 },
    { ...input, move: { x: "1", y: 0 } }, { ...input, type: "respawn", life: 0 }, { ...hello, playerId: "bad" }, { ...hello, team: "blue" }]) expect(parseClient(JSON.stringify(value))).toBeNull();
  expect(parseClient(new Uint8Array())).toBeNull();
  expect(parseClient(JSON.stringify({ ...hello, name: "<script>" }))).not.toBeNull();
});
