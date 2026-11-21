import { expect, test, spyOn } from "bun:test";
import { openDb, registerArenaPlayer, getRun, countEvents, finishRun } from "../db";
import { createApp } from "../app";
import { LifeWriter, finishArenaLife, startArenaLife, type LifeRecord } from "./lives";
import { RoomManager } from "./rooms";
import { endLife } from "../../shared/arena/simulation";
import { report } from "../../../scripts/stats";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("shutdown freezes all rooms, rejects admission/respawn, commits once before restart notices and survives a close during drain", async () => {
  const db = openDb(":memory:"), manager = new RoomManager(db, "build", { seed: () => 1 });
  const clients = Array.from({ length: 22 }, (_, i) => {
    const messages: any[] = [], order: string[] = [];
    const c = manager.open({ send: raw => { const m = JSON.parse(raw); messages.push(m); order.push(`${m.type}:${m.save ?? ""}`); },
      close: code => { order.push(`close:${code}`); }, getBufferedAmount: () => 0 });
    manager.message(c, JSON.stringify({ v: 1, type: "hello", playerId: crypto.randomUUID(), name: `Pilot-${i}`, team: i % 2 ? "tabs" : "spaces", touch: true, buildId: "build" }));
    const p = c.room!.state.players.get(c.id!)!; p.score = 100 + i; p.kills = 8; p.startedTick = 0; c.room!.state.tick = 123;
    return { c, messages, order, expected: { score: 100 + i, squashes: 8, seconds: 6, touch: 1, team: p.team, held: 0 } };
  });
  try {
    const dead = clients[0]!.c, result = endLife(dead.room!.state, dead.id!)!;
    // Normal death was queued before restart and must keep its original reason.
    (manager as any).finishLife(dead, result);
    const stopping = manager.stop(), repeated = manager.stop(); expect(manager.accepting).toBe(false);
    manager.message(dead, JSON.stringify({ v: 1, type: "respawn", life: 1, touch: false }));
    manager.leave(clients[20]!.c);
    const refused: any[] = []; manager.open({ send: raw => refused.push(JSON.parse(raw)), close() {}, getBufferedAmount: () => 0 });
    expect(refused.at(-1).code).toBe("restarting"); expect(await stopping).toBe(true); expect(await repeated).toBe(true);
    const rows = db.query("SELECT * FROM runs").all() as any[];
    expect(rows).toHaveLength(22); expect(rows.filter(r => r.end_reason === "restart")).toHaveLength(21);
    for (const { c, messages, order, expected } of clients) {
      const row = getRun(db, c.record!.runId)!;
      expect(row).toMatchObject(expected);
      if (c === clients[20]!.c) continue;
      const restart = messages.find(m => m.type === "server_restart");
      expect(restart).toBeDefined();
      if (c === dead) expect(restart.result).toBeUndefined();
      else expect(restart.result).toMatchObject({ reason: "restart", save: "saved", score: expected.score });
      expect(order.indexOf("server_restart:")).toBeLessThan(order.indexOf("close:1012"));
      expect(order.indexOf("life_over:saved")).toBeLessThan(order.indexOf("server_restart:"));
    }
    expect(countEvents(db)).toMatchObject({ run_started: 22, run_ended: 22 });
    finishArenaLife(db, { ...dead.record!, reason: "restart", result: { ...dead.record!.result!, score: 999 } });
    expect(getRun(db, dead.record!.runId)).toMatchObject({ end_reason: "death", score: 100 });
  } finally { await manager.stop(); db.close(); }
});

test("drain retries a lock without blocking the event loop, restores ordinary timeout and expires at its deadline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "life-lock-")), db = openDb(join(dir, "app.db")), lock = new Database(join(dir, "app.db"));
  const log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const id = crypto.randomUUID(); registerArenaPlayer(db, id, "Pilot", "tabs");
    const make = (): LifeRecord => ({ runId: crypto.randomUUID(), playerId: id, team: "tabs", started: 0, ended: 1000, reason: "restart", result: { playerId: id, life: 1, score: 9, kills: 0, seconds: 1, touch: false } });
    const writer = new LifeWriter(db), record = make();
    lock.exec("BEGIN IMMEDIATE"); writer.enqueue(record); const start = performance.now(); writer.flush();
    expect(performance.now() - start).toBeLessThan(200); expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    const release = setTimeout(() => lock.exec("ROLLBACK"), 40);
    try { expect(await writer.drain(performance.now() + 1000)).toBe(true); } finally { clearTimeout(release); }
    expect(getRun(db, record.runId)).toMatchObject({ score: 9, end_reason: "restart" });
    lock.exec("BEGIN IMMEDIATE"); const lost = make(), notices: boolean[] = []; writer.enqueue(lost, ok => notices.push(ok));
    const deadline = performance.now() + 60; expect(await writer.drain(deadline)).toBe(false);
    expect(performance.now() - deadline).toBeLessThan(150); expect(notices).toEqual([false]); expect(getRun(db, lost.runId)).toBeNull();
    lock.exec("ROLLBACK"); expect(log).toHaveBeenCalled();
  } finally { log.mockRestore(); lock.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("permanent failures report failed restart results; throwing notification callbacks cannot change a committed save", async () => {
  const db = openDb(":memory:"), manager = new RoomManager(db, "test"), log = spyOn(console, "error").mockImplementation(() => {});
  const messages: any[] = [];
  try {
    const c = manager.open({ send: raw => { const m = JSON.parse(raw); messages.push(m); if (m.type === "life_over") throw Error("transport"); }, close() { throw Error("close"); }, getBufferedAmount: () => 0 });
    manager.message(c, JSON.stringify({ v: 1, type: "hello", playerId: crypto.randomUUID(), name: "Pilot", team: "tabs", touch: false, buildId: "test" }));
    db.exec("CREATE TRIGGER fail_end BEFORE INSERT ON events WHEN NEW.type = 'run_ended' BEGIN SELECT RAISE(FAIL, 'offline'); END;");
    expect(await manager.stop()).toBe(false); expect(messages.at(-1)).toMatchObject({ type: "server_restart", result: { save: "failed", reason: "restart" } });
    expect(getRun(db, c.record!.runId)).toBeNull(); db.exec("DROP TRIGGER fail_end;");
    const writer = new LifeWriter(db); writer.enqueue(c.record!, () => { throw Error("notify"); });
    expect(await writer.drain(performance.now() + 100)).toBe(true); expect(getRun(db, c.record!.runId)!.score).toBe(0);
    writer.enqueue({ ...c.record!, runId: crypto.randomUUID() }); expect(await writer.drain(performance.now() - 1)).toBe(false);
    expect(countEvents(db).run_ended).toBe(1);
  } finally { await manager.stop(); log.mockRestore(); db.close(); }
});
test("trusted lives are atomic, idempotent, eligible above 3000 and cannot be finished through HTTP", async () => {
  const db = openDb(":memory:"), id = crypto.randomUUID().toUpperCase();
  try {
    registerArenaPlayer(db, id, "Pilot", "tabs");
    const stored = (db.query("SELECT id FROM players").get() as any).id;
    const record: LifeRecord = { runId: crypto.randomUUID(), playerId: stored, team: "tabs", started: 10,
      ended: 180010, result: { playerId: id.toLowerCase(), life: 1, score: 9001, kills: 400, seconds: 180.95, touch: true } };
    startArenaLife(db, record); startArenaLife(db, record);
    const app = createApp(db), finish = { playerId: stored, score: 0, squashes: 0, seconds: 0, touch: false, upgrades: [] };
    const request = () => app.request(`/api/runs/${record.runId}/finish`, { method: "POST", body: JSON.stringify(finish), headers: { "Content-Type": "application/json" } });
    expect((await request()).status).toBe(403); expect(finishRun(db, record.runId, finish, 20)).toBeNull();
    finishArenaLife(db, record); finishArenaLife(db, record); expect((await request()).status).toBe(403);
    expect(getRun(db, record.runId)).toMatchObject({ mode: "arena", score: 9001, held: 0, touch: 1, seconds: 180, squashes: 400 });
    expect(countEvents(db)).toMatchObject({ run_started: 1, run_ended: 1 });
    const second = { ...record, runId: crypto.randomUUID(), result: { ...record.result!, life: 2, touch: false } }; finishArenaLife(db, second);
    expect(report(db)).toContain("finished_runs: 2\nmedian_runs_per_player: 2.0\ntouch_share: 50%");
    expect((await (await app.request("/api/leaderboard")).json() as any)[0].score).toBe(9001);
  } finally { db.close(); }
});
test("failed start rolls back; finish recovers metadata; cache failure does not turn committed save into failure", () => {
  const db = openDb(":memory:"), log = spyOn(console, "error").mockImplementation(() => {});
  try {
    const playerId = crypto.randomUUID(); registerArenaPlayer(db, playerId, "Pilot", "spaces");
    const record: LifeRecord = { runId: crypto.randomUUID(), playerId, team: "spaces", started: 0 };
    db.exec("CREATE TRIGGER fail_start BEFORE INSERT ON events WHEN NEW.type = 'run_started' BEGIN SELECT RAISE(FAIL, 'offline'); END;");
    expect(() => startArenaLife(db, record)).toThrow(); expect(getRun(db, record.runId)).toBeNull(); expect(countEvents(db).run_started).toBe(0);
    const notices: boolean[] = [], writer = new LifeWriter(db, () => { throw new Error("cache"); });
    writer.enqueue(record); writer.flush(); expect(log).toHaveBeenCalled();
    db.exec("DROP TRIGGER fail_start;");
    const ended = { ...record, ended: 1000, result: { playerId, life: 1, score: 11, kills: 1, seconds: 1, touch: false } };
    db.exec("CREATE TRIGGER fail_end BEFORE INSERT ON events WHEN NEW.type = 'run_ended' BEGIN SELECT RAISE(FAIL, 'offline'); END;");
    writer.enqueue(ended, ok => notices.push(ok)); writer.flush(); expect(notices).toEqual([false]); expect(getRun(db, record.runId)).toBeNull();
    db.exec("DROP TRIGGER fail_end;"); writer.stop();
    expect(notices).toEqual([false, true]); expect(countEvents(db)).toMatchObject({ run_started: 1, run_ended: 1 });
  } finally { log.mockRestore(); db.close(); }
});
test("death, stale inputs, duplicate respawns, touch, disconnect and repeated shutdown save each life once", async () => {
  const db = openDb(":memory:"), manager = new RoomManager(db, "test", { seed: () => 1, wallNow: () => 1000 });
  const messages: any[] = [], c = manager.open({ send: s => messages.push(JSON.parse(s)), close() {}, getBufferedAmount: () => 0 }), id = crypto.randomUUID();
  const send = (m: object) => manager.message(c, JSON.stringify({ v: 1, ...m }));
  try {
    send({ type: "hello", playerId: id, name: "Pilot", team: "tabs", touch: false, buildId: "test" });
    const room = c.room!, p = room.state.players.get(id)!;
    for (let i = 0; i < 25; i++) manager.tick(room);
    send({ type: "input", life: 1, touch: true, seq: 1, move: { x: 0, y: 0 }, aim: 0, fire: true });
    p.hits = 1; p.immuneUntil = 0; room.state.bugs.push({ id: 99, kind: "crawler", x: p.x, y: p.y, vx: 0, vy: 0 });
    manager.tick(room); expect(p.hits).toBe(0); expect(messages.filter(m => m.type === "life_over")).toHaveLength(1);
    manager.writer.flush(); expect(messages.at(-1)).toMatchObject({ type: "life_over", save: "saved", touch: true, seconds: 1.3 });
    expect(getRun(db, c.record!.runId)!.seconds).toBe(1);
    send({ type: "respawn", life: 1, touch: true }); send({ type: "respawn", life: 1, touch: false }); expect(p.life).toBe(2);
    send({ type: "input", life: 1, touch: false, seq: 10, move: { x: 1, y: 0 }, aim: 0, fire: true }); expect(c.pending).toBeUndefined();
    expect(c.held.fire).toBe(false); expect(p.score).toBe(0); expect(p.touch).toBe(true);
    manager.leave(c); manager.leave(c); await manager.stop(); await manager.stop();
    expect(countEvents(db)).toMatchObject({ run_started: 2, run_ended: 2 });
    expect((db.query("SELECT COUNT(*) AS n FROM runs WHERE touch = 1").get() as any).n).toBe(2);
    expect(endLife(room.state, id)).toBeNull();
  } finally { await manager.stop(); db.close(); }
});

test("the score in pending and saved life_over is the literal score persisted by the real writer", async () => {
  const db = openDb(":memory:"), manager = new RoomManager(db, "test", { seed: () => 1 });
  const messages: any[] = [], c = manager.open({ send: s => messages.push(JSON.parse(s)), close() {}, getBufferedAmount: () => 0 });
  const id = crypto.randomUUID();
  try {
    manager.message(c, JSON.stringify({ v: 1, type: "hello", playerId: id, name: "Pilot", team: "tabs", touch: false, buildId: "test" }));
    const p = c.room!.state.players.get(id)!;
    p.score = 37; p.points = 370; p.kills = 3; p.hits = 1; p.immuneUntil = 0; p.spawnProtectedUntil = 0;
    c.room!.state.bugs.push({ id: 99, kind: "crawler", x: p.x, y: p.y, vx: 0, vy: 0 });
    manager.tick(c.room!);
    const pending = messages.find(m => m.type === "life_over" && m.save === "pending");
    expect(pending?.score).toBe(37);
    manager.writer.flush();
    const saved = messages.find(m => m.type === "life_over" && m.save === "saved");
    const row = db.query("SELECT score FROM runs WHERE id = ?").get(c.record!.runId) as { score: number };
    expect(saved?.score).toBe(37); expect(row.score).toBe(37);
  } finally { await manager.stop(); db.close(); }
});
