import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { createApp, resolveClientIp, START_WINDOW_MS } from "./app";
import { countEvents, getRun, hideName, openDb, recordEvent } from "./db";
import { createSimulation, chooseUpgrade, IDLE, step } from "../web/game/simulation";
import { acquiredUpgrades } from "../web/game/upgrades";
import { arenaForViewport } from "../web/game/arena";
import { UPGRADE_IDS } from "../shared/upgrades";

let dir: string;
let db: Database;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "app-test-"));
  db = openDb(join(dir, "app.db"));
});

afterEach(() => {
  db.close(); // close before deleting: Windows refuses to delete an open file
  rmSync(dir, { recursive: true, force: true });
});

test("health answers ok", async () => {
  const res = await createApp(db).request("/health");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
});

test("events are counted by type, with zeros for types not seen", async () => {
  expect(await (await createApp(db).request("/api/events/count")).json()).toEqual({ opened: 0, run_started: 0, run_ended: 0 });
  recordEvent(db, "opened");
  recordEvent(db, "opened");
  expect(await (await createApp(db).request("/api/events/count")).json()).toEqual({ opened: 2, run_started: 0, run_ended: 0 });
});

const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
test("finish persists canonical builds with one linked event, accepts equivalent retries and rejects changed builds", async () => {
  let time = 0;
  const app = createApp(db, { now: () => time });
  const playerId = crypto.randomUUID();
  const { runId } = await (await app.request("/api/runs", post({ playerId, name: "Robot", team: "tabs" as const }))).json() as { runId: string };
  time = 60000;
  const upgrades = UPGRADE_IDS.slice(0, 2).map(id => ({ id, count: 1 }));
  const result = { playerId, score: 40, squashes: 0, seconds: 40, touch: false, upgrades };
  const send = (data: unknown) => app.request(`/api/runs/${runId}/finish`, post(data));
  expect((await send({ ...result, upgrades: [...upgrades].reverse() })).status).toBe(200);
  expect((await send(result)).status).toBe(200);
  expect((await send({ ...result, upgrades: [upgrades[0]] })).status).toBe(409);
  expect(db.query("SELECT r.upgrades FROM runs r JOIN events e ON e.run_id = r.id WHERE e.type = ?").all("run_ended"))
    .toEqual([{ upgrades: JSON.stringify(upgrades) }]);
});
test("server start, ownership, elapsed-time scoring, idempotency and conflicting replay", async () => {
  let time = 1000;
  const app = createApp(db, { now: () => time });
  const playerId = crypto.randomUUID(), identity = { playerId, name: "Robot", team: "tabs" as const };
  const start = await app.request("/api/runs", post(identity)); expect(start.status).toBe(201);
  const { runId } = await start.json() as { runId: string };
  const result = { playerId, score: 61, squashes: 6, seconds: 1, touch: true };
  expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(400);
  time = 2000;
  expect((await app.request(`/api/runs/${runId}/finish`, post({ ...result, playerId: crypto.randomUUID() }))).status).toBe(404);
  expect((await app.request(`/api/runs/${crypto.randomUUID()}/finish`, post(result))).status).toBe(404);
  expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
  expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
  expect((await app.request(`/api/runs/${runId}/finish`, post({ ...result, score: 62, seconds: 2 }))).status).toBe(409);
  expect(countEvents(db)).toEqual({ opened: 0, run_started: 1, run_ended: 1 });
  expect(getRun(db, runId)?.touch).toBe(1);
  expect((await app.request(`/api/runs/${runId}/finish`, post({ ...result, upgrades: [] }))).status).toBe(200);
  expect(await (await app.request(`/api/players/${playerId}/best`)).json()).toEqual({ best: 61 });
  expect((await app.request("/api/runs", post({ ...identity, name: "Other" }))).status).toBe(409);
});
test("malformed requests, names, ids and capped bodies with and without Content-Length", async () => {
  const app = createApp(db);
  for (const body of [null, [], {}, { playerId: "bad", name: "Robot", team: "tabs" as const }, { playerId: crypto.randomUUID(), name: "5h1t", team: "tabs" }]) {
    expect((await app.request("/api/runs", post(body))).status).toBe(400);
  }
  expect((await app.request("/api/runs", { method: "POST", body: "{" })).status).toBe(400);
  for (const headers of [new Headers(), new Headers({ "Content-Length": "5000" }), new Headers({ "Content-Length": "1" })]) {
    expect((await app.request("/api/runs", { method: "POST", body: "x".repeat(5000), headers })).status).toBe(413);
  }
  expect((await app.request("/api/runs/bad/finish", post({}))).status).toBe(400);
  expect((await app.request(`/api/runs/${crypto.randomUUID()}/finish`, post({}))).status).toBe(400);
  expect((await app.request("/api/players/bad/best")).status).toBe(400);
  for (const path of ["/api", "/api/not-a-route"]) {
    const missing = await app.request(path); expect(missing.status).toBe(404); expect(missing.headers.get("Content-Type")).toContain("json");
  }
});
test("300 starts per peer, independent peers, window expiry and forwarded spoof prevention", async () => {
  let time = 1000, peer = "198.51.100.1";
  const app = createApp(db, { now: () => time, clientIp: (request) => resolveClientIp(peer, request.headers.get("x-forwarded-for"), ["10.0.0.8"]) });
  for (let i = 0; i < 300; i++) expect((await app.request("/api/runs", { ...post({ playerId: crypto.randomUUID(), name: "Robot", team: "tabs" as const }), headers: { "x-forwarded-for": `192.0.2.${i % 250 + 1}` } })).status).toBe(201);
  const limited = await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot", team: "tabs" as const }));
  expect(limited.status).toBe(429); expect(limited.headers.get("Retry-After")).toBe("600");
  expect(countEvents(db).run_started).toBe(300);
  expect(db.query("SELECT COUNT(*) AS n FROM players").get()).toEqual({ n: 300 });
  expect(db.query("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 300 });
  const run = db.query("SELECT id, player_id FROM runs LIMIT 1").get() as { id: string; player_id: string };
  expect((await app.request(`/api/runs/${run.id}/finish`, post({ playerId: run.player_id, score: 0, squashes: 0, seconds: 0, touch: false }))).status).toBe(200);
  peer = "198.51.100.2"; expect((await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot", team: "tabs" as const }))).status).toBe(201);
  peer = "198.51.100.1"; time += START_WINDOW_MS;
  expect((await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot", team: "tabs" as const }))).status).toBe(201);
});

test("proxy hops select from the right, resist forged prefixes and retain exact-peer trust at zero", () => {
  const peer = "10.0.0.8", proxy = "10.0.0.9", client = "198.51.100.1";
  for (const prefix of ["", "192.0.2.1, ", "192.0.2.1, 192.0.2.2, "]) {
    expect(resolveClientIp(peer, prefix + client, [], 0)).toBe(peer);
    expect(resolveClientIp(peer, prefix + client, [peer], 1)).toBe(client);
    expect(resolveClientIp(peer, prefix + client + ", " + proxy, [peer, proxy, client], 2)).toBe(client);
    expect(resolveClientIp(peer, prefix + client + ", " + proxy, [peer, proxy])).toBe(client);
  }
  expect(resolveClientIp(client, "192.0.2.1", [peer])).toBe(client);
  expect(resolveClientIp(peer, " 2001:db8::1 , 10.0.0.9 ", [], 2)).toBe("2001:db8::1");
  expect(resolveClientIp(peer, "::ffff:192.0.2.1", [peer])).toBe("::ffff:192.0.2.1");
});

test("missing, malformed and too-short proxy chains fall back to the peer without shifting hops", () => {
  const peer = "10.0.0.8";
  for (const forwarded of [null, "", " ", "unknown", "example.com", "192.0.2.1:80", "[2001:db8::1]", "fe80::1%eth0", "999.1.1.1", ",192.0.2.1", "192.0.2.1,", "192.0.2.1,,10.0.0.9", "unknown, 192.0.2.1"]) {
    for (const hops of [0, 1, 2]) expect(resolveClientIp(peer, forwarded, [peer], hops)).toBe(peer);
  }
  expect(resolveClientIp(peer, "192.0.2.1", [peer], 2)).toBe(peer);
});

test("300 distinct clients behind one proxy can each start twice", async () => {
  const app = createApp(db, { clientIp: request => resolveClientIp("10.0.0.8", request.headers.get("x-forwarded-for"), [], 1) });
  for (let i = 0; i < 300; i++) {
    const playerId = crypto.randomUUID(), ip = `198.51.${Math.floor(i / 250)}.${i % 250 + 1}`;
    for (let run = 0; run < 2; run++) {
      expect((await app.request("/api/runs", { ...post({ playerId, name: "Robot", team: "tabs" }), headers: { "x-forwarded-for": `192.0.2.${run + 1}, ${ip}` } })).status).toBe(201);
    }
  }
  expect(countEvents(db).run_started).toBe(600);
});

test("40 starts per player across IPs and UUID casing, even with the IP load override; expiry and finish remain usable", async () => {
  let time = 1000, ip = "198.51.100.1";
  const app = createApp(db, { now: () => time, startLimit: 10000, clientIp: () => ip });
  const playerId = crypto.randomUUID();
  const send = (id: string = playerId) => app.request("/api/runs", post({ playerId: id, name: "Robot", team: "tabs" }));
  const { runId } = await (await send()).json() as { runId: string };
  time += 1001;
  for (let i = 1; i < 40; i++) {
    ip = `198.51.100.${i + 1}`;
    expect((await send(i % 2 ? playerId.toUpperCase() : playerId)).status).toBe(201);
  }
  const before = countEvents(db), players = db.query("SELECT COUNT(*) AS n FROM players").get();
  const refused = await send();
  expect(refused.status).toBe(429); expect(refused.headers.get("Retry-After")).toBe("599");
  expect(countEvents(db)).toEqual(before);
  expect(db.query("SELECT COUNT(*) AS n FROM players").get()).toEqual(players);
  expect(db.query("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 40 });
  expect((await app.request(`/api/runs/${runId}/finish`, post({ playerId, score: 0, squashes: 0, seconds: 0, touch: false }))).status).toBe(200);
  expect((await send(crypto.randomUUID())).status).toBe(201);
  time = 1000 + START_WINDOW_MS - 1;
  expect((await send()).headers.get("Retry-After")).toBe("1");
  time++;
  expect((await send()).status).toBe(201); // Only the first timestamp expired.
  const stillLimited = await send();
  expect(stillLimited.status).toBe(429); expect(stillLimited.headers.get("Retry-After")).toBe("2");
  time += 1001;
  expect((await send()).status).toBe(201);
});

test("start budgets count attempts in admission order, expire exactly, and leave refused buckets uncharged", async () => {
  let time = 0;
  const app = createApp(db, { now: () => time, startLimit: 3 });
  expect((await app.request("/api/runs", { method: "POST", body: "x".repeat(4097) })).status).toBe(413);
  expect((await app.request("/api/runs", { method: "POST", body: "{" })).status).toBe(400);
  time = 1001;
  expect((await app.request("/api/runs", post({ playerId: "invalid" }))).status).toBe(400);
  expect((await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot", team: "tabs" }))).status).toBe(201);
  expect((await app.request("/api/runs", post({}))).status).toBe(429);
  time = START_WINDOW_MS - 1;
  expect((await app.request("/api/runs", post({}))).headers.get("Retry-After")).toBe("1");
  time++;
  expect((await app.request("/api/runs", post({}))).status).toBe(400);
  expect((await app.request("/api/runs", post({}))).headers.get("Retry-After")).toBe("2");
  time += 1001;
  expect((await app.request("/api/runs", post({}))).status).toBe(400);
  expect(countEvents(db).run_started).toBe(1);
});

test("valid IDs consume player attempts before name/team validation; player refusals charge IP first", async () => {
  let ip = "198.51.100.1", time = 0;
  const app = createApp(db, { now: () => time, clientIp: () => ip, startLimit: 42 });
  expect((await app.request("/api/runs", post({}))).status).toBe(400);
  time = 1001;
  const playerId = crypto.randomUUID();
  for (let i = 0; i < 40; i++) {
    expect((await app.request("/api/runs", post({ playerId, name: i % 2 ? "!" : "Robot", team: "invalid" }))).status).toBe(400);
  }
  expect((await app.request("/api/runs", post({ playerId, name: "Robot", team: "tabs" }))).status).toBe(429);
  // The player refusal was the 42nd IP attempt. Both budgets are exhausted,
  // but the IP's older timestamp must determine Retry-After.
  const both = await app.request("/api/runs", post({ playerId, name: "Robot", team: "tabs" }));
  expect(both.status).toBe(429); expect(both.headers.get("Retry-After")).toBe("599");
  expect((await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot", team: "tabs" }))).status).toBe(429);
  expect(countEvents(db).run_started).toBe(0);
  expect(db.query("SELECT COUNT(*) AS n FROM players").get()).toEqual({ n: 0 });
  ip = "198.51.100.2";
  expect((await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot", team: "tabs" }))).status).toBe(201);
});
test("finish invalidates rankings, a separate moderation connection expires within one second", async () => {
  let time = 1000;
  const app = createApp(db, { now: () => time });
  const playerId = crypto.randomUUID();
  const { runId } = await (await app.request("/api/runs", post({ playerId, name: "Robot", team: "tabs" as const }))).json() as { runId: string };
  expect(await (await app.request("/api/leaderboard")).json()).toEqual([]);
  expect(await (await app.request("/api/teams")).json()).toEqual({ tabs: 0, spaces: 0 });
  time += 100;
  await app.request(`/api/runs/${runId}/finish`, post({ playerId, score: 1, squashes: 0, seconds: 1, touch: false }));
  const response = await app.request("/api/leaderboard"); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual([{ playerId, name: "Robot", score: 1 }]);
  const teams = await app.request("/api/teams");
  expect(teams.headers.get("Cache-Control")).toBe("no-store");
  expect(await teams.json()).toEqual({ tabs: 1, spaces: 0 });
  const moderator = openDb(join(dir, "app.db"));
  try { hideName(moderator, " ROBOT ", time); } finally { moderator.close(); }
  time += 999; expect(await (await app.request("/api/leaderboard")).json()).toHaveLength(1);
  expect(await (await app.request("/api/teams")).json()).toEqual({ tabs: 1, spaces: 0 });
  time++; expect(await (await app.request("/api/leaderboard")).json()).toEqual([]);
  expect(await (await app.request("/api/teams")).json()).toEqual({ tabs: 0, spaces: 0 });
  expect(await (await app.request(`/api/players/${playerId}/best`)).json()).toEqual({ best: 1 });
});
test("committed finish stays successful if subsequent ranking reads fail", async () => {
  const failures: string[] = [];
  const app = createApp(db, { now: () => 1000, log: (message) => { failures.push(message); } });
  const playerId = crypto.randomUUID();
  const { runId } = await (await app.request("/api/runs", post({ playerId, name: "Robot", team: "tabs" as const }))).json() as { runId: string };
  const result = { playerId, score: 0, squashes: 0, seconds: 0, touch: false };
  expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
  db.exec("ALTER TABLE hidden_names RENAME TO broken_names;"); // Simulate an independent follow-up read failure.
  expect((await app.request("/api/leaderboard")).status).toBe(503);
  expect((await app.request("/api/teams")).status).toBe(503);
  expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
  expect(countEvents(db).run_ended).toBe(1); expect(failures).toHaveLength(2);
});

test("seeded choice-driven finishes remain plausible in all arena shapes, with and without wall-clock pauses", async () => {
  for (const shape of [[1, 1], [390, 844], [844, 390]]) {
    const s = createSimulation(73, arenaForViewport(shape[0]!, shape[1]!));
    // This fixture tests upgraded finish validation, independently of early combat balance.
    s.invulnerableUntil = 60;
    while (!s.dead && s.time < 180) {
      step(s, { x: Math.cos(s.time * 0.4), y: Math.sin(s.time * 0.4), target: null }, 1 / 60);
      if (s.upgrades.offer) chooseUpgrade(s, s.upgrades.choiceNumber, s.upgrades.offer[(s.upgrades.choiceNumber - 1) % 3]!);
    }
    expect(acquiredUpgrades(s.upgrades).length).toBeGreaterThan(0);
    for (const pause of [0, 600000]) {
      let time = 0;
      const app = createApp(db, { now: () => time }), playerId = crypto.randomUUID();
      const { runId } = await (await app.request("/api/runs", post({ playerId, name: "Robot", team: "tabs" as const }))).json() as { runId: string };
      time = s.time * 1000 + pause;
      const result = { playerId, seconds: s.seconds, squashes: s.squashes, score: s.score, touch: false, upgrades: acquiredUpgrades(s.upgrades) };
      expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
      expect(getRun(db, runId)?.upgrades).toBe(JSON.stringify(result.upgrades));
    }
  }
});

test("new players require a valid team; legacy assignment and stored memberships are permanent", async () => {
  const app = createApp(db), playerId = crypto.randomUUID();
  for (const value of [{}, { team: null }, { team: "Tabs" }, { team: 1 }, { team: {} }]) {
    expect((await app.request("/api/runs", post({ playerId, name: "Robot", ...value }))).status).toBe(400);
  }
  expect(db.query("SELECT COUNT(*) AS n FROM players").get()).toEqual({ n: 0 });
  db.query("INSERT INTO players(id, name, name_key) VALUES (?, 'Robot', 'robot')").run(playerId);
  const start = async (extra: object) => {
    const response = await app.request("/api/runs", post({ playerId, name: "Robot", ...extra }));
    expect(response.status).toBe(201);
    return (await response.json() as { runId: string }).runId;
  };
  const legacy = await start({});
  expect(getRun(db, legacy)?.team).toBeNull();
  const assigned = await start({ team: "spaces" });
  expect(getRun(db, assigned)?.team).toBe("spaces");
  expect(getRun(db, await start({}))?.team).toBe("spaces");
  expect(getRun(db, await start({ team: "spaces" }))?.team).toBe("spaces");
  const before = countEvents(db);
  for (const extra of [{ team: "tabs" }, { team: "spaces", name: "Other" }]) {
    expect((await app.request("/api/runs", post({ playerId, name: "Robot", ...extra }))).status).toBe(409);
  }
  expect(countEvents(db)).toEqual(before);
  expect(db.query("SELECT team FROM players WHERE id = ?").get(playerId)).toEqual({ team: "spaces" });
  expect(getRun(db, legacy)?.team).toBeNull();
});

test("totals sum all finished snapshots, omit abandoned and teamless runs, and hide duplicate names", async () => {
  let time = 0;
  const app = createApp(db, { now: () => time });
  const totals = async () => (await app.request("/api/teams")).json();
  expect(await totals()).toEqual({ tabs: 0, spaces: 0 });
  const a = crypto.randomUUID(), b = crypto.randomUUID(), legacy = crypto.randomUUID();
  db.query("INSERT INTO players(id, name, name_key) VALUES (?, 'Legacy', 'legacy')").run(legacy);
  const start = async (playerId: string, name: string, team?: string) => {
    const res = await app.request("/api/runs", post({ playerId, name, ...(team ? { team } : {}) }));
    expect(res.status).toBe(201);
    return (await res.json() as { runId: string }).runId;
  };
  const finish = async (playerId: string, runId: string, score: number) => {
    const result = { playerId, score, squashes: 0, seconds: score, touch: false, team: "spaces" };
    time += 10000;
    expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
    expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
  };
  const old = await start(legacy, "Legacy");
  await start(legacy, "Legacy", "tabs"); // Membership cannot retroactively credit old.
  await finish(legacy, old, 9);
  await finish(a, await start(a, "Robot", "tabs"), 3);
  await finish(a, await start(a, "Robot"), 2);
  await finish(b, await start(b, "ROBOT", "spaces"), 4);
  await start(a, "Robot");
  expect(await totals()).toEqual({ tabs: 5, spaces: 4 });
  hideName(db, " Robot ", time);
  time--; // A backwards clock must also expire the cache.
  expect(await totals()).toEqual({ tabs: 0, spaces: 0 });
  expect(await (await app.request(`/api/players/${a}/best`)).json()).toEqual({ best: 3 });
});
