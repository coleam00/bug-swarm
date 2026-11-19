import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { createApp, resolveClientIp, START_WINDOW_MS } from "./app";
import { countEvents, getRun, hideName, openDb, recordEvent } from "./db";
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
  const { runId } = await (await app.request("/api/runs", post({ playerId, name: "Robot" }))).json() as { runId: string };
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
  const playerId = crypto.randomUUID(), identity = { playerId, name: "Robot" };
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
  for (const body of [null, [], {}, { playerId: "bad", name: "Robot" }, { playerId: crypto.randomUUID(), name: "5h1t" }]) {
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
test("30 starts per peer, independent peers, window expiry and forwarded spoof prevention", async () => {
  let time = 1000, peer = "client-a";
  const app = createApp(db, { now: () => time, clientIp: (request) => resolveClientIp(peer, request.headers.get("x-forwarded-for"), ["proxy"]) });
  for (let i = 0; i < 30; i++) expect((await app.request("/api/runs", { ...post({ playerId: crypto.randomUUID(), name: "Robot" }), headers: { "x-forwarded-for": `spoof-${i}` } })).status).toBe(201);
  const limited = await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot" }));
  expect(limited.status).toBe(429); expect(limited.headers.get("Retry-After")).toBe("600");
  peer = "client-b"; expect((await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot" }))).status).toBe(201);
  peer = "client-a"; time += START_WINDOW_MS;
  expect((await app.request("/api/runs", post({ playerId: crypto.randomUUID(), name: "Robot" }))).status).toBe(201);
  expect(resolveClientIp("proxy", "spoof, real, proxy2", ["proxy", "proxy2"])).toBe("real");
  expect(resolveClientIp("real", "spoof", [])).toBe("real");
});
test("finish invalidates rankings, a separate moderation connection expires within one second", async () => {
  let time = 1000;
  const app = createApp(db, { now: () => time });
  const playerId = crypto.randomUUID();
  const { runId } = await (await app.request("/api/runs", post({ playerId, name: "Robot" }))).json() as { runId: string };
  expect(await (await app.request("/api/leaderboard")).json()).toEqual([]);
  time += 1000;
  await app.request(`/api/runs/${runId}/finish`, post({ playerId, score: 1, squashes: 0, seconds: 1, touch: false }));
  const response = await app.request("/api/leaderboard"); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual([{ playerId, name: "Robot", score: 1 }]);
  const moderator = openDb(join(dir, "app.db"));
  try { hideName(moderator, " ROBOT ", time); } finally { moderator.close(); }
  time += 999; expect(await (await app.request("/api/leaderboard")).json()).toHaveLength(1);
  time++; expect(await (await app.request("/api/leaderboard")).json()).toEqual([]);
  expect(await (await app.request(`/api/players/${playerId}/best`)).json()).toEqual({ best: 1 });
});
test("committed finish stays successful if subsequent ranking reads fail", async () => {
  const failures: string[] = [];
  const app = createApp(db, { now: () => 1000, log: (message) => { failures.push(message); } });
  const playerId = crypto.randomUUID();
  const { runId } = await (await app.request("/api/runs", post({ playerId, name: "Robot" }))).json() as { runId: string };
  const result = { playerId, score: 0, squashes: 0, seconds: 0, touch: false };
  expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
  db.exec("ALTER TABLE hidden_names RENAME TO broken_names;"); // Simulate an independent follow-up read failure.
  expect((await app.request("/api/leaderboard")).status).toBe(503);
  expect((await app.request(`/api/runs/${runId}/finish`, post(result))).status).toBe(200);
  expect(countEvents(db).run_ended).toBe(1); expect(failures).toHaveLength(1);
});
