import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server";
import { HIDDEN_IDENTITY_MESSAGE, parseServer, type ServerMessage, type Snapshot } from "../../shared/arena/protocol";
import { runBots, BotFailure } from "../../../scripts/bots";
import { ServerDecoder } from "../../shared/arena/snapshot-codec";
import { createBug } from "../../shared/arena/bugs/registry";
function client(url: string, index: number, name = `bot-${index}`, id = crypto.randomUUID(), compact = false) {
  const socket = new WebSocket(url), messages: ServerMessage[] = [];
  const decoder = new ServerDecoder(); socket.binaryType = "arraybuffer";
  const observers = new Set<() => void>();
  socket.onopen = () => socket.send(JSON.stringify({ v: 1, type: "hello", playerId: id, name, team: index % 2 ? "tabs" : "spaces", touch: false, buildId: "integration", ...(compact ? { snapshotEncoding: "delta-v1" } : {}) }));
  socket.onmessage = event => { const m = decoder.read(event.data); if (m) messages.push(m); for (const notify of observers) notify(); };
  function wait<T extends ServerMessage>(predicate: (message: ServerMessage) => message is T): Promise<T>;
  function wait(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage>;
  function wait(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { observers.delete(check); reject(new Error(`Timed out waiting for bot-${index}: ${JSON.stringify(messages.at(-1))}`)); }, 3000);
      const check = () => { const message = messages.find(predicate); if (message) { clearTimeout(timeout); observers.delete(check); resolve(message); } };
      observers.add(check); check();
    });
  }
  return { id, socket, messages, wait };
}

test.each([false, true])("two real clients collect all three kinds and receive the combined boosted fan (compact=%s)", async compact => {
  const scratch = mkdtempSync(join(tmpdir(), "weapon-pickup-wire-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const url = `ws://127.0.0.1:${app.server.port}/ws`, a = client(url, 1, "bot-1", crypto.randomUUID(), compact), b = client(url, 2, "bot-2", crypto.randomUUID(), compact);
  try {
    await Promise.all([a.wait(m => m.type === "welcome"), b.wait(m => m.type === "welcome")]);
    const room = app.arenas.active.get(a.id)!.room!, p = room.state.players.get(a.id)!, q = room.state.players.get(b.id)!;
    Object.assign(p, { x: 1000, y: 1200 }); Object.assign(q, { x: 1800, y: 1200 });
    room.state.pickups = (["shield", "spread", "rapid"] as const).map(kind => ({ id: room.state.nextId++, kind, x: 1200, y: 1200, expiresAt: room.state.tick * 50 + 12000 }));
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && m.pickups.length === 3);
    p.x = 1200; app.arenas.tick(room);
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && m.pickups.length === 0 && m.players.some(p => p.id === a.id && p.effects.spread && p.effects.rapid && p.effects.shield));
    a.socket.send(JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 0, y: 0 }, aim: 0, fire: true }));
    for (const c of [a, b]) {
      const s = await c.wait((m): m is Snapshot => m.type === "snapshot" && m.shots.filter(s => s.owner === a.id).length === 3);
      const shots = s.shots.filter(s => s.owner === a.id), angles = shots.map(s => Math.atan2(s.vy, s.vx)).sort((a,b) => a-b);
      // Binary velocities quantize to 1/16 unit/s: each end angle can vary by 0.00005 rad.
      expect(Math.abs(angles[2]! - angles[0]! - Math.PI / 9)).toBeLessThan(0.0001);
      expect(s.players.find(p => p.id === a.id)!.heat).toBe(1.5);
    }
  } finally { a.socket.close(); b.socket.close(); await app.stop(); rmSync(scratch, { recursive: true, force: true }); }
}, 10000);

test("two real clients observe the same floor pickup, one collection winner, refresh and shield consumption", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "shield-wire-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const url = `ws://127.0.0.1:${app.server.port}/ws`, a = client(url, 1), b = client(url, 2);
  try {
    await Promise.all([a.wait(m => m.type === "welcome"), b.wait(m => m.type === "welcome")]);
    const room = app.arenas.active.get(a.id)!.room!, p = room.state.players.get(a.id)!, q = room.state.players.get(b.id)!;
    Object.assign(p, { x: 1000, y: 1000, spawnProtectedUntil: 0 }); Object.assign(q, { x: 1400, y: 1000 });
    const floor = () => { const pickup = { id: room.state.nextId++, kind: "shield" as const, x: 1200, y: 1000, expiresAt: room.state.tick * 50 + 12000 }; room.state.pickups.push(pickup); return pickup; };
    const pickup = floor(); app.arenas.tick(room);
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && m.pickups.some(p => p.id === pickup.id));
    p.x = q.x = 1200; app.arenas.tick(room);
    const winner = p.id < q.id ? p : q, loser = winner === p ? q : p, until = winner.effects.shield!;
    expect(until).toBeGreaterThan(room.state.tick * 50); expect(loser.effects).toEqual({});
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && !m.pickups.some(p => p.id === pickup.id) && m.players.some(p => p.id === winner.id && p.effects.shield === until));
    loser.x = 1600; floor(); app.arenas.tick(room); const refreshed = winner.effects.shield!; expect(refreshed).toBeGreaterThan(until);
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && m.players.some(p => p.id === winner.id && p.effects.shield === refreshed));
    winner.spawnProtectedUntil = winner.immuneUntil = 0; room.state.bugs = [createBug("crawler", room.state.nextId++, winner.x, winner.y)];
    app.arenas.tick(room); expect(winner.effects).toEqual({}); expect(winner.hits).toBe(3);
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && m.tick === room.state.tick && m.players.some(p => p.id === winner.id && !p.effects.shield && p.hits === 3));
  } finally { a.socket.close(); b.socket.close(); await app.stop(); rmSync(scratch, { recursive: true, force: true }); }
}, 10000);
test("real combat transport: hit, cross-team revival in the same run, timeout save and one fresh respawn", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-combat-wire-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const url = `ws://127.0.0.1:${app.server.port}/ws`, a = client(url, 1), b = client(url, 2);
  try {
    await Promise.all([a.wait(m => m.type === "welcome"), b.wait(m => m.type === "welcome")]);
    const room = app.arenas.active.get(a.id)!.room!, p = room.state.players.get(a.id)!;
    p.x = p.y = 1200; room.state.tick = 21; room.state.bugs = [{ id: 999, kind: "crawler", hp: 1, facing: 0, x: 1320, y: 1200, vx: 0, vy: 0 }];
    a.socket.send(JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 0, y: 0 }, aim: 0, fire: true }));
    await a.wait(m => m.type === "snapshot" && m.shots.some(s => s.owner === a.id));
    await b.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && p.score === 11));
    const origin = `http://127.0.0.1:${app.server.port}`;
    const read = async (path: string) => (await fetch(origin + path)).json();
    expect(await read("/api/leaderboard")).toEqual([]); expect(await read("/api/teams")).toEqual({ tabs: 0, spaces: 0 });
    p.hits = 1; p.immuneUntil = 0; room.state.bugs.push({ id: 1000, kind: "crawler", hp: 1, facing: 0, x: p.x, y: p.y, vx: 0, vy: 0 });
    await b.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && p.status === "downed"));
    const runId = app.arenas.active.get(a.id)!.record!.runId, rescuer = room.state.players.get(b.id)!;
    expect(a.messages.some(m => m.type === "life_over")).toBe(false);
    Object.assign(rescuer, { x: p.x, y: p.y }); room.state.bugs = [];
    for (let i = 0; i < 40; i++) app.arenas.tick(room);
    await a.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && p.status === "active" && p.hits === 1 && p.score === 11));
    await b.wait(m => m.type === "snapshot" && m.players.some(p => p.id === b.id && p.score === 50));
    expect(app.arenas.active.get(a.id)!.record!.runId).toBe(runId); expect(p.life).toBe(1); expect(p.streak).toBe(1);
    p.immuneUntil = 0; room.state.bugs = [{ id: 1001, kind: "crawler", hp: 1, facing: 0, x: p.x, y: p.y, vx: 0, vy: 0 }];
    app.arenas.tick(room); expect(p.status).toBe("downed");
    rescuer.x = rescuer.y = 1800;
    for (let i = 0; i < 200; i++) app.arenas.tick(room);
    expect(await a.wait(m => m.type === "life_over" && m.save === "saved")).toMatchObject({ score: 11, kills: 1, life: 1 });
    expect(await read("/api/leaderboard")).toContainEqual({ playerId: a.id, name: "bot-1", score: 11 });
    expect(await read("/api/teams")).toEqual({ tabs: 11, spaces: 0 });
    expect(await read(`/api/players/${a.id}/best`)).toEqual({ best: 11 });
    expect(await read(`/api/players/${a.id}/standing`)).toEqual({ rank: 1, total: 1, next: null });
    await b.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && !p.hits && p.result?.score === 11));
    for (let i = 0; i < 2; i++) a.socket.send(JSON.stringify({ v: 1, type: "respawn", life: 1, touch: true }));
    await a.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && p.life === 2 && p.hits === 3));
    expect(p.score).toBe(0); expect(p.touch).toBe(true);
    await app.arenas.stop();
    expect((app.db.query("SELECT score, team FROM runs WHERE player_id = ?").get(b.id) as any)).toEqual({ score: 50, team: "spaces" });
    expect((app.db.query("SELECT COUNT(*) AS n FROM runs WHERE player_id = ? AND ended_at_ms IS NOT NULL").get(a.id) as any).n).toBe(2);
    expect((app.db.query("SELECT COUNT(*) AS n FROM events WHERE type = 'run_ended'").get() as any).n).toBe(3);
  } finally { a.socket.close(); b.socket.close(); await app.stop(); rmSync(scratch, { recursive: true, force: true }); }
}, 10000);

test("two real clients observe surviving dasher hit, then authoritative removal and score", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "dasher-wire-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const url = `ws://127.0.0.1:${app.server.port}/ws`, a = client(url, 1), b = client(url, 2);
  try {
    await Promise.all([a.wait(m => m.type === "welcome"), b.wait(m => m.type === "welcome")]);
    const room = app.arenas.active.get(a.id)!.room!, p = room.state.players.get(a.id)!;
    p.x = p.y = 1200;
    room.state.bugs.push(createBug("dasher", 999, 1320, 1200));
    a.socket.send(JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 0, y: 0 }, aim: 0, fire: true }));
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && m.bugs.some(b => b.id === 999 && b.hp === 1) && m.events.some(e => e.type === "hit" && e.kind === "dasher") && m.players.some(q => q.id === a.id && q.score === 0 && q.streak === 1));
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && !m.bugs.some(b => b.id === 999) && m.players.some(q => q.id === a.id && q.score === 30 && q.kills === 1));
    expect(p.streak).toBe(2);
  } finally { a.socket.close(); b.socket.close(); await app.stop(); rmSync(scratch, { recursive: true, force: true }); }
}, 10000);
test("real server: clients see each other move, 21st player is isolated, refused names and live hides close", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-integration-")); mkdirSync(join(scratch, "home"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const url = `ws://127.0.0.1:${app.server.port}/ws`, clients: ReturnType<typeof client>[] = [];
  try {
    const a = client(url, 1), b = client(url, 2); clients.push(a, b);
    const both = (m: ServerMessage): m is Snapshot => m.type === "snapshot" && m.players.some(p => p.id === a.id) && m.players.some(p => p.id === b.id);
    const [initial] = await Promise.all([a.wait(both), b.wait(both)]);
    const ax = initial.players.find(p => p.id === a.id)!.x, by = initial.players.find(p => p.id === b.id)!.y;
    a.socket.send(JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 1, y: 0 }, aim: 0, fire: false }));
    b.socket.send(JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 0, y: 1 }, aim: 1, fire: false }));
    await Promise.all([
      a.wait(m => m.type === "snapshot" && m.players.some(p => p.id === b.id && p.y > by && p.ackSeq === 1)),
      b.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && p.x > ax && p.ackSeq === 1)),
    ]);
    // Complete each join so the 21st identity is unambiguously the overflow player on every OS.
    for (let i = 3; i <= 21; i++) { const next = client(url, i); clients.push(next); await next.wait(m => m.type === "welcome"); }
    const full = await a.wait((m): m is Snapshot => m.type === "snapshot" && m.players.length === 20);
    const overflow = clients[20]!, alone = await overflow.wait((m): m is Snapshot => m.type === "snapshot" && m.players.length === 1);
    expect(full.arenaId).not.toBe(alone.arenaId); expect(alone.players[0]!.id).toBe(overflow.id); expect(full.players.some(p => p.id === overflow.id)).toBe(false);
    const statsResponse = await fetch(`http://127.0.0.1:${app.server.port}/api/arena/stats`), stats = await statsResponse.json();
    expect(statsResponse.headers.get("cache-control")).toBe("no-store");
    expect(stats.arenas.map((r: any) => r.players)).toEqual([20, 1]); expect(stats.tick.p95Ms).toBeNumber();
    expect((await fetch(`http://127.0.0.1:${app.server.port}/ws`)).status).toBe(426);
    const refused = client(url, 22, "<script>"); clients.push(refused);
    expect(await refused.wait(m => m.type === "error")).toMatchObject({ code: "name-refused" });
    const closed = new Promise<void>(resolve => a.socket.addEventListener("close", () => resolve(), { once: true }));
    const started = performance.now(), home = join(scratch, "home");
    const hide = Bun.spawn([process.execPath, "scripts/hide.ts", " BOT-1 "], {
      env: { ...process.env, DATA_DIR: join(scratch, "data"), HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, stdout: "pipe", stderr: "pipe",
    });
    expect(await hide.exited, await new Response(hide.stderr).text()).toBe(0);
    expect(await a.wait(m => m.type === "error")).toMatchObject({ code: "name-hidden", message: "That name isn't allowed." });
    await closed; expect(performance.now() - started).toBeLessThanOrEqual(5000);
    const deadline = performance.now() + 1000;
    while (app.arenas.active.has(a.id) && performance.now() < deadline) await Bun.sleep(5);
    expect(app.arenas.active.has(a.id)).toBe(false);
    await b.wait(m => m.type === "snapshot" && m.players.length === 19 && !m.players.some(p => p.id === a.id));
    for (const id of [a.id, crypto.randomUUID()]) {
      const rejoin = client(url, 23, "  BOT-1 ", id); clients.push(rejoin);
      expect(await rejoin.wait(m => m.type === "error")).toMatchObject({ code: "name-hidden", message: HIDDEN_IDENTITY_MESSAGE });
    }
    expect(await (await fetch(`http://127.0.0.1:${app.server.port}/api/leaderboard`)).json()).toEqual([]);
    expect((await (await fetch(`http://127.0.0.1:${app.server.port}/api/arena/stats`)).json()).totalPlayers).toBe(20);
    app.arenas.writer.flush();
    expect((app.db.query("SELECT COUNT(*) AS n FROM runs WHERE mode = 'arena'").get() as any).n).toBe(21);
    expect((app.db.query("SELECT COUNT(*) AS n FROM runs WHERE ended_at_ms IS NOT NULL").get() as any).n).toBe(1);
  } finally {
    const closed = clients.map(c => new Promise<void>(resolve => {
      if (c.socket.readyState === WebSocket.CLOSED) { resolve(); return; }
      c.socket.addEventListener("close", () => resolve(), { once: true }); c.socket.close();
    }));
    await app.stop(); await Promise.all(closed);
    rmSync(scratch, { recursive: true, force: true });
  }
}, 10000);
// Admission and each HTTP request already have CLI deadlines. The outer test
// must also allow five calibration reads, measurement, cancellation and cleanup.
const CLI_STARTUP_MS = 10_000;
const CLI_MEASUREMENT_MS = 1_000 + 6 * 5_000 + 2_000;
const CANCELLATION_STARTUP_MS = 10_000, CANCELLATION_MS = 8_000;
const PEER_CLEANUP_MS = 2_000, FINAL_CLEANUP_MS = 8_000;
const CLI_TEST_TIMEOUT_MS = 3_000 + CLI_STARTUP_MS + CLI_MEASUREMENT_MS +
  CANCELLATION_STARTUP_MS + CANCELLATION_MS + 2 * PEER_CLEANUP_MS + FINAL_CLEANUP_MS + 5_000;

test("real bot CLI wanders, reports required fields and cleans up, including cancellation", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-bots-")), home = join(scratch, "home"); mkdirSync(home);
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  // Exercise the real CLI/HTTP boundary with deterministic tick costs. CPU
  // budgets belong to the dedicated production run, not this one-second test.
  const readStats = app.arenas.stats.bind(app.arenas);
  app.arenas.stats = query => {
    const value = readStats(query);
    if (value.window) for (const metric of [value.window.tick, ...value.window.arenas.map(a => a.tick)]) {
      metric.raw = metric.raw?.map(() => .1); metric.p50Ms = metric.p95Ms = metric.maxMs = metric.samples ? .1 : null;
    }
    return value;
  };
  const observer = client('ws://127.0.0.1:' + app.server.port + '/ws', 99, "Observer");
  let child: ReturnType<typeof Bun.spawn> | undefined, stdout = "", stderr = "";
  let cancellation: ReturnType<typeof runBots> | undefined, interrupted: AbortController | undefined;
  let readers: Promise<void>[] = [];
  const timings: Record<string, number> = {};
  const detail = () => JSON.stringify({ pid: child?.pid, exitCode: child?.exitCode, players: app.arenas.active.size,
    connections: app.arenas.connections.size, stdout: stdout.slice(-2000), stderr: stderr.slice(-2000) });
  async function within<T>(label: string, ms: number, task: Promise<T>): Promise<T> {
    const start = performance.now(); let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error(label + " exceeded " + ms + " ms: " + detail())), ms);
    })]); } finally { clearTimeout(timer); timings[label] = performance.now() - start; }
  }
  async function waitFor(label: string, ms: number, ready: () => boolean) {
    const start = performance.now();
    try {
      while (!ready()) {
        if (performance.now() - start >= ms) throw Error(label + " exceeded " + ms + " ms: " + detail());
        await Bun.sleep(5);
      }
    } finally { timings[label] = performance.now() - start; }
  }
  async function read(stream: ReadableStream<Uint8Array>, append: (text: string) => void) {
    const reader = stream.getReader(), decoder = new TextDecoder();
    try { while (true) { const part = await reader.read(); if (part.done) break; append(decoder.decode(part.value, { stream: true })); } append(decoder.decode()); }
    finally { reader.releaseLock(); }
  }
  try {
    const welcome = await observer.wait((m): m is Extract<ServerMessage, { type: "welcome" }> => m.type === "welcome");
    // Launch the actual CLI directly: a package-wrapper child adds cold-start
    // time and can orphan its CLI grandchild when a test watchdog kills it.
    const running = Bun.spawn([process.execPath, "scripts/bots.ts", "--", "--url", 'http://127.0.0.1:' + app.server.port, "--count", "2", "--seconds", "1"], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, DATA_DIR: join(scratch, "data") },
      stdout: "pipe", stderr: "pipe",
    });
    child = running;
    readers = [read(running.stdout, text => stdout += text), read(running.stderr, text => stderr += text)];
    await waitFor("CLI startup/admission", CLI_STARTUP_MS, () => {
      if (running.exitCode !== null) throw Error("CLI exited before admission: " + detail());
      return app.arenas.active.size === 3;
    });
    const [exit] = await within("CLI measurement/report/exit", CLI_MEASUREMENT_MS, Promise.all([running.exited, ...readers]));
    expect(exit, stderr).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ requested: 2, joins: 2, arenaCount: 1, errors: 0, arenas: [welcome.arenaId] });
    expect(result.client.sent).toBeGreaterThan(20); expect(result.client.received).toBeGreaterThan(20);
    for (const rate of [result.client.messagesPerSecond.out, result.client.messagesPerSecond.in]) {
      expect(Number.isFinite(rate)).toBe(true); expect(rate).toBeGreaterThan(0);
    }
    expect(result.untilMs - result.sinceMs).toBe(1000); expect(result.tick.samples).toBeGreaterThan(0);
    expect(Number.isFinite(result.tick.p50Ms)).toBe(true); expect(Number.isFinite(result.tick.p95Ms)).toBe(true);
    expect(result.tick.p95Ms).toBeGreaterThanOrEqual(result.tick.p50Ms);
    const observations = observer.messages.flatMap(m => m.type === "snapshot" ? m.players.filter(p => p.id !== observer.id) : []);
    const botIds = new Set(observations.map(p => p.id)); expect(botIds.size).toBe(2);
    for (const id of botIds) {
      const positions = observations.filter(p => p.id === id);
      expect(positions.length).toBeGreaterThan(1);
      const first = positions[0]!;
      expect(positions.some(p => Math.hypot(p.x - first.x, p.y - first.y) > 5)).toBe(true);
    }
    observer.socket.close();
    await waitFor("CLI peer cleanup", PEER_CLEANUP_MS, () => app.arenas.connections.size === 0);
    expect(app.arenas.active.size).toBe(0); expect(app.arenas.rooms.size).toBe(0);
    interrupted = new AbortController();
    cancellation = runBots({ url: 'http://127.0.0.1:' + app.server.port, count: 21, seconds: 60 }, interrupted.signal);
    let cancellationFailure: unknown;
    void cancellation.catch(error => { cancellationFailure = error; });
    await waitFor("worker startup/play", CANCELLATION_STARTUP_MS, () => {
      if (cancellationFailure) throw cancellationFailure;
      return app.arenas.active.size === 21 && [...app.arenas.active.values()].every(c => c.ackSeq > 0);
    });
    interrupted.abort();
    await within("worker cancellation", CANCELLATION_MS, cancellation.then(
      () => { throw Error("Expected worker cancellation to reject"); },
      error => { expect(error).toBeInstanceOf(BotFailure); },
    ));
    await waitFor("cancelled peer cleanup", PEER_CLEANUP_MS, () => app.arenas.connections.size === 0);
    expect(app.arenas.active.size).toBe(0); expect(app.arenas.connections.size).toBe(0); expect(app.arenas.rooms.size).toBe(0);
  } finally {
    interrupted?.abort(); observer.socket.close();
    await within("final cleanup", FINAL_CLEANUP_MS, Promise.all([
      (async () => { if (child?.exitCode === null) { child.kill(); await child.exited; } await Promise.all(readers); })(),
      cancellation?.catch(() => {}),
      app.stop(),
    ]));
    rmSync(scratch, { recursive: true, force: true });
    console.info("bot CLI phase durations (ms)", JSON.stringify(timings));
  }
}, CLI_TEST_TIMEOUT_MS);

test.each([false, true])("two real clients receive the same swell, glob, interception and five points (compact=%s)", async compact => {
  const scratch = mkdtempSync(join(tmpdir(), "spitter-wire-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const url = `ws://127.0.0.1:${app.server.port}/ws`, a = client(url, 1, "bot-1", crypto.randomUUID(), compact), b = client(url, 2, "bot-2", crypto.randomUUID(), compact);
  try {
    await Promise.all([a.wait(m => m.type === "welcome"), b.wait(m => m.type === "welcome")]);
    const room = app.arenas.active.get(a.id)!.room!, p = room.state.players.get(a.id)!, q = room.state.players.get(b.id)!;
    Object.assign(p, { x: 1200, y: 1200 }); Object.assign(q, { x: 1800, y: 1800 });
    const bug = createBug("spitter", room.state.nextId++, 800, 1200, room.state.tick * 50); room.state.bugs = [bug];
    Object.assign(bug, { phase: "swell", phaseUntil: (room.state.tick + 4) * 50 });
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && m.bugs.some(b => b.kind === "spitter" && b.phase === "swell"));
    const snapshots: Snapshot[] = [];
    for (const c of [a, b]) snapshots.push(await c.wait((m): m is Snapshot => m.type === "snapshot" && m.globs.length === 1));
    expect(snapshots[0]!.globs).toEqual(snapshots[1]!.globs);
    const g = room.state.globs[0]!;
    room.state.shots.push({ id: room.state.nextId++, x: g.x + 20, y: g.y, vx: -900, vy: 0, owner: p.id, life: p.life, born: room.state.tick * 50 });
    for (const c of [a, b]) await c.wait(m => m.type === "snapshot" && !m.globs.length && m.events.some(e => e.type === "glob-pop") && m.players.some(p => p.id === a.id && p.score === 5 && p.kills === 0));
    expect(p.streak).toBe(1);
  } finally { a.socket.close(); b.socket.close(); await app.stop(); rmSync(scratch, { recursive: true, force: true }); }
}, 10000);

test("real JSON and binary clients receive beetle state and shell bounces", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "beetle-wire-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const url = `ws://127.0.0.1:${app.server.port}/ws`, a = client(url, 1), b = client(url, 2, "Other", undefined, true);
  try {
    await Promise.all([a.wait(m => m.type === "welcome"), b.wait(m => m.type === "welcome")]);
    const room = app.arenas.active.get(a.id)!.room!, p = room.state.players.get(a.id)!;
    const bug = createBug("beetle", 999, 1200, 1200); room.state.bugs = [bug];
    Object.assign(p, { x: 1400, y: 1200 });
    Object.assign(room.state.players.get(b.id)!, { x: 1600, y: 1200 });
    room.state.shots.push({ id: room.state.nextId++, owner: p.id, life: 1, x: bug.x + 24, y: bug.y, vx: -900, vy: 0, born: room.state.tick * 50 });
    const [json, binary] = await Promise.all([a, b].map(c => c.wait((m): m is Snapshot => m.type === "snapshot" &&
      m.bugs.some(b => b.id === 999 && b.kind === "beetle") && m.events.some(e => e.kind === "beetle" && e.type === "bounce"))));
    expect(binary!.tick).toBe(json!.tick);
    expect(binary!.events).toEqual(json!.events);
  } finally { a.socket.close(); b.socket.close(); await app.stop(); rmSync(scratch, { recursive: true, force: true }); }
}, 10000);
