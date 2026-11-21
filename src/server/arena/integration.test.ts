import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server";
import { hideName } from "../db";
import { HIDDEN_IDENTITY_MESSAGE, parseServer, type ServerMessage, type Snapshot } from "../../shared/arena/protocol";
import { runBots } from "../../../scripts/bots";
function client(url: string, index: number, name = `bot-${index}`) {
  const id = crypto.randomUUID(), socket = new WebSocket(url), messages: ServerMessage[] = [];
  const observers = new Set<() => void>();
  socket.onopen = () => socket.send(JSON.stringify({ v: 1, type: "hello", playerId: id, name, team: index % 2 ? "tabs" : "spaces", touch: false, buildId: "integration" }));
  socket.onmessage = event => { const m = parseServer(event.data); if (m) messages.push(m); for (const notify of observers) notify(); };
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
test("real combat transport: travelling hit, remote score, terminal save and exactly one fresh respawn", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-combat-wire-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const url = `ws://127.0.0.1:${app.server.port}/ws`, a = client(url, 1), b = client(url, 2);
  try {
    await Promise.all([a.wait(m => m.type === "welcome"), b.wait(m => m.type === "welcome")]);
    const room = app.arenas.active.get(a.id)!.room!, p = room.state.players.get(a.id)!;
    p.x = p.y = 1200; room.state.tick = 21; room.state.bugs = [{ id: 999, kind: "crawler", x: 1320, y: 1200, vx: 0, vy: 0 }];
    a.socket.send(JSON.stringify({ v: 1, type: "input", life: 1, touch: false, seq: 1, move: { x: 0, y: 0 }, aim: 0, fire: true }));
    await a.wait(m => m.type === "snapshot" && m.shots.some(s => s.owner === a.id));
    await b.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && p.score === 11));
    p.hits = 1; p.immuneUntil = 0; room.state.bugs.push({ id: 1000, kind: "crawler", x: p.x, y: p.y, vx: 0, vy: 0 });
    expect(await a.wait(m => m.type === "life_over" && m.save === "saved")).toMatchObject({ score: 11, kills: 1, life: 1 });
    await b.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && !p.hits && p.result?.score === 11));
    for (let i = 0; i < 2; i++) a.socket.send(JSON.stringify({ v: 1, type: "respawn", life: 1, touch: true }));
    await a.wait(m => m.type === "snapshot" && m.players.some(p => p.id === a.id && p.life === 2 && p.hits === 3));
    expect(p.score).toBe(0); expect(p.touch).toBe(true);
    app.arenas.stop();
    expect((app.db.query("SELECT COUNT(*) AS n FROM runs WHERE player_id = ? AND ended_at_ms IS NOT NULL").get(a.id) as any).n).toBe(2);
    expect((app.db.query("SELECT COUNT(*) AS n FROM events WHERE type = 'run_ended'").get() as any).n).toBe(3);
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
    hideName(app.db, "bot-1", Date.now());
    expect(await a.wait(m => m.type === "error")).toMatchObject({ code: "name-hidden", message: HIDDEN_IDENTITY_MESSAGE });
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
test("real bot CLI wanders, reports required fields and cleans up, including cancellation", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-bots-")), home = join(scratch, "home"); mkdirSync(home);
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  const observer = client(`ws://127.0.0.1:${app.server.port}/ws`, 99, "Observer");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const welcome = await observer.wait((m): m is Extract<ServerMessage, { type: "welcome" }> => m.type === "welcome");
    const running = Bun.spawn([process.execPath, "run", "bots", "--", "--url", `http://127.0.0.1:${app.server.port}`, "--count", "2", "--seconds", "1"], {
      cwd: join(import.meta.dir, "../../.."),
      env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, DATA_DIR: join(scratch, "data") },
      stdout: "pipe", stderr: "pipe",
    });
    child = running;
    const [stdout, stderr, exit] = await Promise.all([new Response(running.stdout).text(), new Response(running.stderr).text(), running.exited]);
    expect(exit, stderr).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({ requested: 2, joins: 2, arenaCount: 1, errors: 0, arenas: [welcome.arenaId] });
    expect(result.sent).toBeGreaterThan(20); expect(result.received).toBeGreaterThan(20);
    for (const rate of [result.messagesPerSecond.sent, result.messagesPerSecond.received]) {
      expect(Number.isFinite(rate)).toBe(true); expect(rate).toBeGreaterThan(0);
    }
    expect(result.tick.windowMs).toBe(60000); expect(result.tick.samples).toBeGreaterThan(0);
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
    // Client close events precede the peer's close callbacks. Wait for the actual server cleanup.
    const deadline = performance.now() + 2000;
    while (app.arenas.active.size && performance.now() < deadline) await Bun.sleep(5);
    expect(app.arenas.active.size).toBe(0); expect(app.arenas.rooms.size).toBe(0);
    const interrupted = new AbortController(), timer = setTimeout(() => interrupted.abort(), 200);
    try { await expect(runBots({ url: `http://127.0.0.1:${app.server.port}`, count: 2, seconds: 60 }, interrupted.signal)).rejects.toThrow(); }
    finally { clearTimeout(timer); }
    const abortedDeadline = performance.now() + 2000;
    while (app.arenas.active.size && performance.now() < abortedDeadline) await Bun.sleep(5);
    expect(app.arenas.active.size).toBe(0); expect(app.arenas.connections.size).toBe(0);
  } finally {
    if (child && child.exitCode === null) { child.kill(); await child.exited; }
    observer.socket.close(); await app.stop(); rmSync(scratch, { recursive: true, force: true });
  }
}, 10000);
