import { expect, test } from "bun:test";
import { openDb, hideName, startRun } from "../db";
import { RoomManager, type Transport } from "./rooms";
import { parseServer } from "../../shared/arena/protocol";
function fixture() {
  const db = openDb(":memory:"); let now = 0, cancelled = 0;
  const callbacks = new Map<any, () => void>();
  const manager = new RoomManager(db, "test", { now: () => now, seed: () => 1,
    schedule: (fn, ms) => { expect(ms).toBe(50); const timer = { unref() {} } as any; callbacks.set(timer, fn); return timer; },
    cancel: timer => { cancelled++; callbacks.delete(timer); } });
  const join = (id = crypto.randomUUID(), name = "Robot", team = "tabs") => {
    const messages: any[] = []; let buffered = 0, closed = false;
    const transport: Transport = { send: raw => messages.push(JSON.parse(raw)), close: () => { closed = true; }, getBufferedAmount: () => buffered };
    const c = manager.open(transport);
    manager.message(c, JSON.stringify({ v: 1, type: "hello", playerId: id, name, team, touch: false, buildId: "test" }));
    return { c, messages, buffer: (n: number) => { buffered = n; }, closed: () => closed };
  };
  return { db, manager, join, at: (n: number) => { now = n; }, cancelled: () => cancelled, close() { manager.stop(); db.close(); } };
}
test("rooms pack fullest first, 21st opens a new arena, departures dispose empty timers", () => {
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
  } finally { f.close(); }
});
test("latest input applies once per tick, acknowledges applied sequences, expires held movement", () => {
  const f = fixture(); try {
    const { c } = f.join(), room = c.room!, p = room.state.players.get(c.id!)!, x = p.x;
    const send = (seq: number) => f.manager.message(c, JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq, move: { x: 1, y: 0 }, aim: 0, fire: false }));
    send(1); send(3); send(2); expect(c.ackSeq).toBe(0); expect(p.x).toBe(x);
    f.at(50); f.manager.tick(room); expect(p.x).toBe(x + 9); expect(c.ackSeq).toBe(3); expect(f.manager.dropped.sequence).toBe(1);
    f.at(100); f.manager.tick(room); expect(p.x).toBe(x + 18);
    f.at(250); f.manager.tick(room); expect(p.x).toBe(x + 18); expect(p.vx).toBe(0);
  } finally { f.close(); }
});
test("room snapshots transmit the simulated wave and crawler population", () => {
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
  } finally { f.close(); }
});
test("rolling input limit includes malformed input attempts and expires exactly at 1 second", () => {
  const f = fixture(); try {
    const { c } = f.join();
    for (let i = 0; i < 30; i++) f.manager.message(c, '{"v":1,"type":"input"}');
    const input = JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 0, y: 0 }, aim: 0, fire: false });
    f.at(999); f.manager.message(c, input); expect(f.manager.dropped.rateLimited).toBe(1); expect(c.lastSeq).toBe(0);
    f.at(1000); f.manager.message(c, input); expect(c.lastSeq).toBe(1);
  } finally { f.close(); }
});
test("names, permanent identities, duplicate connection ownership and live moderation", () => {
  const f = fixture(); try {
    expect(f.join(crypto.randomUUID(), "<script>").closed()).toBe(true);
    const id = crypto.randomUUID(), first = f.join(id), duplicate = f.join(id);
    expect(duplicate.messages.at(-1).code).toBe("already-connected"); expect(f.manager.active.get(id)).toBe(first.c);
    f.manager.leave(first.c);
    expect(f.join(id, "Different").messages.at(-1).code).toBe("name-conflict");
    expect(f.join(id, "Robot", "spaces").messages.at(-1)).toMatchObject({ code: "team-conflict", team: "tabs" });
    const rejoined = f.join(id); hideName(f.db, "Robot", 0); f.manager.refreshHidden(); expect(rejoined.closed()).toBe(true); expect(f.manager.active.size).toBe(0);
    expect(f.join().messages.at(-1).code).toBe("name-hidden");
  } finally { f.close(); }
});
test("backpressure skips snapshots and evicts a persistently blocked socket", () => {
  const f = fixture(); try {
    const p = f.join(), room = p.c.room!; p.buffer(1); f.manager.tick(room); expect(f.manager.dropped.backpressure).toBe(1);
    f.at(5000); f.manager.tick(room); expect(p.closed()).toBe(true); expect(f.manager.rooms.size).toBe(0);
  } finally { f.close(); }
});
test("arena UUID casing preserves a release 1 player's fixed name and team", () => {
  const f = fixture(); try {
    const id = crypto.randomUUID(); startRun(f.db, id.toUpperCase(), "Robot", 0, "spaces");
    expect(f.join(id, "Robot", "tabs").messages.at(-1)).toMatchObject({ code: "team-conflict", team: "spaces" });
    expect(f.join(id, "Different", "spaces").messages.at(-1).code).toBe("name-conflict");
    expect(f.join(id, "Robot", "spaces").closed()).toBe(false);
    expect((f.db.query("SELECT COUNT(*) AS n FROM players").get() as any).n).toBe(1);
  } finally { f.close(); }
});
test("tick metrics use nearest-rank percentiles and expire the last minute", () => {
  const f = fixture(); try {
    expect(f.manager.stats().tick).toMatchObject({ samples: 0, p50Ms: null, p95Ms: null });
    const players = Array.from({ length: 21 }, () => f.join());
    const first = players[0]!.c.room!.metrics, second = players[20]!.c.room!.metrics;
    for (let i = 1; i <= 100; i++) (i % 2 ? first : second).add(i);
    expect(f.manager.stats().tick).toMatchObject({ samples: 100, p50Ms: 50, p95Ms: 95 });
    f.at(60000); expect(f.manager.stats().tick).toMatchObject({ samples: 0, p50Ms: null, p95Ms: null });
  } finally { f.close(); }
});
test("a delayed callback advances one fixed step; closed-room timing expires after a minute", () => {
  const f = fixture(); try {
    const { c } = f.join(), room = c.room!; f.at(1000); f.manager.tick(room);
    expect(room.state.tick).toBe(1); expect(f.manager.stats().schedulerLateness.p95Ms).toBe(950);
    f.manager.leave(c); expect(f.manager.stats().tick.samples).toBe(1);
    f.at(61000); expect(f.manager.stats().tick.samples).toBe(0);
  } finally { f.close(); }
});
