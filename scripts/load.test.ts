import { expect, test } from "bun:test";
import { createApp } from "../src/server/app";
import { countEvents, openDb } from "../src/server/db";
import { isId, validateName } from "../src/server/rules";
import { TEAMS } from "../src/shared/teams";
import { formatSummary, makeFinish, makePlayer, parseArgs, percentiles, runLoad, summarize, type Runtime } from "./load";

test("load arguments: defaults, separator, origin normalization and help", () => {
  expect(parseArgs(["--url", "https://example.test/"])).toEqual({ url: "https://example.test", players: 500, seconds: 60 });
  expect(parseArgs(["--", "--seconds", "3", "--players", "2", "--url", "http://localhost:1234"])).toEqual({ url: "http://localhost:1234", players: 2, seconds: 3 });
  expect(parseArgs(["--help"])).toBeNull();
});

test("load arguments reject malformed, duplicate, missing and overflowing values", () => {
  for (const url of ["file:///data", "ftp://example.test", "http://a/b", "http://user:pass@a", "http://a?x", "http://a#x", "http://a?", "http://a#", "http://a/../", "localhost:3000"]) {
    expect(() => parseArgs(["--url", url])).toThrow();
  }
  for (const args of [[], ["--url"], ["--players", "1"], ["--wat", "1"], ["extra"], ["--url", "http://a", "--url", "http://b"], ["--help", "extra"]]) expect(() => parseArgs(args)).toThrow();
  for (const key of ["--players", "--seconds"]) {
    for (const value of ["0", "-1", "1.5", "", "Infinity", "1e2", " 1", "9007199254740992"]) expect(() => parseArgs(["--url", "http://a", key, value])).toThrow();
    expect(() => parseArgs(["--url", "http://a", key, "1", key, "2"])).toThrow();
  }
  expect(() => parseArgs(["--url", "http://a", "--seconds", "9007199254741"])).toThrow();
});

test("summary uses nearest ranks across raw samples, includes failures and strict latency boundary", () => {
  expect(percentiles([])).toEqual({ count: 0, p50: null, p95: null, p99: null });
  expect(percentiles([7])).toEqual({ count: 1, p50: 7, p95: 7, p99: 7 });
  expect(percentiles(Array.from({ length: 100 }, (_, i) => 100 - i))).toEqual({ count: 100, p50: 50, p95: 95, p99: 99 });
  const summary = summarize([
    { route: "a", ms: 199 }, { route: "a", ms: 200 },
    { route: "a", ms: 1, status: 429, failure: "HTTP 429" },
    { route: "b", ms: 2, status: 429, failure: "HTTP 429" },
    { route: "b", ms: 5000, failure: "timeout" },
    { route: "b", ms: 3, status: 503, failure: "HTTP 503" },
    { route: "b", ms: 4, failure: "transport" },
    { route: "b", ms: 5, status: 200, failure: "invalid-response" },
  ]);
  expect(summary.failures).toEqual({ "HTTP 429": 2, timeout: 1, "HTTP 503": 1, transport: 1, "invalid-response": 1 });
  expect(summary.successfulUnder200).toBe(1 / 8);
  expect(summary.serverErrors).toBe(1);
  expect(summary.overall).toEqual({ count: 8, p50: 4, p95: 5000, p99: 5000 });
  expect(summary.byRoute.a?.count).toBe(3);
  expect(summarize([]).successfulUnder200).toBe(0);
});

// A virtual scheduler advances only after all work at the current instant settles.
// The HTTP handler and score validation are real; no sockets or wall-clock deaths.
async function virtualRun(players: number, seconds: number, transform?: (response: Response, url: string, init: RequestInit) => Response | Promise<Response>, interruptAt?: number) {
  let now = 0, done = false;
  const db = openDb(":memory:");
  const app = createApp(db, { now: () => now, startLimit: 10000 });
  const waits = new Set<{ at: number; wake: () => void }>();
  const calls: { at: number; url: string; init: RequestInit }[] = [];
  const controller = new AbortController();
  const runtime: Runtime = {
    now: () => now,
    sleep: (ms, signal) => new Promise(resolve => {
      const wait = { at: now + ms, wake: () => { waits.delete(wait); signal.removeEventListener("abort", wait.wake); resolve(); } };
      waits.add(wait); signal.addEventListener("abort", wait.wake, { once: true });
      if (signal.aborted) wait.wake();
    }),
    fetch: async (url, init) => {
      calls.push({ at: now, url, init });
      const response = await app.request(url, init);
      return transform ? transform(response, url, init) : response;
    },
  };
  try {
    const task = runLoad({ url: "http://load.test", players, seconds }, runtime, controller.signal).finally(() => { done = true; });
    for (let steps = 0; !done; steps++) {
      if (steps > 100) throw new Error("Workload failed to drain");
      await Bun.sleep(0); // Flush async Hono/body work before advancing time.
      if (done) break;
      expect(waits.size).toBeGreaterThan(0);
      now = Math.min(...[...waits].map(wait => wait.at));
      if (interruptAt !== undefined && now >= interruptAt) controller.abort();
      for (const wait of [...waits]) if (wait.at <= now) wait.wake();
    }
    const result = await task;
    expect(waits.size).toBe(0);
    expect(calls.every(call => call.at < seconds * 1000)).toBe(true);
    return { result, calls, events: countEvents(db) };
  } finally { controller.abort(); db.close(); }
}

test("workload uses valid identities, plausible scores, death/save reads, 2s polling and a 5s observer", async () => {
  const { result, calls, events } = await virtualRun(3, 12);
  expect(result.passed).toBe(true);
  expect(result.acceptedStarts).toBe(3); expect(result.acceptedFinishes).toBe(3);
  expect(events).toEqual({ opened: 0, run_started: 3, run_ended: 3 });
  const starts = calls.filter(call => call.url.endsWith("/api/runs"));
  const ids = starts.map(call => JSON.parse(String(call.init.body)));
  expect(new Set(ids.map(identity => identity.playerId)).size).toBe(3);
  ids.forEach((identity, index) => {
    expect(isId(identity.playerId)).toBe(true);
    expect(identity.name).toMatch(/^load-[a-f0-9]{11}$/);
    expect(validateName(identity.name).error).toBeUndefined();
    expect(identity.team).toBe(TEAMS[index % TEAMS.length]!);
  });
  expect(calls.filter(call => call.url.endsWith("/finish")).map(call => JSON.parse(String(call.init.body))))
    .toEqual(ids.map((identity, index) => makeFinish(identity.playerId, index, 4000)));
  expect(calls.filter(call => call.url.endsWith("/best"))).toHaveLength(6);
  const leaders = calls.filter(call => call.url.endsWith("/leaderboard"));
  for (const at of [0, 5000, 10000]) expect(leaders.filter(call => call.at === at).length).toBeGreaterThanOrEqual(1);
  expect(leaders.filter(call => call.at === 4000)).toHaveLength(6);
  expect(leaders.filter(call => call.at === 6000)).toHaveLength(3);
  expect(leaders.filter(call => call.at === 8000)).toHaveLength(3);
  expect(leaders.filter(call => call.at === 10000)).toHaveLength(4);
  expect(calls.every(call => call.init.redirect === "manual" && call.init.cache === "no-store")).toBe(true);
  expect(formatSummary(result)).toContain("Capacity result: PASS");
});

test("default death delays vary from 5 to 15 seconds", async () => {
  const { calls, result } = await virtualRun(11, 60);
  expect(result.passed).toBe(true);
  expect(calls.filter(call => call.url.endsWith("/finish")).map(call => call.at).sort((a, b) => a - b)).toEqual(Array.from({ length: 11 }, (_, i) => (5 + i) * 1000));
});

test("fast rate rejections, malformed successful bodies and transport errors cannot pass", async () => {
  for (const mode of ["429", "html", "shape", "transport"]) {
    const { result, calls } = await virtualRun(1, 3, (_response, url) => {
      if (!url.endsWith("/api/runs")) return _response;
      if (mode === "transport") throw new Error("connection reset");
      return new Response(mode === "html" ? "<html>" : "{}", { status: mode === "429" ? 429 : 201 });
    });
    expect(result.passed).toBe(false); expect(result.acceptedStarts).toBe(0);
    expect(result.acceptedFinishes).toBe(0);
    expect(calls.some(call => call.url.endsWith("/finish"))).toBe(false);
    expect(result.failures[mode === "429" ? "HTTP 429" : mode === "transport" ? "transport" : "invalid-response"]).toBe(1);
  }
});

test("invalid finish acknowledgement fails without a post-save refresh; interruption drains and reports incomplete runs", async () => {
  const malformed = await virtualRun(1, 6, (response, url) => url.endsWith("/finish") ? new Response('{"saved":false}') : response);
  expect(malformed.result.passed).toBe(false);
  expect(malformed.result.acceptedFinishes).toBe(0);
  expect(malformed.calls.filter(call => call.url.endsWith("/best"))).toHaveLength(1);
  const interrupted = await virtualRun(1, 60, undefined, 5000);
  expect(interrupted.result.passed).toBe(false);
  expect(interrupted.result.acceptedStarts).toBe(1);
  expect(interrupted.result.acceptedFinishes).toBe(0);
  expect(formatSummary(interrupted.result)).toContain("Capacity result: FAIL");
});

test("player helpers keep the load prefix and imported scoring rules", () => {
  expect(makePlayer(0).name).toMatch(/^load-[a-f0-9]{11}$/);
  expect(makeFinish("player", 2, 5999)).toEqual({ playerId: "player", seconds: 5, squashes: 15, score: 155, touch: true, upgrades: [] });
});

test("five-second deadline covers response body and drains requests past the scheduling deadline", async () => {
  const { result, calls } = await virtualRun(1, 3, (response, url, init) => {
    if (!url.endsWith("/api/runs")) return response;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"runId":'));
        init.signal!.addEventListener("abort", () => controller.error(new Error("aborted body")), { once: true });
      },
    }), { status: 201 });
  });
  expect(result.failures).toEqual({ timeout: 1 });
  expect(result.byRoute["POST /api/runs"]?.p99).toBe(5000);
  expect(result.schedulingMs).toBe(3000);
  expect(result.drainMs).toBe(2000);
  expect(result.passed).toBe(false);
  expect(calls.filter(call => call.url.endsWith("/api/runs"))).toHaveLength(1);
});
