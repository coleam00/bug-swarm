import { expect, test } from "bun:test";
import { api, RateLimitError, request, TeamConflictError } from "./api";
import { createApp } from "../../server/app";
import { getRun, openDb } from "../../server/db";
import { UPGRADE_IDS } from "../../shared/upgrades";
test("requests have a deadline even when the transport ignores abort", async () => {
  let signal: AbortSignal | null | undefined;
  const stalled = ((_path: unknown, options?: RequestInit) => { signal = options?.signal; return new Promise<Response>(() => {}); }) as typeof fetch;
  await expect(request("/api/runs", {}, stalled, 5)).rejects.toThrow();
  expect(signal?.aborted).toBe(true);
});
test("request sends JSON, reads server responses and surfaces errors", async () => {
  const fetcher = (async (_path: unknown, options?: RequestInit) => {
    expect(JSON.parse(String(options?.body))).toEqual({ name: "Robot", team: "tabs" as const });
    expect(options?.method).toBe("POST"); expect(new Headers(options?.headers).get("content-type")).toBe("application/json");
    expect(options?.cache).toBe("no-store");
    return Response.json({ runId: "server" });
  }) as typeof fetch;
  expect(await request("/api/runs", { name: "Robot", team: "tabs" as const }, fetcher)).toEqual({ runId: "server" });
  await expect(request("/api/leaderboard", undefined, async () => new Response("down", { status: 503 }))).rejects.toThrow("503");
});
test("the deadline also covers a response body that never completes", async () => {
  await expect(request("/api/leaderboard", undefined, async () => new Response(new ReadableStream({ start() {} })), 5)).rejects.toThrow();
});

test("429 is typed by status even without JSON; other failures and team conflicts retain their meaning", async () => {
  for (const body of ['{"error":"Too many runs"}', "proxy rate limit", ""]) {
    await expect(request("/api/runs", {}, async () => new Response(body, { status: 429 }))).rejects.toBeInstanceOf(RateLimitError);
  }
  await expect(request("/api/runs", {}, async () => new Response(new ReadableStream({ start() {} }), { status: 429 }))).rejects.toBeInstanceOf(RateLimitError);
  await expect(request("/api/runs", {}, async () => Response.json({ code: "team-conflict", team: "tabs" }, { status: 409 }))).rejects.toBeInstanceOf(TeamConflictError);
});

test("exported client starts, finishes and reads scores against the in-process server", async () => {
  const db = openDb(":memory:"), originalFetch = globalThis.fetch;
  let now = 1000;
  const app = createApp(db, { now: () => now });
  globalThis.fetch = ((path: string, init?: RequestInit) => app.request(path, init)) as typeof fetch;
  try {
    const identity = { playerId: crypto.randomUUID(), name: "Robot", team: "tabs" as const };
    const { runId } = await api.start(identity);
    expect(getRun(db, runId)?.player_id).toBe(identity.playerId);
    now += 60000;
    const upgrades = [{ id: UPGRADE_IDS[0], count: 2 }, { id: UPGRADE_IDS[3], count: 1 }];
    expect(await api.finish(runId, { playerId: identity.playerId, score: 60, squashes: 0, seconds: 60, touch: false, upgrades })).toEqual({ saved: true, held: false });
    expect(getRun(db, runId)?.ended_at_ms).toBe(now);
    expect(JSON.parse(getRun(db, runId)!.upgrades)).toEqual(upgrades);
    expect(await api.leaders()).toEqual([{ playerId: identity.playerId, name: identity.name, score: 60 }]);
    expect(await api.standing(identity.playerId)).toEqual({ rank: 1, total: 1, next: null });
    expect(await api.best(identity.playerId)).toEqual({ best: 60 });
    expect(await api.teams()).toEqual({ tabs: 60, spaces: 0 });
  } finally { globalThis.fetch = originalFetch; db.close(); }
});
