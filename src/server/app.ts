import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { countEvents, finishRun, getRun, leaderboard, personalBest, startRun } from "./db";
import { isId, plausible, parseFinish, validateName } from "./rules";
import type { Leader } from "../shared/api";

export const START_LIMIT = 30;
export const START_WINDOW_MS = 10 * 60 * 1000;
export interface AppOptions {
  now?: () => number;
  clientIp?: (request: Request) => string;
  log?: (message: string, error: unknown) => void;
}

export function resolveClientIp(peer: string, forwarded: string | null, trusted: readonly string[]): string {
  let ip = peer;
  const chain = (forwarded ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  while (trusted.includes(ip) && chain.length) ip = chain.pop()!;
  return ip;
}

export function createApp(db: Database, options: AppOptions = {}) {
  const now = options.now ?? Date.now;
  const log = options.log ?? console.error;
  const buckets = new Map<string, number[]>();
  let cached: { at: number; rows: Leader[] } | undefined;
  const app = new Hono<{ Variables: { clientIp: string } }>();
  app.onError((error, c) => {
    log(`API failed ${c.req.method} ${c.req.path}`, error);
    return c.json({ error: "Service unavailable. Try again." }, 503);
  });
  app.get("/health", (c) => c.text("ok"));
  app.use("/api/*", async (c, next) => { c.header("Cache-Control", "no-store"); await next(); });
  app.use("/api/*", async (c, next) => {
    c.set("clientIp", options.clientIp?.(c.req.raw) ?? "local");
    const reader = c.req.raw.body?.getReader();
    if (reader) {
      const buffer = new Uint8Array(4096);
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (size + value.byteLength > buffer.byteLength) {
            void reader.cancel().catch((error) => log("Could not cancel oversized request", error));
            return c.json({ error: "Request too large." }, 413);
          }
          buffer.set(value, size); size += value.byteLength;
        }
      } finally { reader.releaseLock(); }
      c.req.raw = new Request(c.req.raw, { body: buffer.subarray(0, size) });
    }
    await next();
  });
  app.get("/api/events/count", (c) => c.json(countEvents(db)));
  app.post("/api/runs", async (c) => {
    const time = now();
    for (const [key, starts] of buckets) {
      const live = starts.filter((at) => at > time - START_WINDOW_MS);
      if (live.length) buckets.set(key, live); else buckets.delete(key);
    }
    const ip = c.get("clientIp");
    const starts = buckets.get(ip) ?? [];
    if (starts.length >= START_LIMIT) {
      c.header("Retry-After", String(Math.max(1, Math.ceil((starts[0]! + START_WINDOW_MS - time) / 1000))));
      return c.json({ error: "Too many runs. Try again shortly." }, 429);
    }
    starts.push(time);
    buckets.set(ip, starts);
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON." }, 400); }
    if (!body || !isId(body.playerId)) return c.json({ error: "Invalid player id." }, 400);
    const name = validateName(body.name);
    if (name.error) return c.json({ error: name.error }, 400);
    const runId = startRun(db, body.playerId, name.name!, time);
    if (!runId) return c.json({ error: "This player id already has a different name." }, 409);
    return c.json({ runId }, 201);
  });
  app.post("/api/runs/:runId/finish", async (c) => {
    const id = c.req.param("runId");
    if (!isId(id)) return c.json({ error: "Invalid run id." }, 400);
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON." }, 400); }
    const finish = parseFinish(body);
    if (!finish) return c.json({ error: "Invalid run result." }, 400);
    const run = getRun(db, id);
    if (!run || run.player_id !== finish.playerId) return c.json({ error: "Run not found." }, 404);
    if (run.ended_at_ms !== null) {
      const identical = run.score === finish.score && run.squashes === finish.squashes && run.seconds === finish.seconds && run.touch === Number(finish.touch) && run.upgrades === JSON.stringify(finish.upgrades);
      return identical ? c.json({ saved: true }) : c.json({ error: "Run already finished." }, 409);
    }
    const time = now();
    if (!plausible(finish, run.started_at_ms, time)) return c.json({ error: "Score is impossible for this run's elapsed time." }, 400);
    finishRun(db, id, finish, time);
    cached = undefined;
    return c.json({ saved: true });
  });
  app.get("/api/leaderboard", (c) => {
    const time = now();
    if (!cached || time - cached.at >= 1000 || time < cached.at) cached = { at: time, rows: leaderboard(db) };
    return c.json(cached.rows);
  });
  app.get("/api/players/:playerId/best", (c) => {
    const id = c.req.param("playerId");
    if (!isId(id)) return c.json({ error: "Invalid player id." }, 400);
    return c.json({ best: personalBest(db, id) });
  });
  app.all("/api/*", (c) => c.json({ error: "API route not found." }, 404));
  return app;
}
