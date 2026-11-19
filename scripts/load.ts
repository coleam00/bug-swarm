import type { Finish, Identity } from "../src/shared/api";
import { TEAMS } from "../src/shared/teams";
import { isId, POINTS_PER_SECOND, POINTS_PER_SQUASH, validateName } from "../src/server/rules";

export const USAGE = "bun run load -- --url <http(s) origin> [--players 500] [--seconds 60]";
export interface LoadOptions { url: string; players: number; seconds: number }
export function parseArgs(args: string[]): LoadOptions | null {
  if (args[0] === "--") args = args.slice(1);
  if (args.length === 1 && args[0] === "--help") return null;
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!, value = args[i + 1];
    if (!["--url", "--players", "--seconds"].includes(key) || flags.has(key) || !value || value.startsWith("--")) throw new Error(USAGE);
    flags.set(key, value);
  }
  const raw = flags.get("--url");
  if (!raw) throw new Error(USAGE);
  const url = new URL(raw);
  if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(raw) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("--url must be an HTTP(S) origin without credentials, path, query or fragment.");
  const integer = (key: string, fallback: string) => {
    const value = flags.get(key) ?? fallback;
    const n = Number(value);
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(n)) throw new Error(`${key} must be a positive safe integer.`);
    return n;
  };
  const players = integer("--players", "500"), seconds = integer("--seconds", "60");
  if (!Number.isSafeInteger(seconds * 1000)) throw new Error("--seconds duration overflows milliseconds.");
  return { url: url.origin, players, seconds };
}

export interface Sample { route: string; ms: number; status?: number; failure?: string }
export function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1]! : null;
  return { count: sorted.length, p50: rank(.5), p95: rank(.95), p99: rank(.99) };
}
export function summarize(samples: Sample[]) {
  const failures: Record<string, number> = {};
  const byRoute: Record<string, ReturnType<typeof percentiles>> = {};
  for (const sample of samples) if (sample.failure) failures[sample.failure] = (failures[sample.failure] ?? 0) + 1;
  for (const route of new Set(samples.map(s => s.route))) byRoute[route] = percentiles(samples.filter(s => s.route === route).map(s => s.ms));
  return {
    requests: samples.length, failures, byRoute, overall: percentiles(samples.map(s => s.ms)),
    successfulUnder200: samples.length ? samples.filter(s => !s.failure && s.ms < 200).length / samples.length : 0,
    serverErrors: samples.filter(s => s.status !== undefined && s.status >= 500 && s.status < 600).length,
  };
}

export function makePlayer(index: number): Identity {
  for (;;) {
    const playerId = crypto.randomUUID();
    const name = `load-${playerId.replaceAll("-", "").slice(0, 11)}`;
    if (!validateName(name).error) return { playerId, name, team: TEAMS[index % TEAMS.length]! };
  }
}
export function makeFinish(playerId: string, index: number, elapsedMs: number): Finish {
  const seconds = Math.floor(elapsedMs / 1000), squashes = seconds * (1 + index % 3);
  return { playerId, seconds, squashes, score: POINTS_PER_SQUASH * squashes + POINTS_PER_SECOND * seconds, touch: index % 2 === 0, upgrades: [] };
}

// Dependencies keep the workload testable without wall-clock waits or a listener.
export interface Runtime {
  now: () => number;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}
export const sleep: Runtime["sleep"] = (ms, signal) => new Promise(resolve => {
  if (signal.aborted) { resolve(); return; }
  // Chunk very long user-supplied durations instead of overflowing setTimeout.
  const chunk = Math.min(ms, 2_147_483_647);
  const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
  const timer = setTimeout(() => {
    done();
  }, chunk);
  signal.addEventListener("abort", done, { once: true });
});

const START = "POST /api/runs", FINISH = "POST /api/runs/:runId/finish";
const BEST = "GET /api/players/:playerId/best", LEADERS = "GET /api/leaderboard", TEAMS_ROUTE = "GET /api/teams";
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const score = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0;
function valid(route: string, v: unknown): boolean {
  if (route === LEADERS) return Array.isArray(v) && v.length <= 10 && v.every(row => object(row) && isId(row.playerId) && !validateName(row.name).error && score(row.score));
  if (!object(v)) return false;
  if (route === START) return isId(v.runId);
  if (route === FINISH) return v.saved === true;
  if (route === BEST) return v.best === null || score(v.best);
  return TEAMS.every(team => score(v[team]));
}

export async function runLoad(options: LoadOptions, runtime: Runtime = { now: () => performance.now(), sleep, fetch }, signal?: AbortSignal) {
  const samples: Sample[] = [], errors: string[] = [];
  const started = runtime.now(), deadline = started + options.seconds * 1000;
  const stop = new AbortController();
  const interrupt = () => stop.abort();
  signal?.addEventListener("abort", interrupt, { once: true });
  if (signal?.aborted) interrupt();
  let acceptedStarts = 0, acceptedFinishes = 0;
  const active = () => !stop.signal.aborted && runtime.now() < deadline;
  const waitUntil = async (at: number) => {
    while (active() && runtime.now() < at) await runtime.sleep(Math.min(at, deadline) - runtime.now(), stop.signal);
  };
  const request = async (route: string, path: string, body?: unknown): Promise<unknown> => {
    if (!active()) return undefined;
    const at = runtime.now(), controller = new AbortController();
    const timeout = new AbortController();
    const timer = runtime.sleep(5000, timeout.signal).then(() => {
      if (!timeout.signal.aborted) controller.abort();
    });
    const sample: Sample = { route, ms: 0 };
    try {
      const response = await runtime.fetch(options.url + path, {
        method: body === undefined ? "GET" : "POST", redirect: "manual", cache: "no-store", signal: controller.signal,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      sample.status = response.status;
      const text = await response.text();
      if (response.status !== (route === START ? 201 : 200)) sample.failure = `HTTP ${response.status}`;
      else {
        let value: unknown;
        try { value = JSON.parse(text); } catch { sample.failure = "invalid-response"; }
        if (!sample.failure && !valid(route, value)) sample.failure = "invalid-response";
        if (!sample.failure) return value;
      }
    } catch {
      sample.failure = controller.signal.aborted ? "timeout" : "transport";
    } finally {
      timeout.abort();
      await timer;
      sample.ms = runtime.now() - at;
      samples.push(sample);
    }
    return undefined;
  };
  const boards = () => Promise.all([request(LEADERS, "/api/leaderboard"), request(TEAMS_ROUTE, "/api/teams")]);
  const player = async (index: number) => {
    const identity = makePlayer(index);
    const start = await request(START, "/api/runs", identity);
    if (!object(start)) return;
    acceptedStarts++;
    const received = runtime.now();
    await waitUntil(received + Math.min((5 + index % 11) * 1000, options.seconds * 1000 / 3));
    if (!active()) return;
    const reads = () => Promise.all([request(BEST, `/api/players/${identity.playerId}/best`), boards()]);
    const deathAt = runtime.now();
    const finish = request(FINISH, `/api/runs/${start.runId}/finish`, makeFinish(identity.playerId, index, deathAt - received));
    const initialReads = reads();
    // Refresh as soon as save is acknowledged, independently of the initial reads.
    const saveRefresh = finish.then(async saved => {
      if (saved) { acceptedFinishes++; await reads(); }
    });
    const polling = (async () => {
      const pending: Promise<unknown>[] = [];
      for (let at = deathAt + 2000; active(); at += 2000) {
        await waitUntil(at);
        if (active()) pending.push(boards());
      }
      await Promise.all(pending);
    })();
    await Promise.all([initialReads, saveRefresh, polling]);
  };
  const observer = async () => {
    const pending: Promise<unknown>[] = [];
    for (let at = started; active(); at += 5000) {
      await waitUntil(at);
      if (active()) pending.push(boards());
    }
    await Promise.all(pending);
  };
  let schedulingMs = 0;
  const deadlineTask = (async () => {
    await waitUntil(deadline);
    schedulingMs = runtime.now() - started;
    stop.abort();
  })();
  try {
    const results = await Promise.allSettled([deadlineTask, observer(), ...Array.from({ length: options.players }, (_, i) => player(i))]);
    for (const result of results) if (result.status === "rejected") errors.push(String(result.reason));
  } finally {
    stop.abort();
    signal?.removeEventListener("abort", interrupt);
  }
  const summary = summarize(samples);
  const missingReads = [BEST, LEADERS, TEAMS_ROUTE].filter(route => !samples.some(s => s.route === route && !s.failure));
  const passed = !signal?.aborted && !errors.length && !Object.keys(summary.failures).length && acceptedStarts === options.players && acceptedFinishes === options.players && !missingReads.length && summary.successfulUnder200 >= .95;
  return { ...summary, requestedPlayers: options.players, acceptedStarts, acceptedFinishes, schedulingMs, drainMs: runtime.now() - started - schedulingMs, errors, missingReads, passed };
}

export function formatSummary(result: Awaited<ReturnType<typeof runLoad>>) {
  const latency = (stats: ReturnType<typeof percentiles>) => `n=${stats.count} p50=${stats.p50?.toFixed(2) ?? "n/a"} p95=${stats.p95?.toFixed(2) ?? "n/a"} p99=${stats.p99?.toFixed(2) ?? "n/a"} ms`;
  return [
    `Players: ${result.requestedPlayers}; accepted starts: ${result.acceptedStarts}; accepted finishes: ${result.acceptedFinishes}`,
    `Scheduling: ${(result.schedulingMs / 1000).toFixed(3)} s; drain: ${(result.drainMs / 1000).toFixed(3)} s`,
    `Requests: ${result.requests}; failures by status/category: ${JSON.stringify(result.failures)}`,
    ...Object.entries(result.byRoute).map(([route, stats]) => `${route}: ${latency(stats)}`),
    `Overall: ${latency(result.overall)}`,
    `Successful under 200 ms: ${(result.successfulUnder200 * 100).toFixed(2)}%; 5xx: ${result.serverErrors} (required: 0)`,
    `Missing successful reads: ${result.missingReads.join(", ") || "none"}; workload errors: ${result.errors.join("; ") || "none"}`,
    `Capacity result: ${result.passed ? "PASS" : "FAIL"}`,
  ].join("\n");
}

if (import.meta.main) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options) console.log(USAGE);
    else {
      console.log(`Target: ${options.url}; writing ${options.players} load- players/runs over ${options.seconds} s. Deaths at 5–15 s (capped at one-third duration); game-over polls 2 s; board observer 5 s. Request timeout 5 s.`);
      process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
      const result = await runLoad(options, undefined, controller.signal);
      console.log(formatSummary(result));
      if (!result.passed) process.exitCode = 1;
    }
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
}
