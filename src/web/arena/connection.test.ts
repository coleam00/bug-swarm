import { expect, test, spyOn } from "bun:test";
import { connectArena } from "./connection";
import { consumeResume, type Resume } from "./resume";
import { SnapshotEncoder } from "../../shared/arena/snapshot-codec";
import { lifeDefaults } from "../../shared/arena/types";
import type { Snapshot } from "../../shared/arena/protocol";
function fixture(pageBuild = "one", retained: Resume | null = null, storageWorks = true) {
  const sockets: any[] = [], timers = new Map<number, { fn: () => void; ms: number }>(), statuses: string[] = [], messages: any[] = [];
  let next = 0, reloads = 0, disconnects = 0, failSocket = false;
  let stored = retained;
  const store = { read: () => stored, write: (value: Resume) => { if (storageWorks) stored = structuredClone(value); return storageWorks; } };
  const identity = retained?.identity ?? { playerId: crypto.randomUUID(), name: "Robot", team: "tabs" as const };
  const connection = connectArena(identity, true, m => messages.push(m), s => statuses.push(s), () => disconnects++, {
    href: "https://arena.test/arena", pageBuild, store, reload: () => reloads++,
    schedule: ((fn: () => void, ms: number) => { const id = ++next; timers.set(id, { fn, ms }); return id; }) as any,
    cancel: ((id: number) => timers.delete(id)) as any,
    socket: url => {
      expect(String(url)).toBe("wss://arena.test/ws");
      if (failSocket) throw new Error("offline");
      const socket = { readyState: 1, bufferedAmount: 0, sent: [] as any[], send(raw: string) { this.sent.push(JSON.parse(raw)); }, close() { this.readyState = 3; (this as any).onclose?.(); } };
      sockets.push(socket); return socket as any;
    },
  });
  const welcome = (buildId = pageBuild) => ({ v: 1, type: "welcome", playerId: identity.playerId, arenaId: "room", buildId,
    world: { width: 2400, height: 2400 }, constants: { stepMs: 50, playerSpeed: 180, playerRadius: 14, maxPlayers: 20 } });
  return { connection, identity, sockets, timers, statuses, messages, store, welcome,
    get socket() { return sockets.at(-1)!; }, reloads: () => reloads, disconnects: () => disconnects,
    fail: () => { failSocket = true; },
    receive(message: object) { sockets.at(-1)!.onmessage({ data: JSON.stringify(message) }); },
    retry(ms: number) { expect(timers.size).toBe(1); const [id, timer] = [...timers][0]!; expect(timer.ms).toBe(ms); timers.delete(id); timer.fn(); },
  };
}
test("backoff, one socket/timer, unchanged identity, stale callbacks and reset only on welcome", () => {
  const f = fixture();
  try {
    f.socket.onopen(); const hello = f.socket.sent[0]; expect(hello).toMatchObject({ ...f.identity, touch: true, buildId: "one" });
    for (const delay of [500, 1000, 2000, 4000, 5000, 5000]) {
      const old = f.socket; old.close(); old.onclose(); f.retry(delay); f.socket.onopen();
      expect(f.socket.sent[0]).toEqual(hello);
      old.onmessage({ data: JSON.stringify(f.welcome("stale")) }); expect(f.reloads()).toBe(0);
    }
    f.receive(f.welcome()); expect(f.connection.state).toBe("connected"); expect(f.reloads()).toBe(0);
    const input = { v: 1 as const, type: "input" as const, seq: 1, life: 1, touch: false, move: { x: 0, y: 0 }, aim: 0, fire: true };
    expect(f.connection.send(input)).toBe(true); f.socket.bufferedAmount = 1; expect(f.connection.send(input)).toBe(false);
    f.socket.close(); f.retry(500); f.connection.dispose(); expect(f.timers.size).toBe(0);
  } finally { f.connection.dispose(); }
});
test("restart feedback survives retries; only committed saves make a saved claim", () => {
  for (const save of ["saved", "failed"] as const) {
    const f = fixture();
    try {
      f.receive(f.welcome());
      const result = { v: 1, type: "life_over", reason: "restart", playerId: f.identity.playerId, life: 1, score: 42, kills: 3, seconds: 9, touch: true, save };
      f.receive({ v: 1, type: "server_restart", result }); f.socket.close(); f.retry(500);
      const feedback = f.statuses.at(-1)!;
      expect(feedback).toMatch(/rejoin/i);
      if (save === "saved") { expect(feedback).toMatch(/saved/i); expect(feedback).toContain("42"); }
      else { expect(feedback).toMatch(/fail/i); expect(feedback).not.toMatch(/saved/i); }
      f.receive(f.welcome()); expect(f.statuses.at(-1)).toBe(feedback);
      expect(f.messages.some(m => m.type === "server_restart")).toBe(true);
    } finally { f.connection.dispose(); }
  }
  const f = fixture(); f.socket.close(); expect(f.statuses.at(-1)).toMatch(/reconnect/i); expect(f.statuses.at(-1)).not.toMatch(/saved/i); f.connection.dispose();
});
test("changed builds reload once across page loads, stale bundles and alternating builds; resume is one use", () => {
  const f = fixture(); f.receive(f.welcome("two")); f.receive(f.welcome("three"));
  expect(f.reloads()).toBe(1); expect(f.connection.state).toBe("reloading"); f.connection.dispose();
  const resume = consumeResume(f.store)!; expect(resume.identity).toEqual(f.identity); expect(resume.touch).toBe(true); expect(consumeResume(f.store)).toBeNull();
  const stale = fixture("one", f.store.read());
  stale.receive(stale.welcome("two")); expect(stale.reloads()).toBe(0);
  stale.receive(stale.welcome("one")); expect(stale.reloads()).toBe(0);
  stale.receive(stale.welcome("three")); expect(stale.reloads()).toBe(1); stale.connection.dispose();
  const again = fixture("one", stale.store.read());
  again.receive(again.welcome("two")); again.receive(again.welcome("one")); expect(again.reloads()).toBe(0);
  again.receive(again.welcome("three")); expect(again.reloads()).toBe(0);
  again.receive(again.welcome("four")); expect(again.reloads()).toBe(1); again.connection.dispose();
});
test("storage failure suppresses reload; transient refusals retry and permanent refusals stop", () => {
  const f = fixture("one", null, false); f.receive(f.welcome("two")); expect(f.reloads()).toBe(0); f.connection.dispose();
  for (const code of ["restarting", "hello-timeout", "team-conflict", "name-hidden", "already-connected", "name-conflict"]) {
    const f = fixture(); f.receive({ v: 1, type: "error", code, message: "Refused", team: "spaces" }); f.socket.close();
    if (["restarting", "hello-timeout", "team-conflict"].includes(code)) {
      f.retry(500); f.socket.onopen(); expect(f.socket.sent[0].team).toBe(code === "team-conflict" ? "spaces" : "tabs");
      if (code === "team-conflict") { f.receive({ v: 1, type: "error", code, message: "Again", team: "tabs" }); f.socket.close(); expect(f.timers.size).toBe(0); }
    } else { expect(f.timers.size).toBe(0); expect(f.messages).toHaveLength(1); }
    f.connection.dispose();
  }
});
test("successful page transitions rearm reload protection for rollbacks and later redeploys", () => {
  let retained: Resume | null = null;
  for (const [page, target] of [["A", "B"], ["B", "C"], ["C", "B"], ["B", "A"], ["A", "B"]]) {
    const f = fixture(page, retained);
    f.receive(f.welcome(page)); expect(f.reloads()).toBe(0);
    f.receive(f.welcome(target)); expect(f.reloads()).toBe(1);
    f.receive(f.welcome(target)); expect(f.reloads()).toBe(1);
    f.connection.dispose(); retained = f.store.read();
    expect(consumeResume(f.store)?.target).toBe(target); expect(consumeResume(f.store)).toBeNull();
  }
});
test("socket construction failures back off and disposal cancels retry", () => {
  const f = fixture(); f.socket.close(); f.fail(); f.retry(500); expect(f.connection.state).toBe("reconnecting"); expect(f.statuses.at(-1)).toBeTruthy();
  f.retry(1000); f.connection.dispose(); expect(f.timers.size).toBe(0);
});

test("negotiated binary snapshots preserve history and reset the base for each socket", () => {
  const f = fixture(), encoder = new SnapshotEncoder(), warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    f.socket.onopen(); expect(f.socket.sent[0].snapshotEncoding).toBe("delta-v1"); expect(f.socket.binaryType).toBe("arraybuffer");
    f.receive(f.welcome());
    const value: Snapshot = { pickups: [], v: 1, type: "snapshot", arenaId: "room", tick: 1, wave: 1, players: [{ ...lifeDefaults(), id: f.identity.playerId, name: "Robot", team: "tabs", x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 1 }], bugs: [], shots: [], globs: [], events: [] };
    f.socket.onmessage({ data: encoder.encode(value).keyframe.buffer });
    const first = f.messages.at(-1); value.tick++; value.players[0]!.x += 5;
    f.socket.onmessage({ data: encoder.encode(value).delta.buffer });
    expect(first.players[0].x).toBe(1200); expect(f.messages.at(-1).players[0].x).toBe(1205);
    f.connection.reconnect(); f.retry(500); f.receive(f.welcome());
    value.tick++; const frames = encoder.encode(value), count = f.messages.length;
    f.socket.onmessage({ data: frames.delta.buffer }); expect(f.messages.length).toBe(count); expect(warn).toHaveBeenCalledTimes(1);
    f.socket.onmessage({ data: frames.keyframe.buffer }); expect(f.messages.at(-1).tick).toBe(3);
  } finally { f.connection.dispose(); warn.mockRestore(); }
});
