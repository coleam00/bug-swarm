import { expect, test } from "bun:test";
import { CdpSnapshots } from "./cdp-snapshots";
import { SnapshotEncoder } from "../src/shared/arena/snapshot-codec";
import { lifeDefaults } from "../src/shared/arena/types";
import type { Snapshot, Welcome } from "../src/shared/arena/protocol";

test("CDP decodes JSON controls and base64 keyframes/deltas independently across sockets and reconnects", () => {
  const frames = new CdpSnapshots(), encoder = new SnapshotEncoder(), id = crypto.randomUUID();
  const welcome: Welcome = { v: 1, type: "welcome", playerId: id, arenaId: "cdp", buildId: "test", snapshotEncoding: "delta-v1",
    world: { width: 2400, height: 2400 }, constants: { stepMs: 50, playerSpeed: 180, playerRadius: 14, maxPlayers: 20 } };
  const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "cdp", tick: 0, wave: 1, bugs: [], shots: [], events: [],
    players: [{ ...lifeDefaults(), id, name: "Pilot", team: "tabs", x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 0 }] };
  const binary = (bytes: Uint8Array) => ({ opcode: 2, payloadData: Buffer.from(bytes).toString("base64") });
  frames.created("first"); frames.created("second");
  expect(frames.read("first", { opcode: 1, payloadData: JSON.stringify(welcome) })).toEqual(welcome);
  const initial = encoder.encode(snapshot);
  expect(frames.read("first", binary(initial.keyframe))).toMatchObject({ tick: 0 });
  snapshot.tick = 1; snapshot.players[0]!.x = 1210;
  const next = encoder.encode(snapshot);
  expect(frames.read("first", binary(next.delta))).toMatchObject({ tick: 1, players: [{ x: 1210 }] });
  expect(() => frames.read("second", binary(next.delta))).toThrow();
  snapshot.tick = 2; const future = encoder.encode(snapshot);
  frames.created("first");
  expect(() => frames.read("first", binary(future.delta))).toThrow();
  expect(frames.read("first", binary(next.keyframe))).toMatchObject({ tick: 1 });
  frames.closed("first");
  expect(frames.read("first", binary(next.keyframe))).toBeNull();
  frames.created("first"); // Reusing even the same CDP id must not retain a base.
  expect(() => frames.read("first", binary(future.delta))).toThrow();
  expect(frames.read("first", binary(future.keyframe))).toMatchObject({ tick: 2 });
  expect(frames.read("second", { opcode: 1, payloadData: JSON.stringify(snapshot) })).toEqual(snapshot);
  expect(frames.read("first", { opcode: 8, payloadData: "" })).toBeNull();
  expect(() => frames.read("first", binary(new Uint8Array([1, 2, 3])))).toThrow();
});
