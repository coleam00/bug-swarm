import { test, expect } from "bun:test";
import { openDb } from "../../src/server/db";
import { RoomManager } from "../../src/server/arena/rooms";
import { botDriver, warmRoom, validateWarmup } from "./warmup";
function fixture() {
  let clock = 0;
  const db = openDb(":memory:"), manager = new RoomManager(db, "test", { seed: () => 86, now: () => clock, wallNow: () => clock, schedule: () => 0 as unknown as ReturnType<typeof setInterval>, cancel() {} });
  const bots = botDriver(manager, 8, 86);
  return { manager, bots, advance: () => { clock += 50; }, async close() { await manager.stop(); db.close(); } };
}
test("bot-only warm-up equals ordinary fixed stepping including respawns and coherent lifecycle time", async () => {
  const accelerated = fixture(), ordinary = fixture();
  try {
    const report = await warmRoom(accelerated.manager, accelerated.bots, 300, accelerated.advance, { NODE_ENV: "production", ARENA_PLAYTEST: "1" });
    const room = [...ordinary.manager.rooms.values()][0]!;
    for (let i = 0; i < 6000; i++) { ordinary.advance(); ordinary.bots.input(); ordinary.manager.tick(room); if (i % 100 === 0) await Bun.sleep(0); }
    const actual = [...accelerated.manager.rooms.values()][0]!.state;
    expect(actual).toEqual(room.state); expect(report.steps).toBe(6000);
    expect([...actual.players.values()].some(p => p.life > 1)).toBe(true);
    expect(actual.wave).toBe(10); expect(actual.tick).toBe(6000);
    expect(accelerated.manager.stats().tick.p95Ms).toBeNull();
  } finally { await accelerated.close(); await ordinary.close(); }
}, 15000);
test("warm-up refuses missing opt-in, invalid duration, reused arena and human admission", async () => {
  expect(() => validateWarmup(300, { NODE_ENV: "production" })).toThrow();
  for (const seconds of [-1, 901, NaN, 1.5]) expect(() => validateWarmup(seconds, { ARENA_PLAYTEST: "1" })).toThrow();
  const f = fixture();
  try {
    await warmRoom(f.manager, f.bots, 1, f.advance, { ARENA_PLAYTEST: "1" });
    await expect(warmRoom(f.manager, f.bots, 1, f.advance, { ARENA_PLAYTEST: "1" })).rejects.toThrow("newly created");
  } finally { await f.close(); }
  const g = fixture();
  try {
    const c = g.manager.open({ send() { return 1; }, close() {}, getBufferedAmount() { return 0; } });
    g.manager.message(c, JSON.stringify({ v: 1, type: "hello", playerId: crypto.randomUUID(), name: "Human", team: "tabs", touch: false, buildId: "test" }));
    await expect(warmRoom(g.manager, g.bots, 1, g.advance, { ARENA_PLAYTEST: "1" })).rejects.toThrow("bot-only");
  } finally { await g.close(); }
});
test("idle boss setup advances ordinary ticks, waits through natural deaths and resumes with validated respawn", async () => {
  const f = fixture();
  try {
    await warmRoom(f.manager, f.bots, 119, f.advance, { ARENA_PLAYTEST: "1" }, true);
    const room = [...f.manager.rooms.values()][0]!;
    expect(room.state.tick).toBe(2380); expect(room.state.wave).toBe(4);
    expect([...room.state.players.values()].every(p => p.status === "out" && p.life === 1)).toBe(true);
    f.bots.input();
    expect([...room.state.players.values()].every(p => p.status === "active" && p.life === 2)).toBe(true);
    expect(f.manager.dropped.malformed).toBe(0);
  } finally { await f.close(); }
});
