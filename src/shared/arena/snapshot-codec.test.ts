import { expect, test } from "bun:test";
import { SnapshotEncoder, ServerDecoder } from "./snapshot-codec";
import { createArena, joinPlayer, stepArena, endLife, respawnPlayer } from "./simulation";
import { lifeDefaults } from "./types";
import { MAX_PLAYERS, MAX_BUGS, MAX_SHOTS, MAX_EVENTS } from "./constants";
import type { Snapshot } from "./protocol";
function fixture() {
  const state = createArena(77), id = crypto.randomUUID();
  joinPlayer(state, { id, name: "Pilot", team: "tabs" });
  const value = (): Snapshot => ({ v: 1, type: "snapshot", arenaId: "codec-test", tick: state.tick, wave: state.wave,
    players: [...state.players.values()].map(p => ({ ...p, ackSeq: state.tick })), bugs: state.bugs, shots: state.shots, events: state.events });
  return { state, id, value };
}
test("compact snapshots preserve independent history, births/removals, life transitions and safe integers", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder(), p = f.state.players.get(f.id)!;
  p.score = Number.MAX_SAFE_INTEGER; p.kills = 2 ** 35; p.x = 1200.066; p.overheatUntil = Number.MAX_SAFE_INTEGER;
  f.state.bugs.push({ id: Number.MAX_SAFE_INTEGER, kind: "crawler", x: 400.024, y: 400, vx: 140, vy: 0 });
  const first = decoder.read(encoder.encode(f.value()).keyframe) as Snapshot;
  expect(first.players[0]!.score).toBe(Number.MAX_SAFE_INTEGER); expect(first.players[0]!.kills).toBe(2 ** 35);
  expect(Math.abs(first.players[0]!.x - p.x)).toBeLessThanOrEqual(1 / 16);
  expect(first.bugs[0]!.id).toBe(Number.MAX_SAFE_INTEGER);
  const history = JSON.stringify(first);
  p.x += 10; p.score--; p.overheatUntil--; f.state.bugs = []; f.state.tick++;
  const second = decoder.read(encoder.encode(f.value()).delta) as Snapshot;
  expect(second.players[0]!.score).toBe(Number.MAX_SAFE_INTEGER - 1); expect(second.bugs).toHaveLength(0);
  expect(second.players[0]!.overheatUntil).toBe(Number.MAX_SAFE_INTEGER - 1);
  expect(JSON.stringify(first)).toBe(history);
  p.status = "downed"; p.hits = 0; p.downedUntil = 10050; p.vx = p.vy = 0; f.state.tick++;
  expect((decoder.read(encoder.encode(f.value()).delta) as Snapshot).players[0]!.status).toBe("downed");
  Object.assign(p, { status: "active", hits: 1, downedUntil: 0 }); f.state.tick++;
  expect((decoder.read(encoder.encode(f.value()).delta) as Snapshot).players[0]!.hits).toBe(1);
  const result = endLife(f.state, f.id)!; f.state.tick++;
  const out = f.value(); out.players[0]!.result = { v: 1, type: "life_over", ...result, save: "pending" };
  const pending = decoder.read(encoder.encode(out).delta) as Snapshot;
  out.tick++; out.players[0]!.result!.save = "saved";
  expect((decoder.read(encoder.encode(out).delta) as Snapshot).players[0]!.result!.save).toBe("saved");
  expect(pending.players[0]!.result!.save).toBe("pending");
  respawnPlayer(f.state, f.id, 1); f.state.tick = out.tick + 1;
  expect((decoder.read(encoder.encode(f.value()).delta) as Snapshot).players[0]!.life).toBe(2);
});
test("missing/damaged bases do not mutate state; keyframes and reconnect reset recover", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder();
  const first = encoder.encode(f.value()); decoder.read(first.keyframe);
  f.state.tick++; f.state.players.get(f.id)!.x += 1; encoder.encode(f.value());
  f.state.tick++; const third = encoder.encode(f.value());
  expect(decoder.read(third.delta)).toBeNull(); expect(decoder.missingBases).toBe(1);
  expect((decoder.read(third.keyframe) as Snapshot).tick).toBe(2);
  decoder.reset(); expect(decoder.read(third.delta)).toBeNull();
  expect((decoder.read(third.keyframe) as Snapshot).tick).toBe(2);
  for (let i = 0; i < third.keyframe.length; i++) expect(() => new ServerDecoder().read(third.keyframe.slice(0, i))).toThrow();
  const trailing = new Uint8Array(third.keyframe.length + 1); trailing.set(third.keyframe);
  expect(() => decoder.read(trailing)).toThrow("Trailing");
  expect(() => decoder.read(new Uint8Array(65537))).toThrow();
  const corrupt = third.keyframe.slice(); corrupt[1] = 2; expect(() => decoder.read(corrupt)).toThrow();
});
test("maximum supported collections, extension payloads and large ticks round trip", () => {
  const f = fixture(); f.state.players.clear(); f.state.tick = 2 ** 36;
  for (let i = 0; i < MAX_PLAYERS; i++) { const id = crypto.randomUUID(); f.state.players.set(id, { id, name: "Pilot" + i, team: "tabs", x: 1200, y: 1200, vx: 0, vy: 0, facing: Math.PI, ...lifeDefaults() }); }
  f.state.bugs = Array.from({ length: MAX_BUGS }, (_, id) => ({ id, kind: "crawler", x: 500, y: 500, vx: 140, vy: 0, tell: { time: 1.123456 } } as const));
  f.state.shots = Array.from({ length: MAX_SHOTS }, (_, i) => ({ id: MAX_BUGS + i, owner: [...f.state.players.keys()][i % MAX_PLAYERS]!, life: 1, x: 600, y: 600, vx: 900, vy: 0, born: 0 }));
  f.state.events = Array.from({ length: MAX_EVENTS }, (_, id) => ({ id, tick: f.state.tick, x: 700, y: 700, points: 10 }));
  const encoder = new SnapshotEncoder(), frame = encoder.encode(f.value()).keyframe, decoded = new ServerDecoder().read(frame) as Snapshot;
  expect(decoded.tick).toBe(2 ** 36); expect(decoded.players).toHaveLength(MAX_PLAYERS);
  expect(decoded.bugs).toHaveLength(MAX_BUGS); expect(decoded.shots).toHaveLength(MAX_SHOTS); expect(decoded.events).toHaveLength(MAX_EVENTS);
  expect((decoded.bugs[0] as any).tell).toEqual({ time: 1.123 });
  expect(frame.length).toBeLessThan(65536);
});
test("seeded full room combat survives hundreds of deltas without losing events or acknowledgements", () => {
  const f = fixture(); for (let i = 1; i < 20; i++) joinPlayer(f.state, { id: crypto.randomUUID(), name: "Pilot" + i, team: "spaces" });
  const encoder = new SnapshotEncoder(), decoder = new ServerDecoder();
  for (let i = 0; i < 450; i++) {
    stepArena(f.state, new Map([...f.state.players.keys()].map((id, n) => [id, { move: { x: Math.cos(i / 10 + n), y: Math.sin(i / 10 + n) }, aim: i / 10, fire: true }])));
    const value = f.value(), frames = encoder.encode(value), decoded = decoder.read(frames.delta) as Snapshot;
    expect(decoded.tick).toBe(value.tick); expect(decoded.events.map(e => e.id)).toEqual(value.events.map(e => e.id));
    expect(decoded.shots.map(e => e.id)).toEqual(value.shots.map(e => e.id)); expect(decoded.bugs.map(e => e.id)).toEqual(value.bugs.map(e => e.id));
    expect(decoded.players[0]!.ackSeq).toBe(value.tick);
  }
});
test("entity reordering falls back to a keyframe and retains policy observation order", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder();
  f.state.bugs = [1, 2].map(id => ({ id, kind: "crawler", x: 500, y: 500, vx: 0, vy: 0 }));
  decoder.read(encoder.encode(f.value()).keyframe); f.state.tick++; f.state.bugs.reverse();
  const frame = encoder.encode(f.value()); expect(frame.periodic).toBe(true);
  expect((decoder.read(frame.delta) as Snapshot).bugs.map(b => b.id)).toEqual([2, 1]);
});
