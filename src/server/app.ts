import { Hono } from "hono";
import { isIP } from "node:net";
import type { Database } from "bun:sqlite";
import { countEvents, finishRun, getRun, rankedPlayers, personalBest, startRun, teamTotals } from "./db";
import { isTeam } from "../shared/teams";
import { isId, plausible, parseFinish, validateName } from "./rules";
import type { Leader, Standing, TeamTotals } from "../shared/api";

export const START_LIMIT = 300;
export const PLAYER_START_LIMIT = 40;
export const START_WINDOW_MS = 10 * 60 * 1000;
export interface AppOptions {
  scoreCacheHook?: (invalidate: () => void) => void;
  arenaStats?: (query?: { sinceMs: number; untilMs: number; raw?: boolean }) => unknown;
  startLimit?: number;
  now?: () => number;
  clientIp?: (request: Request) => string;
  log?: (message: string, error: unknown) => void;
}

export function resolveClientIp(peer: string, forwarded: string | null, trusted: readonly string[], hops = 0): string {
  if (!forwarded || (hops === 0 && !trusted.includes(peer))) return peer;
  const chain = forwarded.split(",").map((v) => v.trim());
  // Never discard entries: doing so would change the trusted hop positions.
  if (chain.some((ip) => ip.includes("%") || !isIP(ip))) return peer;
  if (hops > 0) return chain[chain.length - hops] ?? peer;
  let ip = peer;
  while (trusted.includes(ip) && chain.length) ip = chain.pop()!;
  return ip;
}

export function createApp(db: Database, options: AppOptions = {}) {
  const now = options.now ?? Date.now;
  const log = options.log ?? console.error;
  const buckets = new Map<string, number[]>();
  const playerBuckets = new Map<string, number[]>();
  function charge(budget: Map<string, number[]>, key: string, limit: number, time: number): number | null {
    const starts = budget.get(key) ?? [];
    if (starts.length >= limit) return Math.max(1, Math.ceil((starts[0]! + START_WINDOW_MS - time) / 1000));
    starts.push(time);
    budget.set(key, starts);
    return null;
  }
  let cached: { at: number; rows: Leader[]; total: number; standings: Map<string, Standing> } | undefined;
  function ranking() {
    const time = now();
    if (!cached || time - cached.at >= 1000 || time < cached.at) {
      const rows = rankedPlayers(db);
      const standings = new Map<string, Standing>();
      rows.forEach((row, index) => standings.set(row.playerId, {
        rank: index + 1, total: rows.length,
        next: index ? { rank: index, pointsToBeat: rows[index - 1]!.score - row.score + 1 } : null,
      }));
      cached = { at: time, rows: rows.slice(0, 10), total: rows.length, standings };
    }
    return cached;
  }
  let cachedTeams: { at: number; totals: TeamTotals } | undefined;
  options.scoreCacheHook?.(() => { cached = undefined; cachedTeams = undefined; });
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
  app.get("/api/arena/stats", (c) => {
    const since = c.req.query("sinceMs"), until = c.req.query("untilMs"), raw = c.req.query("raw");
    if (since === undefined && until === undefined && raw === undefined) return c.json(options.arenaStats?.() ?? { arenas: [], totalPlayers: 0 });
    if (!since || !until || !/^\d+$/.test(since) || !/^\d+$/.test(until) || !Number.isSafeInteger(+since) || !Number.isSafeInteger(+until) || +since % 50 || +until % 50 || +until <= +since || +until - +since > 180000 || raw !== undefined && raw !== "1") return c.json({ error: "Use aligned sinceMs/untilMs within 180 seconds and optional raw=1" }, 400);
    return c.json(options.arenaStats?.({ sinceMs: +since, untilMs: +until, raw: raw === "1" }) ?? { error: "Stats unavailable" });
  });
  app.post("/api/runs", async (c) => {
    const time = now();
    for (const budget of [buckets, playerBuckets]) {
      for (const [key, starts] of budget) {
        const live = starts.filter((at) => at > time - START_WINDOW_MS);
        if (live.length) budget.set(key, live); else budget.delete(key);
      }
    }
    const ipRetry = charge(buckets, c.get("clientIp"), options.startLimit ?? START_LIMIT, time);
    if (ipRetry !== null) {
      c.header("Retry-After", String(ipRetry));
      return c.json({ error: "Too many runs. Try again shortly." }, 429);
    }
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON." }, 400); }
    if (!body || !isId(body.playerId)) return c.json({ error: "Invalid player id." }, 400);
    const playerRetry = charge(playerBuckets, body.playerId.toLowerCase(), PLAYER_START_LIMIT, time);
    if (playerRetry !== null) {
      c.header("Retry-After", String(playerRetry));
      return c.json({ error: "Too many runs. Try again shortly." }, 429);
    }
    const name = validateName(body.name);
    if (name.error) return c.json({ error: name.error }, 400);
    if ("team" in body && !isTeam(body.team)) return c.json({ error: "Choose Tabs or Spaces." }, 400);
    const result = startRun(db, body.playerId, name.name!, time, body.team);
    if ("error" in result && result.error === "team-conflict") return c.json({ error: "This player already belongs to another team.", code: result.error, team: result.team }, 409);
    if ("error" in result) return c.json({ error: result.error === "team-required" ? "Choose Tabs or Spaces." : "This player id already has a different name." }, result.error === "team-required" ? 400 : 409);
    return c.json(result, 201);
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
    if (run.mode === "arena") return c.json({ error: "Arena scores are saved by the server." }, 403);
    if (run.ended_at_ms !== null) {
      const identical = run.score === finish.score && run.squashes === finish.squashes && run.seconds === finish.seconds && run.touch === Number(finish.touch) && run.upgrades === JSON.stringify(finish.upgrades);
      return identical ? c.json({ saved: true, held: Boolean(run.held) }) : c.json({ error: "Run already finished." }, 409);
    }
    const time = now();
    if (!plausible(finish, run.started_at_ms, time)) return c.json({ error: "Score is impossible for this run's elapsed time." }, 400);
    const saved = finishRun(db, id, finish, time);
    if (!saved) return c.json({ error: "Run already finished." }, 409);
    cached = undefined;
    cachedTeams = undefined;
    return c.json(saved);
  });
  app.get("/api/leaderboard", (c) => {
    return c.json(ranking().rows);
  });
  app.get("/api/players/:playerId/standing", (c) => {
    const id = c.req.param("playerId");
    if (!isId(id)) return c.json({ error: "Invalid player id." }, 400);
    const snapshot = ranking();
    return c.json(snapshot.standings.get(id) ?? { rank: null, total: snapshot.total, next: null });
  });
  app.get("/api/teams", (c) => {
    const time = now();
    if (!cachedTeams || time - cachedTeams.at >= 1000 || time < cachedTeams.at) cachedTeams = { at: time, totals: teamTotals(db) };
    return c.json(cachedTeams.totals);
  });
  app.get("/api/players/:playerId/best", (c) => {
    const id = c.req.param("playerId");
    if (!isId(id)) return c.json({ error: "Invalid player id." }, 400);
    return c.json({ best: personalBest(db, id) });
  });
  app.all("/api/*", (c) => c.json({ error: "API route not found." }, 404));
  return app;
}
