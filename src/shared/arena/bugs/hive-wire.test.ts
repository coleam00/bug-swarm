import { expect, test } from "bun:test";
import { createArena, joinPlayer } from "../simulation";
import { spawnHive } from "./hive";
import { parseServer, serializeSnapshot, type Snapshot } from "../protocol";
import { ServerDecoder, SnapshotEncoder } from "../snapshot-codec";

test("hive fields, ring source and reward payload round trip in both JSON paths and binary extensions", () => {
  const s = createArena(84), p = joinPlayer(s, { id: crypto.randomUUID(), name: "Pilot", team: "tabs" })!;
  spawnHive(s, 0);
  const value: Snapshot = { v: 1, type: "snapshot", arenaId: "hive", tick: 1, wave: 5, players: [{ ...p, ackSeq: 0 }], bugs: s.bugs, shots: [], globs: [{ id: 2, x: 1200, y: 1200, vx: 180, vy: 0, born: 0, source: "hive" }], events: [] };
  const readAll = (v: Snapshot) => {
    const json = serializeSnapshot(v);
    expect(parseServer(JSON.stringify(v))).toMatchObject(v);
    expect(parseServer(json)).toMatchObject(v); expect(new ServerDecoder().read(json)).toMatchObject(v);
    expect(new ServerDecoder().read(new SnapshotEncoder().encode(v).keyframe)).toMatchObject(v);
  };
  readAll(value);
  value.bugs[0]!.phase = "arrival"; value.bugs[0]!.phaseUntil = 2000; readAll(value);
  const original = structuredClone(value);
  for (const fields of [{ maxHp: undefined }, { maxHp: 181 }, { maxHp: 120 }, { hp: 181 }, { phase: "weird" }, { phaseUntil: 50 }, { phaseUntil: 2051 }, { vx: 1 }]) {
    const bad = structuredClone(original); Object.assign(bad.bugs[0]!, fields); expect(parseServer(serializeSnapshot(bad))).toBeNull();
  }
  const duplicate = structuredClone(original); duplicate.bugs.push({ ...duplicate.bugs[0]!, id: 9 }); expect(parseServer(serializeSnapshot(duplicate))).toBeNull();
  for (const fields of [{ source: undefined }, { source: "spitter" }, { source: "hive", vx: 320 }]) {
    const bad = structuredClone(original); Object.assign(bad.globs[0]!, fields); expect(parseServer(serializeSnapshot(bad))).toBeNull();
  }
  value.bugs = []; value.events = [{ id: 3, tick: 1, type: "kill", kind: "hive", x: 1200, y: 1200, points: 0, rewards: [{ playerId: p.id, life: 1, amount: 350, x: 1200, y: 1200 }] }]; readAll(value);
  const reward = (value.events[0] as Extract<typeof value.events[number], { type: "kill" }>).rewards![0]!;
  for (const fields of [{ amount: 349 }, { amount: 351 }, { amount: 350.5 }, { life: 2 }, { playerId: crypto.randomUUID() }, { x: -1 }]) {
    const bad = structuredClone(value); (bad.events[0] as any).rewards = [{ ...reward, ...fields }]; expect(parseServer(serializeSnapshot(bad))).toBeNull();
  }
  for (const rewards of [undefined, [], [reward, reward]]) { const bad = structuredClone(value); (bad.events[0] as any).rewards = rewards; expect(parseServer(serializeSnapshot(bad))).toBeNull(); }
  // An award may be followed by a terminal contact in the same tick.
  value.players[0]!.status = "out"; value.players[0]!.hits = 0; readAll(value);
});
