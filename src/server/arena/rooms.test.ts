import { expect, test } from "bun:test";
import { openDb, hideName, startRun, countEvents, getRun, teamTotals } from "../db";
import { RoomManager, type Transport } from "./rooms";
import { parseServer } from "../../shared/arena/protocol";
import { downPlayer } from "../../shared/arena/revive";
import { createBug } from "../../shared/arena/bugs/registry";
import { ServerDecoder } from "../../shared/arena/snapshot-codec";
function fixture() {
  const db = openDb(":memory:"); let now = 0, cancelled = 0;
  const callbacks = new Map<any, () => void>();
  const manager = new RoomManager(db, "test", { now: () => now, seed: () => 1,
    schedule: (fn, ms) => { expect(ms).toBe(50); const timer = { unref() {} } as any; callbacks.set(timer, fn); return timer; },
    cancel: timer => { cancelled++; callbacks.delete(timer); } });
  const join = (id = crypto.randomUUID(), name = "Robot", team = "tabs") => {
    const messages: any[] = []; let buffered = 0, closed = false;
    const transport: Transport = { send: raw => messages.push(parseServer(String(raw))), close: () => { closed = true; }, getBufferedAmount: () => buffered };
    const c = manager.open(transport);
    manager.message(c, JSON.stringify({ v: 1, type: "hello", playerId: id, name, team, touch: false, buildId: "test" }));
    return { c, messages, buffer: (n: number) => { buffered = n; }, closed: () => closed };
  };
  return { db, manager, join, at: (n: number) => { now = n; }, cancelled: () => cancelled, async close() { await manager.stop(); db.close(); } };
}

test("room broadcasts authoritative spitter phase, globs and independent pop scoring identically", async () => {
  const f = fixture(); try {
    const a = f.join(), b = f.join(), room = a.c.room!, p = room.state.players.get(a.c.id!)!;
    Object.assign(p, { x: 1200, y: 1200 }); Object.assign(room.state.players.get(b.c.id!)!, { x: 1800, y: 1800 });
    const bug = createBug("spitter", room.state.nextId++, 800, 1200); room.state.bugs = [bug];
    Object.assign(bug, { phase: "swell", phaseUntil: 100 });
    f.manager.tick(room); expect(a.messages.at(-1).bugs[0].phase).toBe("swell");
    f.manager.tick(room); const glob = room.state.globs[0]!; expect(glob.born).toBe(100);
    expect(a.messages.at(-1).globs).toEqual([glob]);
    expect(a.messages.at(-1)).toEqual(b.messages.at(-1)); expect(parseServer(JSON.stringify(a.messages.at(-1)))).not.toBeNull();
    room.state.shots.push({ id: room.state.nextId++, owner: p.id, life: p.life, born: 100, x: glob.x + 20, y: glob.y, vx: -900, vy: 0 });
    f.manager.tick(room); expect(a.messages.at(-1)).toEqual(b.messages.at(-1)); expect(a.messages.at(-1).events[0].type).toBe("glob-pop");
    expect(p.score).toBe(5); expect(p.kills).toBe(0);
  } finally { await f.close(); }
});

test("down/revive retains one run, clears held controls, rejects respawn and persists cross-team reward", async () => {
  const f = fixture(); try {
    const victim = f.join(), rescuer = f.join(crypto.randomUUID(), "Rescuer", "spaces"), room = victim.c.room!;
    const p = room.state.players.get(victim.c.id!)!, q = room.state.players.get(rescuer.c.id!)!;
    Object.assign(p, { x: 1200, y: 1200, score: 37, points: 370, streak: 7 }); Object.assign(q, { x: 1200, y: 1200 });
    const run = victim.c.record!.runId;
    victim.c.held.fire = true; downPlayer(room.state, p); f.manager.tick(room);
    expect(victim.c.held.fire).toBe(false); expect(victim.c.pending).toBeUndefined();
    f.manager.message(victim.c, JSON.stringify({ v: 1, type: "respawn", life: 1, touch: false }));
    f.manager.message(victim.c, JSON.stringify({ v: 1, type: "input", life: 1, seq: 1, touch: false, move: { x: 1, y: 0 }, aim: 0, fire: true }));
    expect(victim.c.pending).toBeUndefined(); expect(p.life).toBe(1);
    f.manager.writer.flush(); expect(countEvents(f.db)).toMatchObject({ run_started: 2, run_ended: 0 });
    for (let i = 0; i < 39; i++) f.manager.tick(room);
    expect(p.status).toBe("active"); expect(p.score).toBe(37); expect(p.streak).toBe(7); expect(q.score).toBe(50);
    expect(victim.c.record!.runId).toBe(run); expect(victim.messages.some(m => m.type === "life_over")).toBe(false);
    f.manager.writer.flush(); expect(countEvents(f.db).run_ended).toBe(0);
    f.manager.leave(rescuer.c); f.manager.writer.flush();
    expect(getRun(f.db, rescuer.c.record!.runId)).toMatchObject({ score: 50, team: "spaces", squashes: 0 });
    expect(teamTotals(f.db)).toEqual({ tabs: 0, spaces: 50 });
  } finally { await f.close(); }
});

test.each(["disconnect", "moderation", "stall", "shutdown"])("downed %s finalizes once through the writer", async reason => {
  const f = fixture(); try {
    const { c, buffer, closed } = f.join(), room = c.room!, p = room.state.players.get(c.id!)!;
    p.score = 37; downPlayer(room.state, p);
    if (reason === "disconnect") f.manager.leave(c);
    if (reason === "moderation") { hideName(f.db, p.name, 0); f.manager.refreshHidden(); }
    if (reason === "stall") { buffer(1); f.manager.tick(room); f.at(5000); f.manager.tick(room); }
    if (reason === "shutdown") await f.manager.stop();
    // Observe the trigger before cleanup can evict or finish the life for it.
    expect(c.closed).toBe(true);
    if (reason !== "disconnect") expect(closed()).toBe(true);
    expect(f.manager.active.has(p.id)).toBe(false); expect(f.manager.connections.has(c)).toBe(false);
    expect(room.members.has(c)).toBe(false); expect(room.state.players.has(p.id)).toBe(false);
    expect(f.manager.rooms.has(room.id)).toBe(false); expect(c.room).toBeUndefined();
    f.manager.writer.flush();
    expect(countEvents(f.db)).toMatchObject({ run_started: 1, run_ended: 1 });
    const saved = getRun(f.db, c.record!.runId);
    expect(saved).toMatchObject({ score: 37, end_reason: reason === "shutdown" ? "restart" : "disconnect" });
    f.manager.leave(c); await f.manager.stop();
    expect(countEvents(f.db)).toMatchObject({ run_started: 1, run_ended: 1 });
    expect(getRun(f.db, c.record!.runId)).toEqual(saved);
  } finally { await f.close(); }
});
test("rooms pack fullest first, 21st opens a new arena, departures dispose empty timers", async () => {
  const f = fixture(); try {
    const players = Array.from({ length: 21 }, () => f.join()); expect([...f.manager.rooms.values()].map(r => r.members.size)).toEqual([20, 1]);
    const first = players[0]!.c.room!; f.manager.leave(players[0]!.c); const next = f.join(); expect(next.c.room).toBe(first);
    f.manager.leave(players[20]!.c); expect(f.manager.rooms.size).toBe(1); expect(f.cancelled()).toBe(1);
    // Leave an earlier room nearly empty and a later one nearly full.
    const later = Array.from({ length: 19 }, () => f.join());
    for (const player of players.slice(1)) f.manager.leave(player.c);
    expect([...f.manager.rooms.values()].map(r => r.members.size)).toEqual([1, 19]);
    expect(f.join().c.room).toBe(later[0]!.c.room);
    expect([...f.manager.rooms.values()].map(r => r.members.size)).toEqual([1, 20]);
    f.manager.writer.flush();
    expect((f.db.query("SELECT COUNT(*) AS n FROM runs").get() as any).n).toBe(42);
    expect((f.db.query("SELECT COUNT(*) AS n FROM events WHERE type = 'run_started'").get() as any).n).toBe(42);
  } finally { await f.close(); }
});
test("latest input applies once per tick, acknowledges applied sequences, expires held movement", async () => {
  const f = fixture(); try {
    const { c } = f.join(), room = c.room!, p = room.state.players.get(c.id!)!, x = p.x;
    const send = (seq: number) => f.manager.message(c, JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq, move: { x: 1, y: 0 }, aim: 0, fire: false }));
    send(1); send(3); send(2); expect(c.ackSeq).toBe(0); expect(p.x).toBe(x);
    f.at(50); f.manager.tick(room); expect(p.x).toBe(x + 9); expect(c.ackSeq).toBe(3); expect(f.manager.dropped.sequence).toBe(1);
    f.at(100); f.manager.tick(room); expect(p.x).toBe(x + 18);
    f.at(250); f.manager.tick(room); expect(p.x).toBe(x + 18); expect(p.vx).toBe(0);
  } finally { await f.close(); }
});
test("room snapshots transmit the simulated wave and crawler population", async () => {
  const f = fixture(); try {
    const { c, messages } = f.join(), room = c.room!;
    for (const [tick, wave, count] of [[0, 1, 1], [600, 2, 1]]) {
      room.state.tick = tick!; room.state.bugs = []; room.state.spawnCredits.set(c.id!, 0.999);
      f.manager.tick(room);
      const snapshot = parseServer(JSON.stringify(messages.at(-1)));
      expect(snapshot?.type).toBe("snapshot"); if (snapshot?.type !== "snapshot") throw new Error("Missing snapshot");
      expect(snapshot.wave).toBe(wave!); expect(snapshot.bugs).toHaveLength(count!);
      expect(snapshot.bugs.map(b => b.id)).toEqual(room.state.bugs.map(b => b.id));
      for (let i = 0; i < snapshot.bugs.length; i++) {
        expect(snapshot.bugs[i]!.kind).toBe("crawler");
        expect(snapshot.bugs[i]!.x).toBeCloseTo(room.state.bugs[i]!.x, 3);
        expect(snapshot.bugs[i]!.y).toBeCloseTo(room.state.bugs[i]!.y, 3);
      }
    }
  } finally { await f.close(); }
});
test("rolling input limit includes malformed input attempts and expires exactly at 1 second", async () => {
  const f = fixture(); try {
    const { c } = f.join();
    for (let i = 0; i < 30; i++) f.manager.message(c, '{"v":1,"type":"input"}');
    const input = JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 0, y: 0 }, aim: 0, fire: false });
    f.at(999); f.manager.message(c, input); expect(f.manager.dropped.rateLimited).toBe(1); expect(c.lastSeq).toBe(0);
    f.at(1000); f.manager.message(c, input); expect(c.lastSeq).toBe(1);
  } finally { await f.close(); }
});
test("names, permanent identities, duplicate connection ownership and live moderation", async () => {
  const f = fixture(); try {
    expect(f.join(crypto.randomUUID(), "<script>").closed()).toBe(true);
    const id = crypto.randomUUID(), first = f.join(id), duplicate = f.join(id);
    expect(duplicate.messages.at(-1).code).toBe("already-connected"); expect(f.manager.active.get(id)).toBe(first.c);
    f.manager.leave(first.c);
    expect(f.join(id, "Different").messages.at(-1).code).toBe("name-conflict");
    expect(f.join(id, "Robot", "spaces").messages.at(-1)).toMatchObject({ code: "team-conflict", team: "tabs" });
    const rejoined = f.join(id); hideName(f.db, "Robot", 0); f.manager.refreshHidden(); expect(rejoined.closed()).toBe(true); expect(f.manager.active.size).toBe(0);
    expect(f.join().messages.at(-1).code).toBe("name-hidden");
  } finally { await f.close(); }
});
test("backpressure skips snapshots and evicts a persistently blocked socket", async () => {
  const f = fixture(); try {
    const p = f.join(), room = p.c.room!; p.buffer(1); f.manager.tick(room); expect(f.manager.dropped.backpressure).toBe(1);
    f.at(5000); f.manager.tick(room); expect(p.closed()).toBe(true); expect(f.manager.rooms.size).toBe(0);
  } finally { await f.close(); }
});
test("arena UUID casing preserves a release 1 player's fixed name and team", async () => {
  const f = fixture(); try {
    const id = crypto.randomUUID(); startRun(f.db, id.toUpperCase(), "Robot", 0, "spaces");
    expect(f.join(id, "Robot", "tabs").messages.at(-1)).toMatchObject({ code: "team-conflict", team: "spaces" });
    expect(f.join(id, "Different", "spaces").messages.at(-1).code).toBe("name-conflict");
    expect(f.join(id, "Robot", "spaces").closed()).toBe(false);
    expect((f.db.query("SELECT COUNT(*) AS n FROM players").get() as any).n).toBe(1);
  } finally { await f.close(); }
});
test("tick metrics use nearest-rank percentiles and expire the last minute", async () => {
  const f = fixture(); try {
    expect(f.manager.stats().tick).toMatchObject({ samples: 0, p50Ms: null, p95Ms: null });
    const players = Array.from({ length: 21 }, () => f.join());
    const first = players[0]!.c.room!.metrics, second = players[20]!.c.room!.metrics;
    for (let i = 1; i <= 100; i++) (i % 2 ? first : second).add(i);
    expect(f.manager.stats().tick).toMatchObject({ samples: 100, p50Ms: 50, p95Ms: 95 });
    f.at(60000); expect(f.manager.stats().tick).toMatchObject({ samples: 0, p50Ms: null, p95Ms: null });
  } finally { await f.close(); }
});
test("a delayed callback advances one fixed step; closed-room timing expires after a minute", async () => {
  const f = fixture(); try {
    const { c } = f.join(), room = c.room!; f.at(1000); f.manager.tick(room);
    expect(room.state.tick).toBe(1); expect(f.manager.stats().schedulerLateness.p95Ms).toBe(950);
    f.manager.leave(c); expect(f.manager.stats().tick.samples).toBe(1);
    f.at(61000); expect(f.manager.stats().tick.samples).toBe(0);
  } finally { await f.close(); }
});


test("shared deltas recover independently after skipped/rejected sends and preserve queued terminal messages", async () => {
  const db = openDb(":memory:"); let now = 0;
  const manager = new RoomManager(db, "test", { now: () => now, seed: () => 1, schedule: () => ({ unref() {} }) as any, cancel() {} });
  const add = () => {
    const decoder = new ServerDecoder(), decoded: any[] = [], frames: Uint8Array[] = [];
    let buffer = 0, result = 1;
    const c = manager.open({ getBufferedAmount: () => buffer, close() {}, send(data) {
      if (data instanceof Uint8Array) { frames.push(data); if (!result) return 0; }
      const value = decoder.read(data); if (value) decoded.push(value); return result;
    } });
    manager.message(c, JSON.stringify({ v: 1, type: "hello", playerId: crypto.randomUUID(), name: "CodecPilot", team: "tabs", touch: false, buildId: "test", snapshotEncoding: "delta-v1" }));
    return { c, decoded, frames, buffer(n: number) { buffer = n; }, result(n: number) { result = n; } };
  };
  try {
    const a = add(), b = add(), room = a.c.room!;
    now = 50; manager.tick(room);
    expect(a.frames.at(-1)).toBe(b.frames.at(-1)); expect(a.frames.at(-1)![2]).toBe(1);
    b.buffer(1); now = 100; manager.tick(room);
    expect(a.c.snapshotTick).toBe(2); expect(b.c.snapshotTick).toBeUndefined();
    b.buffer(0); now = 150; manager.tick(room);
    expect(a.frames.at(-1)![2]).toBe(1); expect(b.frames.at(-1)![2]).toBe(0);
    b.result(0); now = 200; manager.tick(room); expect(b.c.snapshotTick).toBeUndefined();
    b.result(-1); now = 250; manager.tick(room); expect(b.frames.at(-1)![2]).toBe(0);
    expect(b.c.snapshotTick).toBe(5);
    const p = room.state.players.get(b.c.id!)!; p.status = "downed"; p.hits = 0; p.downedUntil = 300; p.spawnProtectedUntil = 0;
    now = 300; manager.tick(room); manager.writer.flush();
    expect(b.decoded.some(m => m.type === "life_over" && m.save === "saved")).toBe(true);
    now = 350; manager.leave(b.c);
    now = 400; const report = manager.stats({ sinceMs: 50, untilMs: 350, raw: true }).window!;
    expect(report.complete).toBe(true); expect(report.traffic.skipped).toBe(1); expect(report.traffic.rejected).toBe(1);
    expect(report.traffic.queued).toBeGreaterThan(0);
    expect(report.snapshotBytes.keyframe!.samples).toBeGreaterThan(0);
    manager.leave(a.c); now = 500;
    expect(manager.stats({ sinceMs: 50, untilMs: 350 }).window!.arenas[0]!.tick.samples).toBe(6);
    now = 181000; expect(manager.stats({ sinceMs: 50, untilMs: 350 }).window!.complete).toBe(false);
  } finally { await manager.stop(); db.close(); }
});
test("a room closed before its first tick retains snapshot/traffic evidence for 180 seconds", async () => {
  const f = fixture(); try {
    const { c } = f.join(), id = c.room!.id; f.at(50); f.manager.leave(c); f.at(100);
    const window = f.manager.stats({ sinceMs: 0, untilMs: 100 }).window!;
    expect(window.complete).toBe(true); expect(window.arenas.map(a => a.id)).toContain(id);
    expect(window.arenas[0]!.population.max).toBe(1); expect(window.tick.samples).toBe(0);
    expect(window.snapshotBytes.json.samples).toBe(1); expect(window.traffic.bytesOut).toBeGreaterThan(0);
    f.at(180100); expect(f.manager.stats({ sinceMs: 0, untilMs: 100 }).window!.complete).toBe(false);
  } finally { await f.close(); }
});
