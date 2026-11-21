import { expect, test } from "bun:test";
import { parseClient, parseServer, type Hello, type InputMessage, type ArenaError, type Snapshot, type Welcome } from "./protocol";
import { createArena, joinPlayer } from "./simulation";
import { MAX_PLAYERS, PLAYER_RADIUS, PLAYER_SPEED, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
const hello: Hello = { v: 1, type: "hello", playerId: crypto.randomUUID(), name: "Robot", team: "tabs", touch: false, buildId: "test" };
const input: InputMessage = { v: 1, type: "input", seq: 1, move: { x: 1, y: 0 }, aim: 0, fire: false };
test("directional protocol accepts the five variants and full-room snapshots over 1 KiB", () => {
  expect(parseClient(JSON.stringify(hello))).toEqual(hello); expect(parseClient(JSON.stringify(input))).toEqual(input);
  const welcome: Welcome = { v: 1, type: "welcome", playerId: hello.playerId, arenaId: "room", buildId: "test", world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    constants: { stepMs: STEP_MS, playerSpeed: PLAYER_SPEED, playerRadius: PLAYER_RADIUS, maxPlayers: MAX_PLAYERS } };
  expect(parseServer(JSON.stringify(welcome))).toEqual(welcome);
  const error: ArenaError = { v: 1, type: "error", code: "name-refused", message: "Pick another." }; expect(parseServer(JSON.stringify(error))).toEqual(error);
  const arena = createArena(3);
  for (let i = 0; i < 20; i++) joinPlayer(arena, { id: crypto.randomUUID(), name: `bot-${i}`, team: "spaces" });
  const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "room", tick: 1, players: [...arena.players.values()].map(p => ({ ...p, ackSeq: 0 })) };
  const raw = JSON.stringify(snapshot); expect(raw.length).toBeGreaterThan(1024); expect(parseServer(raw)).toEqual(snapshot); expect(parseClient(raw)).toBeNull();
  snapshot.players[0]!.name = "<script>"; expect(parseServer(JSON.stringify(snapshot))).toBeNull();
  expect(parseServer(JSON.stringify(hello))).toBeNull(); expect(parseClient(JSON.stringify(welcome))).toBeNull();
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
test("reject unsafe/nonfinite/schema inputs, binary and future types; name refusals reach hello handler", () => {
  for (const value of [{ ...input, seq: 0 }, { ...input, seq: Number.MAX_SAFE_INTEGER + 1 }, { ...input, aim: null }, { ...input, fire: 1 },
    { ...input, move: { x: "1", y: 0 } }, { ...input, type: "respawn" }, { ...hello, playerId: "bad" }, { ...hello, team: "blue" }]) expect(parseClient(JSON.stringify(value))).toBeNull();
  expect(parseClient(new Uint8Array())).toBeNull();
  expect(parseClient(JSON.stringify({ ...hello, name: "<script>" }))).not.toBeNull();
});
