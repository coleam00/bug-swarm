import { expect, test } from "bun:test";
import { api, request } from "./api";
import { createApp } from "../server/app";
import { finishRun, openDb, startRun } from "../server/db";

test("score reads time out and abort even if the transport or response body stalls", async () => {
  let signal: AbortSignal | null | undefined;
  await expect(request("/api/teams", (_path, options) => { signal = options?.signal; return new Promise(() => {}); }, 5)).rejects.toThrow("timed out");
  expect(signal?.aborted).toBe(true);
  await expect(request("/api/teams", async () => new Response(new ReadableStream({ start() {} })), 5)).rejects.toThrow("timed out");
});
test("score reads avoid caches, surface failures and read seeded server scores", async () => {
  await expect(request("/api/teams", async (_path, options) => {
    expect(options?.method).toBe("GET"); expect(options?.body).toBeUndefined(); expect(options?.cache).toBe("no-store");
    return new Response("down", { status: 503 });
  })).rejects.toThrow("API 503: down");
  const db = openDb(":memory:"), original = globalThis.fetch, playerId = crypto.randomUUID();
  const started = startRun(db, playerId, "Robot", 0, "tabs");
  if ("error" in started) throw Error(started.error);
  finishRun(db, started.runId, { playerId, score: 60, squashes: 0, seconds: 60, touch: false }, 60000);
  const app = createApp(db);
  globalThis.fetch = ((path: string, init?: RequestInit) => app.request(path, init)) as typeof fetch;
  try {
    expect(await api.leaders()).toEqual([{ playerId, name: "Robot", score: 60 }]);
    expect(await api.standing(playerId)).toEqual({ rank: 1, total: 1, next: null });
    expect(await api.best(playerId)).toEqual({ best: 60 });
    expect(await api.teams()).toEqual({ tabs: 60, spaces: 0 });
  } finally { globalThis.fetch = original; db.close(); }
});
