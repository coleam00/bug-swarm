import { STEP_MS } from "../src/shared/arena/constants";
import type { Policy } from "../src/shared/arena/policies";
export { botName } from "./bot-cohort";
import { distribution, TRAFFIC_KEYS, emptyTraffic, byteDistribution } from "../src/server/arena/metrics";
import type { RoomManager } from "../src/server/arena/rooms";
import { botCohorts, type Cohort } from "./bot-workers";
export interface BotOptions { url: string; count: number; seconds: number; policy?: Policy }
export function parseBotArgs(args: string[]): BotOptions {
  const options: BotOptions = { url: "http://127.0.0.1:3000", count: 18, seconds: 60, policy: "aimer" };
  const seen = new Set<string>();
  if (args[0] === "--") args = args.slice(1);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!, value = args[i + 1];
    if (!["--url", "--count", "--seconds", "--policy"].includes(flag) || seen.has(flag) || !value) throw new Error("Usage: bun run bots -- --url <origin> --count <n> --seconds <s> --policy mover|aimer");
    seen.add(flag);
    if (flag === "--policy") { if (value !== "mover" && value !== "aimer") throw new Error("--policy must be mover or aimer"); options.policy = value; }
    else if (flag === "--url") options.url = value;
    else {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(flag + " must be a positive safe integer");
      if (flag === "--count") options.count = Number(value); else options.seconds = Number(value);
    }
  }
  const url = new URL(options.url);
  if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(options.url) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("--url must be an HTTP(S) origin");
  if (options.seconds * 1000 > 2147483647 || options.count > 10000) throw new Error("Requested workload is too large");
  options.url = url.origin;
  return options;
}
type Stats = ReturnType<RoomManager["stats"]>;
type Window = NonNullable<Stats["window"]>;
export class BotFailure extends Error {
  constructor(message: string, readonly report: unknown) { super(message); }
}
export async function runBots(options: BotOptions, signal?: AbortSignal) {
  const arenas = new Set<string>(), playerIds = new Set<string>();
  let cohorts: Cohort[] = [];
  const diagnostics: string[] = [], intervals: Window[] = [];
  let successfulReport: object | undefined;
  const lifecycle = { prematureDisconnects: 0, normalTeardownConnections: 0 };
  let joins = 0, start = Infinity, end = Infinity, offset = 0;
  const joining = { sent: 0, received: 0, bytesReceived: 0 };
  const client = { sent: 0, received: 0, bytesReceived: 0, schedulerSkips: 0, minInputSendGapMs: Infinity };
  let joinTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let fail!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => { fail = error => { diagnostics.push(error.message); reject(error); }; });
  void failure.catch(() => {});
  const abort = () => { fail(new Error("Bot run interrupted")); controller.abort(); };
  signal?.addEventListener("abort", abort, { once: true });
  const updateCounts = () => {
    joins = 0; arenas.clear(); playerIds.clear();
    joining.sent = joining.received = joining.bytesReceived = 0;
    client.sent = client.received = client.bytesReceived = client.schedulerSkips = 0; client.minInputSendGapMs = Infinity;
    lifecycle.prematureDisconnects = lifecycle.normalTeardownConnections = 0;
    for (const cohort of cohorts) {
      const s = cohort.cached; joins += s.joins; for (const id of s.arenas) arenas.add(id);
      for (const id of s.playerIds) playerIds.add(id);
      for (const key of ["sent", "received", "bytesReceived"] as const) { joining[key] += s.joining[key]; client[key] += s.client[key]; }
      client.schedulerSkips += s.client.schedulerSkips; client.minInputSendGapMs = Math.min(client.minInputSendGapMs, s.client.minInputSendGapMs);
      lifecycle.prematureDisconnects += s.lifecycle.prematureDisconnects; lifecycle.normalTeardownConnections += s.lifecycle.normalTeardownConnections;
    }
  };
  const refresh = async () => { await Promise.all(cohorts.map(c => c.refresh())); updateCounts(); };
  const wait = async (serverTime: number) => {
    while (performance.now() + offset < serverTime) await Promise.race([Bun.sleep(Math.min(100, Math.max(1, serverTime - performance.now() - offset))), failure]);
  };
  async function stats(since?: number, until?: number): Promise<Stats> {
    const url = new URL("/api/arena/stats", options.url);
    if (since !== undefined) { url.searchParams.set("sinceMs", String(since)); url.searchParams.set("untilMs", String(until)); url.searchParams.set("raw", "1"); }
    const r = await Promise.race([fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]), redirect: "error" }), failure]);
    if (!r.ok) throw Error("Unavailable arena stats: " + r.status);
    return await Promise.race([r.json(), failure]) as Stats;
  }
  const partial = () => ({ requested: options.count, joins, arenas: [...arenas], arenaCount: arenas.size, policy: options.policy ?? "aimer", joining, client, lifecycle, diagnostics, errors: diagnostics.length, intervals });
  try {
    if (signal?.aborted) throw new Error("Bot run interrupted");
    joinTimer = setTimeout(() => fail(new Error("Join timeout: " + joins + "/" + options.count)), 10000);
    // Each worker owns at most one room's worth of sockets. The report collector
    // remains responsive even when a failed baseline saturates client decoding.
    cohorts = botCohorts(options, fail);
    await Promise.race([Promise.all(cohorts.map(c => c.ready)), failure]); clearTimeout(joinTimer);
    await refresh();
    let initial!: Stats, uncertainty = Infinity;
    for (let i = 0; i < 5; i++) {
      const before = performance.now(), result = await stats(), after = performance.now();
      if (!Number.isFinite(result.serverNowMs)) throw Error("Unavailable or invalid arena stats: missing server time");
      if ((after - before) / 2 < uncertainty) { uncertainty = (after - before) / 2; offset = result.serverNowMs - (before + after) / 2; }
      initial = result;
    }
    start = (Math.floor((performance.now() + offset + uncertainty * 2) / STEP_MS) + 2) * STEP_MS; end = start + options.seconds * 1000;
    for (const cohort of cohorts) cohort.window(performance.timeOrigin + start - offset, performance.timeOrigin + end - offset);
    for (let since = start; since < end;) {
      const until = Math.min(end, since + 30000); await wait(until + 100);
      let result = await stats(since, until);
      // Receive-heavy callbacks can delay the clock calibration response. Always
      // confirm the server has completed the boundary before reading its buckets.
      while (result.serverNowMs < until + STEP_MS) { await Promise.race([Bun.sleep(Math.max(50, until + STEP_MS - result.serverNowMs)), failure]); result = await stats(since, until); }
      const window = result.window;
      if (!window || !window.complete || window.sinceMs !== since || window.untilMs !== until || !window.tick.raw?.length || !window.arenas.every(a => a.tick.raw)) {
        if (window) intervals.push(window);
        throw Error("Incomplete arena measurement window; serverNowMs=" + result.serverNowMs);
      }
      if (!window.tick.raw.every(n => Number.isFinite(n) && n >= 0) || !TRAFFIC_KEYS.every(k => Number.isFinite(window.traffic[k]) && window.traffic[k] >= 0 && Number.isFinite(window.dropped[k]) && window.dropped[k] >= 0) || window.perPlayer.length < options.count) throw Error("Invalid arena measurement data");
      intervals.push(window); since = until;
    }
    await Promise.race([refresh(), failure]);
    const seconds = options.seconds, traffic = emptyTraffic(), dropped = emptyTraffic();
    const perPlayer = new Map<string, { playerId: string; arenaId: string; bytesOut: number; peakSecondBytesOut: number; in: number; rateLimited: number }>();
    const perArena = new Map<string, { id: string; samples: number[]; lateness: number[]; population: { min: number; max: number } }>();
    for (const w of intervals) {
      for (const k of TRAFFIC_KEYS) { traffic[k] += w.traffic[k]; dropped[k] += w.dropped[k]; }
      for (const p of w.perPlayer) {
        const row = perPlayer.get(p.playerId) ?? { playerId: p.playerId, arenaId: p.arenaId, bytesOut: 0, peakSecondBytesOut: 0, in: 0, rateLimited: 0 };
        row.bytesOut += p.bytesOut; row.peakSecondBytesOut = Math.max(row.peakSecondBytesOut, p.peakSecondBytesOut); perPlayer.set(p.playerId, row);
        row.in += p.in; row.rateLimited += p.rateLimited;
      }
      for (const a of w.arenas) {
        const row = perArena.get(a.id) ?? { id: a.id, samples: [], lateness: [], population: { min: Infinity, max: 0 } };
        row.samples.push(...a.tick.raw!); row.lateness.push(...a.schedulerLateness.raw!);
        row.population.min = Math.min(row.population.min, a.population.min); row.population.max = Math.max(row.population.max, a.population.max); perArena.set(a.id, row);
      }
    }
    const tick = distribution(intervals.flatMap(w => w.tick.raw!));
    const arenaRows = [...perArena.values()].map(a => ({ id: a.id, tick: distribution(a.samples), schedulerLateness: distribution(a.lateness), population: a.population }));
    const playerRows = [...perPlayer.values()].map(p => ({ ...p, bot: playerIds.has(p.playerId), bytesPerSecondOut: p.bytesOut / seconds }));
    const serverCohortBytesOut = playerRows.filter(p => p.bot).reduce((n, p) => n + p.bytesOut, 0);
    const issues: string[] = [];
    if (tick.p95Ms === null || tick.p95Ms >= 10 || arenaRows.some(a => a.population.max > 0 && (a.tick.p95Ms === null || a.tick.p95Ms >= 10))) issues.push("tick p95 budget exceeded");
    if (playerRows.some(p => p.bytesPerSecondOut > 40000)) issues.push("per-player bandwidth budget exceeded");
    if (Object.values(dropped).some(n => n > 0) || traffic.rejected || traffic.skipped || traffic.transportErrors || client.schedulerSkips) issues.push("drops or transport errors");
    if (intervals.some(w => w.population.min < options.count)) issues.push("population fell below requested cohort");
    // Receive times can straddle an enqueue boundary by one maximum frame per
    // socket, especially in a one-second integration fixture.
    if (Math.abs(client.bytesReceived - serverCohortBytesOut) > Math.max(serverCohortBytesOut * .01, options.count * 65536)) issues.push("server/client payload totals exceed boundary tolerance");
    diagnostics.push(...issues);
    const report = { ...partial(), intervals: undefined, buildId: initial.buildId, complete: true, sinceMs: start, untilMs: end, seconds, clockUncertaintyMs: uncertainty,
      server: { traffic, dropped, messagesPerSecond: { in: traffic.in / seconds, out: traffic.accepted / seconds }, bytesPerSecondOut: traffic.bytesOut / seconds },
      client: { ...client, messagesPerSecond: { out: client.sent / seconds, in: client.received / seconds }, bytesPerSecondIn: client.bytesReceived / seconds },
      payloadCrossCheck: { serverCohortBytesOut, differenceBytes: client.bytesReceived - serverCohortBytesOut, relativeDifference: (client.bytesReceived - serverCohortBytesOut) / Math.max(1, serverCohortBytesOut) },
      population: { min: Math.min(...intervals.map(w => w.population.min)), max: Math.max(...intervals.map(w => w.population.max)) },
      perPlayer: playerRows, maxPlayerBytesPerSecondOut: Math.max(0, ...playerRows.map(p => p.bytesPerSecondOut)), perArena: arenaRows, tick,
      snapshotBytes: Object.fromEntries(["all", "keyframe", "delta", "json"].map(key => {
        const { histogram: _, ...summary } = byteDistribution(intervals.flatMap(w => w.snapshotBytes[key as keyof Window["snapshotBytes"]]?.histogram ?? [])); return [key, summary];
      })), rateLimitExamples: intervals.flatMap(w => w.rateLimitExamples ?? []),
      schedulerLateness: distribution(intervals.flatMap(w => w.schedulerLateness.raw!)), errors: diagnostics.length };
    if (issues.length) throw new BotFailure(issues.join("; "), report);
    successfulReport = report;
    return report;
  } catch (error) {
    await refresh();
    if (error instanceof BotFailure) throw error;
    if (!diagnostics.length) diagnostics.push(String(error));
    throw new BotFailure(String(error), partial());
  } finally {
    clearTimeout(joinTimer); controller.abort(); signal?.removeEventListener("abort", abort);
    await Promise.all(cohorts.map(c => c.close())); updateCounts();
    if (successfulReport && (diagnostics.length || lifecycle.normalTeardownConnections !== options.count)) {
      diagnostics.push("Bot cleanup incomplete");
      throw new BotFailure("Bot cleanup incomplete", { ...successfulReport, diagnostics, errors: diagnostics.length });
    }
  }
}
if (import.meta.main) {
  const controller = new AbortController(), abort = () => controller.abort();
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  try { console.log(JSON.stringify(await runBots(parseBotArgs(process.argv.slice(2)), controller.signal), null, 2)); }
  catch (error) { if (error instanceof BotFailure) console.log(JSON.stringify(error.report, null, 2)); console.error("Bots failed:", error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
}
