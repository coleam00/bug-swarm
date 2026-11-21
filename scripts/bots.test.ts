import { expect, test } from "bun:test";
import { botName, parseBotArgs, runBots, BotFailure } from "./bots";
import { validateName } from "../src/server/rules";
import { parseClient, type InputMessage, type Snapshot, VERSION } from "../src/shared/arena/protocol";
import { lifeDefaults } from "../src/shared/arena/types";
import { WORLD_WIDTH, WORLD_HEIGHT, PLAYER_SPEED, PLAYER_RADIUS, MAX_PLAYERS, STEP_MS } from "../src/shared/arena/constants";
import { emptyTraffic } from "../src/server/arena/metrics";
import { createServer } from "../src/server/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Timing is synthetic in policy-only transport fixtures. Real reporting is
// covered against the production server below.
function policyStats(request: Request, id: string, playerId = "fixture") {
  const url = new URL(request.url), since = Number(url.searchParams.get("sinceMs")), until = Number(url.searchParams.get("untilMs"));
  const tick = { samples: 1, p50Ms: .1, p95Ms: .1, maxMs: .1, raw: [.1] };
  return Response.json({ serverNowMs: performance.now(), arenas: [{ id, players: 1 }], totalPlayers: 1,
    window: { sinceMs: since, untilMs: until, complete: true, population: { min: 1, max: 1 }, traffic: emptyTraffic(), dropped: emptyTraffic(), perPlayer: [{ playerId, arenaId: id, bytesOut: 0, peakSecondBytesOut: 0, in: 0, rateLimited: 0 }], tick, schedulerLateness: tick, snapshotBytes: {}, arenas: [{ id, population: { min: 1, max: 1 }, tick, schedulerLateness: tick }] } });
}
test("bots CLI defaults, optional separator, origin and bounded positive argument validation", () => {
  expect(parseBotArgs([])).toEqual({ url: "http://127.0.0.1:3000", count: 18, seconds: 60, policy: "aimer" });
  expect(parseBotArgs(["--", "--url", "https://swarm.test/", "--count", "20", "--seconds", "1"])).toEqual({ url: "https://swarm.test", count: 20, seconds: 1, policy: "aimer" });
  expect(parseBotArgs(["--policy", "mover"]).policy).toBe("mover");
  expect(() => parseBotArgs(["--policy", "idle"])).toThrow();
  for (const args of [["--count", "0"], ["--seconds", "1.5"], ["--seconds", "2147484"], ["--count", "2", "--count", "3"], ["--url", "ws://swarm.test"], ["--url", "https://swarm.test/path"], ["--unknown", "1"], ["--count"]]) expect(() => parseBotArgs(args)).toThrow();
});
test("WebSocket bots actually send distinct mover and aimer inputs for the same observation", async () => {
  const observed = new Map<string, InputMessage[]>();
  let currentPlayerId = "";
  const server = Bun.serve<{ playerId?: string }>({ hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/ws" && server.upgrade(request, { data: {} })) return;
      return policyStats(request, "policy-test", currentPlayerId);
    },
    websocket: { message(socket, raw) {
      const message = parseClient(raw); if (!message) throw new Error("Invalid bot input");
      if (message.type === "input") { observed.get(socket.data.playerId!)!.push(message); return; }
      if (message.type !== "hello") return;
      socket.data.playerId = message.playerId; observed.set(message.playerId, []);
      currentPlayerId = message.playerId;
      socket.send(JSON.stringify({ v: VERSION, type: "welcome", playerId: message.playerId, arenaId: "policy-test", buildId: "test",
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }, constants: { stepMs: STEP_MS, playerSpeed: PLAYER_SPEED, playerRadius: PLAYER_RADIUS, maxPlayers: MAX_PLAYERS } }));
      const snapshot: Snapshot = { v: VERSION, type: "snapshot", arenaId: "policy-test", tick: 1, wave: 1, events: [], shots: [],
        players: [{ ...lifeDefaults(), id: message.playerId, name: message.name, team: message.team, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 0 }],
        bugs: [{ id: 1, kind: "crawler", hp: 1, facing: 0, x: 1600, y: 1200, vx: 0, vy: 140 }] };
      socket.send(JSON.stringify(snapshot));
    } },
  });
  try {
    const first: InputMessage[] = [];
    for (const policy of ["mover", "aimer"] as const) {
      const report = await runBots({ url: server.url.origin, count: 1, seconds: 1, policy });
      // Peer close callbacks may trail client close. Attribute observations by
      // identity so a previous policy's final packet cannot enter this cohort.
      const inputs = observed.get(report.perPlayer.find(p => p.bot)!.playerId)!;
      expect(inputs.length).toBeGreaterThan(0); first.push(inputs[0]!);
    }
    const [mover, aimer] = first as [InputMessage, InputMessage];
    expect(mover.fire).toBe(true); expect(mover.aim).toBeCloseTo(Math.atan2(mover.move.y, mover.move.x));
    expect(aimer.fire).toBe(true); expect(aimer.aim).toBeGreaterThan(0); expect(aimer.aim).toBeLessThan(Math.PI / 2);
    expect(Math.abs(aimer.aim - Math.atan2(aimer.move.y, aimer.move.x))).toBeGreaterThan(0.1);
    expect(mover.aim).not.toBeCloseTo(aimer.aim);
  } finally { await server.stop(true); }
}, 10000);
test("all supported bot identities pass the live name rules", () => {
  for (let i = 0; i < 10000; i++) expect(validateName(botName(i)).error).toBeUndefined();
});

test("bot transport waits downed, resumes the same life after revival and requests terminal respawn once", async () => {
  const phases: string[] = []; let respawns = 0;
  const server = Bun.serve<{}>({ hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/ws" && server.upgrade(request, { data: {} })) return;
      return policyStats(request, "revive-test");
    },
    websocket: { message(socket, raw) {
      const m = parseClient(raw); if (!m) throw Error("Invalid input");
      if (m.type === "hello") {
        socket.send(JSON.stringify({ v: VERSION, type: "welcome", playerId: m.playerId, arenaId: "revive-test", buildId: "test",
          world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }, constants: { stepMs: STEP_MS, playerSpeed: PLAYER_SPEED, playerRadius: PLAYER_RADIUS, maxPlayers: MAX_PLAYERS } }));
        snapshot.players = [{ ...lifeDefaults(), status: "downed", downedUntil: 10050, hits: 0, id: m.playerId, name: m.name, team: m.team, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 0 }];
      } else if (m.type === "input") {
        const p = snapshot.players[0]!; phases.push(p.status);
        expect(m.life).toBe(1);
        if (p.status === "downed") {
          expect(m.fire).toBe(false); expect(m.move).toEqual({ x: 0, y: 0 });
          p.status = "active"; p.hits = 1; p.downedUntil = 0;
        } else { p.status = "out"; p.hits = 0; }
      } else { respawns++; expect(m.life).toBe(1); }
      snapshot.tick++; socket.send(JSON.stringify(snapshot));
    } },
  });
  const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "revive-test", tick: 0, wave: 1, players: [], bugs: [], shots: [], events: [] };
  try {
    await runBots({ url: server.url.origin, count: 1, seconds: 1, policy: "aimer" });
    expect(phases).toEqual(["downed", "active"]); expect(respawns).toBe(1);
  } finally { await server.stop(true); }
});

test("production bot reporting uses the full window, server directions, payload totals and normal teardown; incomplete data fails with diagnostics", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "bot-report-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(scratch, "data"), env: {} });
  // This checks reporting/transport, not wall-clock performance in a one-second
  // fixture. Keep real timestamped output and supply deterministic costs plus
  // asymmetric input counts; the load harness is the performance assertion.
  const readStats = app.arenas.stats.bind(app.arenas);
  app.arenas.stats = query => {
    const value = readStats(query);
    if (value.window) for (const metric of [value.window.tick, ...value.window.arenas.map(a => a.tick)]) {
      metric.raw = metric.raw?.map(() => .1); metric.p50Ms = metric.p95Ms = metric.maxMs = metric.samples ? .1 : null;
    }
    if (value.window) value.window.traffic.in += 1000; // Direction swaps must fail regardless of timer cadence.
    return value;
  };
  const measured = (count: number) => runBots({ url: app.server.url.origin, count, seconds: 1 }, AbortSignal.timeout(10_000));
  try {
    const report = await measured(2);
    expect(report.untilMs - report.sinceMs).toBe(1000); expect(report.complete).toBe(true); expect(report.errors).toBe(0);
    expect(report.joining.sent).toBeGreaterThanOrEqual(2); expect(report.population.min).toBe(2);
    expect(report.lifecycle).toEqual({ prematureDisconnects: 0, normalTeardownConnections: 2 });
    const actual = app.arenas.stats({ sinceMs: report.sinceMs, untilMs: report.untilMs }).window!;
    expect(report.server.traffic).toEqual(actual.traffic);
    expect(report.server.messagesPerSecond.in).toBe(actual.traffic.in);
    expect(report.server.messagesPerSecond.out).toBe(actual.traffic.accepted);
    expect(actual.traffic.in).not.toBe(actual.traffic.accepted);
    expect(report.perPlayer.map(p => p.bytesOut).reduce((a,b) => a+b, 0)).toBe(actual.traffic.bytesOut);
    expect(report.tick.samples).toBe(actual.tick.samples);
    expect(report.snapshotBytes.keyframe!.samples).toBeGreaterThan(0);
    // The HTTP boundary must reject misaligned and unbounded requests.
    for (const query of ["sinceMs=1&untilMs=100", "sinceMs=0&untilMs=200000", "sinceMs=0", "sinceMs=0&untilMs=100&raw=no"]) expect((await fetch(app.server.url.origin + "/api/arena/stats?" + query)).status).toBe(400);
    const workers = await measured(21);
    expect(workers.joins).toBe(21); expect(workers.arenaCount).toBe(2); expect(workers.lifecycle.normalTeardownConnections).toBe(21);
    const stats = app.arenas.stats.bind(app.arenas);
    app.arenas.stats = query => { const value = stats(query); if (value.window) value.window.complete = false; return value; };
    try { await measured(1); throw Error("Expected incomplete window failure"); }
    catch (error) {
      expect(error).toBeInstanceOf(BotFailure);
      const partial = (error as BotFailure).report as any;
      expect(partial.joins).toBe(1); expect(partial.errors).toBeGreaterThan(0); expect(partial.diagnostics.length).toBeGreaterThan(0); expect(partial.intervals[0].complete).toBe(false);
    }
    for (let i = 0; i < 100 && app.arenas.active.size; i++) await Bun.sleep(10);
    expect(app.arenas.active.size).toBe(0);
  } finally { await app.stop(); rmSync(scratch, { recursive: true, force: true }); }
// Three bounded runs, each allowing ten seconds plus worker refresh/close (6s),
// and server cleanup must finish before Bun's outer watchdog.
}, 60_000);
