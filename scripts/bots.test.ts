import { expect, test } from "bun:test";
import { botName, parseBotArgs, runBots } from "./bots";
import { validateName } from "../src/server/rules";
import { parseClient, type InputMessage, type Snapshot, VERSION } from "../src/shared/arena/protocol";
import { lifeDefaults } from "../src/shared/arena/types";
import { WORLD_WIDTH, WORLD_HEIGHT, PLAYER_SPEED, PLAYER_RADIUS, MAX_PLAYERS, STEP_MS } from "../src/shared/arena/constants";
test("bots CLI defaults, optional separator, origin and bounded positive argument validation", () => {
  expect(parseBotArgs([])).toEqual({ url: "http://127.0.0.1:3000", count: 18, seconds: 60, policy: "aimer" });
  expect(parseBotArgs(["--", "--url", "https://swarm.test/", "--count", "20", "--seconds", "1"])).toEqual({ url: "https://swarm.test", count: 20, seconds: 1, policy: "aimer" });
  expect(parseBotArgs(["--policy", "mover"]).policy).toBe("mover");
  expect(() => parseBotArgs(["--policy", "idle"])).toThrow();
  for (const args of [["--count", "0"], ["--seconds", "1.5"], ["--seconds", "2147484"], ["--count", "2", "--count", "3"], ["--url", "ws://swarm.test"], ["--url", "https://swarm.test/path"], ["--unknown", "1"], ["--count"]]) expect(() => parseBotArgs(args)).toThrow();
});
test("WebSocket bots send distinct mover and aimer inputs; aimer seeks a safe pickup while aiming", async () => {
  const observed: InputMessage[] = [];
  const server = Bun.serve<{}>({ hostname: "127.0.0.1", port: 0,
    fetch(request, server) {
      if (new URL(request.url).pathname === "/ws" && server.upgrade(request, { data: {} })) return;
      return Response.json({ arenas: [{ id: "policy-test", players: 1 }], totalPlayers: 1, tick: { p50Ms: 0.1, p95Ms: 0.2 } });
    },
    websocket: { message(socket, raw) {
      const message = parseClient(raw); if (!message) throw new Error("Invalid bot input");
      if (message.type === "input") { observed.push(message); return; }
      if (message.type !== "hello") return;
      socket.send(JSON.stringify({ v: VERSION, type: "welcome", playerId: message.playerId, arenaId: "policy-test", buildId: "test",
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }, constants: { stepMs: STEP_MS, playerSpeed: PLAYER_SPEED, playerRadius: PLAYER_RADIUS, maxPlayers: MAX_PLAYERS } }));
      const snapshot: Snapshot = { v: VERSION, type: "snapshot", pickups: [{ id: 2, kind: "shield", x: 1200, y: 1400, expiresAt: 12050 }], arenaId: "policy-test", tick: 1, wave: 1, events: [], shots: [],
        players: [{ ...lifeDefaults(), id: message.playerId, name: message.name, team: message.team, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 0 }],
        bugs: [{ id: 1, kind: "crawler", hp: 1, facing: 0, x: 1600, y: 1200, vx: 0, vy: 140 }] };
      socket.send(JSON.stringify(snapshot));
    } },
  });
  try {
    const first: InputMessage[] = [];
    for (const policy of ["mover", "aimer"] as const) {
      observed.length = 0; await runBots({ url: server.url.origin, count: 1, seconds: 1, policy });
      expect(observed.length).toBeGreaterThan(0); first.push(observed[0]!);
    }
    const [mover, aimer] = first as [InputMessage, InputMessage];
    expect(mover.fire).toBe(true); expect(mover.aim).toBeCloseTo(Math.atan2(mover.move.y, mover.move.x));
    expect(aimer.fire).toBe(true); expect(aimer.aim).toBeGreaterThan(0); expect(aimer.aim).toBeLessThan(Math.PI / 2);
    expect(aimer.move).toEqual({ x: 0, y: 1 });
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
      return Response.json({ arenas: [{ id: "revive-test", players: 1 }], totalPlayers: 1, tick: { p50Ms: 0.1, p95Ms: 0.2 } });
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
  const snapshot: Snapshot = { v: 1, type: "snapshot", pickups: [], arenaId: "revive-test", tick: 0, wave: 1, players: [], bugs: [], shots: [], events: [] };
  try {
    await runBots({ url: server.url.origin, count: 1, seconds: 1, policy: "aimer" });
    expect(phases).toEqual(["downed", "active"]); expect(respawns).toBe(1);
  } finally { await server.stop(true); }
});
