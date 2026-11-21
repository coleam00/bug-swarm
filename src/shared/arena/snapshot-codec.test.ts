import { expect, test } from "bun:test";
import { SnapshotEncoder, ServerDecoder } from "./snapshot-codec";
import { createArena, joinPlayer, stepArena, endLife, respawnPlayer } from "./simulation";
import { lifeDefaults } from "./types";
import { MAX_PLAYERS, MAX_BUGS, MAX_SHOTS, MAX_EVENTS, MAX_GLOBS, MAX_PICKUPS } from "./constants";
import { parseServer, serializeSnapshot, type Snapshot } from "./protocol";
import { createBug } from "./bugs/registry";
function fixture() {
  const state = createArena(77), id = crypto.randomUUID();
  joinPlayer(state, { id, name: "Pilot", team: "tabs" });
  const value = (): Snapshot => ({ pickups: state.pickups, v: 1, type: "snapshot", arenaId: "codec-test", tick: state.tick, wave: state.wave,
    players: [...state.players.values()].map(p => ({ ...p, ackSeq: state.tick })), bugs: state.bugs, shots: state.shots, globs: state.globs, events: state.events });
  return { state, id, value };
}

test("beetles and bounces survive keyframes, HP deltas, removal and skipped-base recovery", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder();
  const bug = createBug("beetle", 1, 1200, 1200); bug.facing = 0.70049;
  bug.vx = Math.cos(bug.facing) * 84; bug.vy = Math.sin(bug.facing) * 84; f.state.bugs = [bug];
  expect((decoder.read(encoder.encode(f.value()).keyframe) as Snapshot).bugs[0]!.hp).toBe(5);
  for (let hp = 5; hp >= 1; hp--) {
    f.state.tick++; bug.hp = hp;
    f.state.events = [{ id: hp + 10, tick: f.state.tick, kind: "beetle", type: "bounce", x: 1222, y: 1200, points: 0 }];
    const s = decoder.read(encoder.encode(f.value()).delta) as Snapshot;
    expect(s.bugs[0]!.hp).toBe(hp); expect(s.events[0]).toMatchObject({ kind: "beetle", type: "bounce", points: 0 });
  }
  f.state.tick++; encoder.encode(f.value()); f.state.tick++; f.state.bugs = []; f.state.events = [];
  const removed = encoder.encode(f.value()); expect(decoder.read(removed.delta)).toBeNull();
  expect((decoder.read(removed.keyframe) as Snapshot).bugs).toHaveLength(0);
});

test("compact spitter history retains swell, glob birth/travel/removal and the independent pop event", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder();
  const p = f.state.players.get(f.id)!; p.x = p.y = 1200;
  const bug = createBug("spitter", f.state.nextId++, 800, 1200); f.state.bugs = [bug];
  let swelling = false, globId = 0, previousX = 0;
  for (let i = 0; i < 46; i++) {
    stepArena(f.state, new Map());
    const decoded = decoder.read(encoder.encode(f.value()).delta) as Snapshot;
    expect(decoded.bugs[0]!.phase).toBe(bug.phase);
    expect(decoded.bugs[0]!.phaseUntil).toBe(bug.phaseUntil);
    swelling ||= decoded.bugs[0]!.phase === "swell";
    if (decoded.globs.length) {
      const g = decoded.globs[0]!; expect(g.born).toBe(2200);
      if (globId) { expect(g.id).toBe(globId); expect(g.x).toBeGreaterThan(previousX); }
      globId = g.id; previousX = g.x;
    }
  }
  expect(swelling).toBe(true); expect(globId).toBeGreaterThan(0);
  const g = f.state.globs[0]!;
  f.state.shots.push({ id: f.state.nextId++, owner: p.id, life: p.life, born: f.state.tick * 50, x: g.x + 20, y: g.y, vx: -900, vy: 0 });
  stepArena(f.state, new Map());
  const popped = decoder.read(encoder.encode(f.value()).delta) as Snapshot;
  expect(popped.globs).toHaveLength(0); expect(popped.events).toMatchObject([{ type: "glob-pop", points: 5 }]);
  expect(popped.events[0]!.kind).toBeUndefined(); expect(popped.players[0]).toMatchObject({ score: 5, kills: 0 });
});
test("compact snapshots preserve independent history, births/removals, life transitions and safe integers", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder(), p = f.state.players.get(f.id)!;
  p.score = Number.MAX_SAFE_INTEGER; p.kills = 2 ** 35; p.x = 1200.066; p.overheatUntil = Number.MAX_SAFE_INTEGER;
  f.state.bugs.push({ ...createBug("crawler", Number.MAX_SAFE_INTEGER, 400.024, 400), vx: 140 });
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
  const reference = third.keyframe.slice(); reference[3] = 65;
  expect(() => decoder.read(reference)).toThrow("Invalid string reference");
});
test("maximum supported collections, extension payloads and large ticks round trip", () => {
  const f = fixture(); f.state.players.clear(); f.state.tick = 2 ** 36;
  for (let i = 0; i < MAX_PLAYERS; i++) { const id = crypto.randomUUID(); f.state.players.set(id, { id, name: "Pilot" + i, team: "tabs", x: 1200, y: 1200, vx: 0, vy: 0, facing: Math.PI, ...lifeDefaults() }); }
  f.state.bugs = Array.from({ length: MAX_BUGS }, (_, id) => ({ ...createBug(id < 12 ? "spitter" : "dasher", id, 500, 500), phase: id < 12 ? "swell" : "windup", phaseUntil: f.state.tick * 50 + (id < 12 ? 500 : 700), tell: { time: 1.123456 } }));
  f.state.shots = Array.from({ length: MAX_SHOTS }, (_, i) => ({ id: MAX_BUGS + i, owner: [...f.state.players.keys()][i % MAX_PLAYERS]!, life: 1, x: 600, y: 600, vx: 900, vy: 0, born: 0 }));
  f.state.globs = Array.from({ length: MAX_GLOBS }, (_, i) => ({ id: 1800 + i, x: 600, y: 600, vx: Math.cos(i) * 320, vy: Math.sin(i) * 320, born: f.state.tick * 50 - 50 }));
  f.state.pickups = Array.from({ length: MAX_PICKUPS }, (_, i) => ({ id: 2000 + i, kind: (["shield", "spread", "rapid"] as const)[i % 3]!, x: 1200, y: 1200, expiresAt: f.state.tick * 50 + 12000 }));
  for (const p of f.state.players.values()) p.effects = { shield: f.state.tick * 50 + 20000, spread: f.state.tick * 50 + 8000, rapid: f.state.tick * 50 + 8000 };
  const events = Array.from({ length: MAX_EVENTS }, (_, id) => ({ id: 1000 + id, tick: f.state.tick, x: 700, y: 700, kind: "dasher" as const,
    ...(id % 2 ? { type: "hit" as const, points: 0 as const } : { type: "kill" as const, points: 27.5 }) }));
  const encoder = new SnapshotEncoder(), frame = encoder.encode(f.value()).keyframe, decoded = new ServerDecoder().read(frame) as Snapshot;
  expect(decoded.tick).toBe(2 ** 36); expect(decoded.players).toHaveLength(MAX_PLAYERS);
  expect(decoded.bugs).toHaveLength(MAX_BUGS); expect(decoded.shots).toHaveLength(MAX_SHOTS); expect(decoded.events).toHaveLength(0);
  expect((decoded.bugs[0] as any).tell).toEqual({ time: 1.123 });
  expect(decoded.bugs[0]!.phase).toBe("swell");
  expect(decoded.pickups).toEqual(f.state.pickups); expect(decoded.players[0]!.effects).toEqual(f.state.players.values().next().value!.effects);
  expect(decoded.globs).toHaveLength(MAX_GLOBS);
  expect(frame.length).toBeLessThan(65536);
  for (const impacts of [1, 60, 330, 600, MAX_EVENTS]) for (const all of [false, true]) {
    const value = f.value(); value.shots = value.shots.slice(impacts);
    value.events = events.slice(0, impacts).map((e, i) => all || i % 2 ? { id: e.id, tick: e.tick, x: e.x, y: e.y, type: "glob-pop", points: 5 } : e);
    const wire = new SnapshotEncoder().encode(value).keyframe, roundTrip = new ServerDecoder().read(wire) as Snapshot;
    expect(wire.length).toBeLessThan(65536); expect(roundTrip.events).toEqual(value.events);
  }
  // Keep the phased-spitter/dasher worst case above; also exercise all collection bounds
  // together with the new kind, all crack states and mixed combat events.
  f.state.events = events; f.state.shots = [];
  for (let i = 0; i < 10; i++) f.state.bugs[i] = { ...createBug("beetle", i, 500, 500), hp: i % 5 + 1 };
  for (let i = 0; i < MAX_EVENTS; i += 3) f.state.events[i] = { id: 1000 + i, tick: f.state.tick, x: 522, y: 500, kind: "beetle", type: "bounce", points: 0 };
  const mixed = f.value(), wire = serializeSnapshot(mixed), mixedFrame = new SnapshotEncoder().encode(mixed).keyframe;
  expect(Buffer.byteLength(wire)).toBeLessThan(65536); expect(parseServer(wire)).not.toBeNull();
  expect(mixedFrame.length).toBeLessThan(65536);
  const decodedMixed = new ServerDecoder().read(mixedFrame) as Snapshot;
  expect(decodedMixed.bugs.filter(b => b.kind === "beetle")).toHaveLength(10);
  expect(decodedMixed.events[0]!.type).toBe("bounce");
});

test("compact pickup births, collection, refresh and consumption retain authoritative effects", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder(), p = f.state.players.get(f.id)!;
  p.x = p.y = 1200;
  decoder.read(encoder.encode(f.value()).keyframe);
  f.state.pickups = (["shield", "spread", "rapid"] as const).map(kind => ({ id: f.state.nextId++, kind, x: 1200, y: 1200, expiresAt: 12000 }));
  f.state.tick++;
  expect((decoder.read(encoder.encode(f.value()).delta) as Snapshot).pickups).toEqual(f.state.pickups);
  stepArena(f.state, new Map());
  const collected = decoder.read(encoder.encode(f.value()).delta) as Snapshot;
  expect(collected.pickups).toEqual([]); expect(collected.players[0]!.effects).toEqual({ shield: 20050, spread: 8050, rapid: 8050 });
  p.effects.rapid = 8100; delete p.effects.shield; f.state.tick++;
  expect((decoder.read(encoder.encode(f.value()).delta) as Snapshot).players[0]!.effects).toEqual({ spread: 8050, rapid: 8100 });
  expect(collected.players[0]!.effects).toEqual({ shield: 20050, spread: 8050, rapid: 8050 });
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
  f.state.bugs = [1, 2].map(id => createBug("crawler", id, 500, 500));
  decoder.read(encoder.encode(f.value()).keyframe); f.state.tick++; f.state.bugs.reverse();
  const frame = encoder.encode(f.value()); expect(frame.periodic).toBe(true);
  expect((decoder.read(frame.delta) as Snapshot).bugs.map(b => b.id)).toEqual([2, 1]);
});
test("dasher committed motion remains valid at every heading and across phase transitions", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder();
  f.state.tick = 1;
  for (let angle = -Math.PI; angle <= Math.PI; angle += .013) {
    const bug = { ...createBug("dasher", 1, 1000, 1200), phase: "dash", phaseUntil: 450, facing: angle, vx: Math.cos(angle) * 490, vy: Math.sin(angle) * 490 };
    f.state.bugs = [bug];
    const decoded = decoder.read(encoder.encode(f.value()).keyframe) as Snapshot;
    expect(Math.abs(decoded.bugs[0]!.facing - angle)).toBeLessThanOrEqual(1 / 4096);
    expect(Math.abs(decoded.bugs[0]!.vx - bug.vx)).toBeLessThanOrEqual(1 / 32);
  }
  f.state.tick = 0; f.state.bugs = [{ ...createBug("dasher", 2, 1000, 1200), phase: "windup", phaseUntil: 700 }];
  const phases = new Set<string>(); decoder.reset();
  for (let i = 0; i < 65; i++) {
    if (i === 30) f.state.players.get(f.id)!.x = 2100;
    stepArena(f.state, new Map()); const value = decoder.read(encoder.encode(f.value()).delta) as Snapshot;
    phases.add(value.bugs.find(b => b.id === 2)!.phase!);
  }
  expect([...phases]).toEqual(expect.arrayContaining(["windup", "dash", "recovery", "approach"]));
});
test("optional kind fields can be removed without losing the rest of the snapshot", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), decoder = new ServerDecoder();
  f.state.bugs = [createBug("dasher", 1, 500, 500)]; decoder.read(encoder.encode(f.value()).keyframe);
  f.state.tick++; f.state.bugs = [createBug("crawler", 1, 500, 500)];
  const value = decoder.read(encoder.encode(f.value()).delta) as Snapshot;
  expect(value.bugs[0]!.phaseUntil).toBeUndefined(); expect(value.bugs[0]!.phase).toBeUndefined(); expect(value.bugs[0]!.hp).toBe(1);
});
