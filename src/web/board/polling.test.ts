import { expect, test } from "bun:test";
import type { Leader, TeamTotals } from "../../shared/api";
import { BoardController } from "./polling";
import { deferred, FakeScheduler, flush } from "./polling.test-support";

const entry = (playerId = "a", score = 42): Leader => ({ playerId, name: "Robot", score });
function fixture() {
  const clock = new FakeScheduler(), leaders: ReturnType<typeof deferred<Leader[]>>[] = [], teams: ReturnType<typeof deferred<TeamTotals>>[] = [];
  const logs: unknown[][] = [];
  const controller = new BoardController({
    leaders: () => { const request = deferred<Leader[]>(); leaders.push(request); return request.promise; },
    teams: () => { const request = deferred<TeamTotals>(); teams.push(request); return request.promise; },
  }, clock, (...args) => { logs.push(args); });
  return { clock, controller, leaders, teams, logs };
}

test("reads immediately and every two seconds, publishes independently, retains good data on malformed reads", async () => {
  const { clock, controller: c, leaders, teams, logs } = fixture();
  c.start(); c.start(); await flush();
  expect(leaders).toHaveLength(1); expect(teams).toHaveLength(1);
  teams[0]!.resolve({ tabs: 2, spaces: 1 }); await flush();
  expect(c.getSnapshot().teams.data?.totals.tabs).toBe(2); expect(c.getSnapshot().leaders.data).toBeNull();
  leaders[0]!.resolve([entry()]); await flush();
  await clock.tick(1999); expect(leaders).toHaveLength(1);
  await clock.tick(1); expect(leaders).toHaveLength(2); expect(teams).toHaveLength(2);
  leaders[1]!.resolve([{ ...entry(), name: "<script>" }]); teams[1]!.resolve({ tabs: 0, spaces: 0 }); await flush();
  expect(c.getSnapshot().leaders.data?.[0]?.name).toBe("Robot"); expect(c.getSnapshot().leaders.failed).toBe(true);
  expect(c.getSnapshot().teams.data?.totals).toEqual({ tabs: 0, spaces: 0 }); expect(logs[0]?.[0]).toBe("leaders");
  c.stop(); expect(clock.timers.size).toBe(0);
});

test("failure retries follow 2, 4, 8, 8 seconds, log once, and recover without delaying the other endpoint", async () => {
  const { clock, controller: c, leaders, teams, logs } = fixture();
  c.start(); await flush(); leaders[0]!.resolve([entry()]); teams[0]!.resolve({ tabs: 10, spaces: 0 }); await flush();
  await clock.tick(2000); leaders[1]!.reject(new Error("offline")); await flush();
  let attempts = 2;
  for (const delay of [2000, 4000, 8000, 8000]) {
    await clock.tick(delay - 1); expect(leaders).toHaveLength(attempts);
    await clock.tick(1); expect(leaders).toHaveLength(++attempts);
    if (delay === 8000 && attempts === 6) break;
    leaders.at(-1)!.reject(new Error("still offline")); await flush();
  }
  expect(logs).toHaveLength(1); expect(teams.length).toBeGreaterThan(10);
  expect(c.getSnapshot().leaders.data?.[0]?.score).toBe(42);
  leaders.at(-1)!.resolve([]); await flush();
  expect(c.getSnapshot().leaders.failed).toBe(false); expect(c.getSnapshot().leaders.data).toEqual([]);
  await clock.tick(2000); expect(leaders).toHaveLength(attempts + 1);
  leaders.at(-1)!.reject(new Error("another outage")); await flush(); expect(logs).toHaveLength(2);
  c.stop();
});

test("newer pending reads allow earlier successes, but applied successes or failures supersede older results", async () => {
  const { clock, controller: c, leaders, teams, logs } = fixture();
  c.start(); await flush(); await clock.tick(2000);
  leaders[0]!.resolve([entry("a", 10)]); await flush();
  expect(c.getSnapshot().leaders.data?.[0]?.score).toBe(10);
  await clock.tick(2000); leaders[2]!.resolve([entry("b", 30)]); await flush();
  leaders[1]!.resolve([entry("a", 20)]); await flush();
  expect(c.getSnapshot().leaders.data?.[0]?.playerId).toBe("b");
  teams[2]!.resolve({ tabs: 1, spaces: 2 }); await flush();
  teams[1]!.reject(new Error("stale failure")); await flush();
  expect(c.getSnapshot().teams.failed).toBe(false); expect(logs).toHaveLength(0);
  await clock.tick(2000); await clock.tick(2000);
  leaders[4]!.reject(new Error("newer failure")); await flush();
  leaders[3]!.resolve([entry("late", 100)]); await flush();
  expect(c.getSnapshot().leaders.failed).toBe(true); expect(c.getSnapshot().leaders.data?.[0]?.playerId).toBe("b");
  expect(c.getSnapshot().leaders.data?.[0]?.highlightUntil).toBe(0);
  c.stop();
});

test("slow 2.5-second responses do not starve; five-second responses allow at most three overlapping reads", async () => {
  for (const latency of [2500, 5000]) {
    const clock = new FakeScheduler(); let calls = 0, active = 0, peak = 0;
    const c = new BoardController({ leaders: () => {
      calls++; const score = calls; peak = Math.max(peak, ++active);
      return new Promise(resolve => clock.setTimeout(() => { active--; resolve([entry("a", score)]); }, latency));
    }, teams: async () => ({ tabs: 0, spaces: 0 }) }, clock);
    c.start(); await clock.tick(10000);
    expect(c.getSnapshot().leaders.data?.[0]?.score).toBeGreaterThanOrEqual(3);
    expect(c.getSnapshot().leaders.failed).toBe(false); expect(peak).toBeLessThanOrEqual(3);
    expect(calls).toBe(6); c.stop();
  }
});

test("cleanup is idempotent; old lifecycle responses cannot publish or reschedule after restart or stop", async () => {
  const { clock, controller: c, leaders, teams } = fixture(); let published = 0;
  const unsubscribe = c.subscribe(() => { published++; });
  c.start(); await flush(); c.stop(); c.stop(); expect(clock.timers.size).toBe(0);
  c.start(); await flush();
  leaders[1]!.resolve([entry("new")]); teams[1]!.resolve({ tabs: 2, spaces: 1 }); await flush();
  const snapshot = c.getSnapshot(), before = published;
  leaders[0]!.resolve([entry("old")]); teams[0]!.reject(new Error("old failure")); await flush();
  expect(c.getSnapshot()).toBe(snapshot); expect(published).toBe(before);
  await clock.tick(2000); c.stop(); unsubscribe();
  leaders[2]!.resolve([entry("stopped")]); teams[2]!.resolve({ tabs: 100, spaces: 200 }); await flush();
  expect(clock.timers.size).toBe(0); expect(c.getSnapshot()).toBe(snapshot);
  expect(published).toBe(before);
});

test("highlights expire after three seconds even during failed polling; failures preserve overtake baselines", async () => {
  const { clock, controller: c, leaders, teams } = fixture();
  c.start(); await flush(); leaders[0]!.resolve([]); teams[0]!.resolve({ tabs: 2, spaces: 1 }); await flush();
  await clock.tick(2000); leaders[1]!.resolve([entry()]); teams[1]!.resolve({ tabs: 2, spaces: 2 }); await flush();
  expect(c.getSnapshot().leaders.data?.[0]?.highlightUntil).toBe(5000);
  await clock.tick(2000); leaders[2]!.reject(new Error("offline")); teams[2]!.reject(new Error("offline")); await flush();
  await clock.tick(1000); expect(c.getSnapshot().leaders.data?.[0]?.highlightUntil).toBe(0);
  await clock.tick(1000); teams[3]!.resolve({ tabs: 2, spaces: 3 }); await flush();
  expect(c.getSnapshot().teams.data?.highlightUntil.spaces).toBe(9000);
  c.stop(); expect(clock.timers.size).toBe(0);
});
