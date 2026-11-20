import { expect, test } from "bun:test";
import type { Best, Finish, Leader, RunStarted, Standing, TeamTotals } from "../../shared/api";
import { RateLimitError, TeamConflictError, type GameApi } from "./api";
import { CHOICE_GUARD_MS, RESTART_GUARD_MS, Session } from "./session";
import { FakeTiming } from "./timing.test-support";
import { request } from "./api";
import { createApp } from "../../server/app";
import { countEvents, getRun, openDb } from "../../server/db";
import { plausible } from "../../server/rules";
import { arenaForViewport } from "./arena";
import { step, IDLE } from "./simulation";

test("every start samples arena once and isolates dimensions from its provider", () => {
  let calls = 0, dimensions = { ...arenaForViewport(390, 844) };
  const api: GameApi = { standing: async () => ({ rank: null, total: 0, next: null }), teams: async () => ({ tabs: 0, spaces: 0 }), start: async () => ({ runId: "arena" }), finish: async () => ({ saved: true }),
    best: async () => ({ best: null }), leaders: async () => [] };
  const session = new Session(identity, api, () => 42, undefined, () => { calls++; return dimensions; });
  const first = startRun(session);
  dimensions.width = 1;
  expect(first.simulation.arena).toEqual({ width: 450, height: 800 });
  dimensions = { ...arenaForViewport(844, 390) };
  const next = startRun(session, true);
  expect(calls).toBe(2); expect(next.simulation.arena).toEqual({ width: 800, height: 450 });
  expect(first.simulation.arena).toEqual({ width: 450, height: 800 });
});

const clocks = new WeakMap<Session, FakeTiming>();
function startRun(session: Session, touch = false) {
  // Existing non-timing scenarios request a fresh run only once input is eligible.
  if (session.view.over) clocks.get(session)!.advance(RESTART_GUARD_MS);
  return session.start(touch)!;
}
const identity = { playerId: crypto.randomUUID(), name: "Robot" };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test.each([
  { startDelay: 250, responseDelay: 0, finishDelay: 50, pause: 0, restart: false },
  { startDelay: 50, responseDelay: 250, finishDelay: 0, pause: 0, restart: false },
  { startDelay: 250, responseDelay: 0, finishDelay: 50, pause: 600000, restart: false },
  { startDelay: 1500, responseDelay: 0, finishDelay: 50, pause: 0, restart: true },
])("honest finishes survive delayed registration without blocking play: %j", async scenario => {
  let now = 0;
  const pending: { at: number; resolve: () => void }[] = [];
  const sleep = (ms: number) => new Promise<void>(resolve => { pending.push({ at: now + ms, resolve }); });
  async function advanceTo(target: number) {
    await flush();
    for (;;) {
      pending.sort((a, b) => a.at - b.at);
      if (!pending.length || pending[0]!.at > target) break;
      const next = pending.shift()!;
      now = next.at; next.resolve(); await flush();
    }
    now = target; await flush();
  }
  const db = openDb(":memory:"), app = createApp(db, { now: () => Math.floor(now) });
  const submitted: Finish[] = [], statuses: number[] = [], errors: unknown[] = [], waits: number[] = [];
  const fetcher = async (path: string, init?: RequestInit) => {
    const start = path === "/api/runs", finish = path.endsWith("/finish");
    if (start) await sleep(scenario.startDelay);
    if (finish) { submitted.push(JSON.parse(String(init?.body)) as Finish); await sleep(scenario.finishDelay); }
    const response = await app.request(path, init);
    if (start) await sleep(scenario.responseDelay);
    if (finish) statuses.push(response.status);
    return response;
  };
  const api: GameApi = { standing: async () => ({ rank: null, total: 0, next: null }),
    start: identity => request("/api/runs", identity, fetcher),
    finish: (id, result) => request(`/api/runs/${id}/finish`, result, fetcher),
    best: id => request(`/api/players/${id}/best`, undefined, fetcher),
    leaders: () => request("/api/leaderboard", undefined, fetcher),
    teams: () => request("/api/teams", undefined, fetcher),
  };
  const session = new Session({ ...identity, team: "tabs" }, api, () => 42,
    (_message, error) => errors.push(error), () => arenaForViewport(390, 844), undefined,
    { now: () => now, sleep: ms => { waits.push(ms); return sleep(ms); } });
  try {
    const run = session.start(true)!, s = run.simulation;
    expect(s.time).toBe(0); expect(run.runId).toBeUndefined();
    while (!s.dead) { step(s, IDLE, 1 / 60); await advanceTo(Math.ceil(s.time * 1000)); }
    await advanceTo(now + scenario.pause);
    const expected = { playerId: identity.playerId, score: s.score, squashes: s.squashes, seconds: s.seconds, touch: true, upgrades: [] };
    expect(expected).toMatchObject({ score: 93, squashes: 8, seconds: 13 });
    session.end(); session.end(); await flush();
    if (scenario.restart) {
      await advanceTo(now + RESTART_GUARD_MS - 1);
      expect(session.restart(run.token)).toBe(false);
      await advanceTo(now + 1);
      expect(statuses).toEqual([]); // The old save is still waiting for server elapsed time.
      expect(session.restart(run.token)).toBe(true);
      expect(session.view.over).toBe(false);
      await flush();
    }
    await advanceTo(now + 30000);
    expect(errors).toEqual([]); expect(statuses).toEqual([200]);
    expect(submitted).toEqual([expected]); expect(run.result).toEqual(expected);
    expect(countEvents(db).run_ended).toBe(1);
    const stored = getRun(db, run.runId!)!;
    expect(plausible(expected, stored.started_at_ms, stored.ended_at_ms!)).toBe(true);
    expect(await api.best(identity.playerId)).toEqual({ best: expected.score });
    expect(await api.teams()).toEqual({ tabs: expected.score, spaces: 0 });
    expect(await api.leaders()).toEqual([{ playerId: identity.playerId, name: identity.name, score: expected.score }]);
    if (scenario.pause) expect(waits).toEqual([]);
    if (scenario.restart) {
      expect(session.current).not.toBe(run); expect(session.view.over).toBe(false); expect(session.view.save).toBe("pending");
    } else expect(session.view.save).toBe("saved");
  } finally { db.close(); }
});
test("choice publication is immutable and transition-only; stale selections and restarts cannot alter finish builds", async () => {
  const start = deferred<RunStarted>(), { session, finishes } = fixture({ start: () => start.promise });
  const run = startRun(session), s = run.simulation;
  s.time = 19.99; s.spawnIn = s.fireIn = Infinity;
  let transitions = 0;
  const unsubscribe = session.subscribe(() => { transitions++; });
  step(s, IDLE, 0.02); session.publishChoice(); session.publishChoice();
  expect(transitions).toBe(1);
  const choice = session.view.choice!, id = choice.offer[0]!;
  expect(Object.isFrozen(choice)).toBe(true); expect(Object.isFrozen(choice.offer)).toBe(true);
  expect(session.choose(run.token + 1, choice.number, id)).toBe(false);
  expect(session.choose(run.token, choice.number - 1, id)).toBe(false);
  clocks.get(session)!.advance(CHOICE_GUARD_MS);
  expect(session.choose(run.token, choice.number, id, true)).toBe(true);
  expect(session.choose(run.token, choice.number, id)).toBe(false);
  expect(transitions).toBe(3); expect(run.touch).toBe(true);
  session.end(); const summary = session.view.upgrades, result = run.result!;
  expect(result.upgrades).toBe(summary); expect(summary).toEqual([{ id, count: 1 }]);
  expect(Object.isFrozen(summary)).toBe(true); expect(summary.every(Object.isFrozen)).toBe(true);
  expect(() => { (summary[0] as { count: number }).count = 99; }).toThrow();
  startRun(session); s.upgrades.counts[id] = 99;
  expect(session.choose(run.token, choice.number, id)).toBe(false);
  start.resolve({ runId: "original" }); await flush();
  expect(finishes[0]?.result).toBe(result); expect(finishes[0]?.result.upgrades).toEqual([{ id, count: 1 }]);
  expect(session.view.upgrades).toEqual([]); expect(session.view.over).toBe(false);
  unsubscribe();
});
function fixture(overrides: Partial<GameApi> = {}) {
  const finishes: { id: string; result: Finish }[] = [], logs: { message: string; error: unknown }[] = [];
  let starts = 0, now = 0;
  const api: GameApi = { standing: async () => ({ rank: null, total: 0, next: null }),
    teams: async () => ({ tabs: 0, spaces: 0 }),
    start: async () => ({ runId: `run-${++starts}` }),
    finish: async (id, result) => { finishes.push({ id, result }); return { saved: true }; },
    best: async () => ({ best: 7 }), leaders: async () => [{ playerId: "other", name: "Server", score: 99 }],
    ...overrides,
  };
  const time = new FakeTiming();
  const session = new Session(identity, api, () => 42, (message, error) => logs.push({ message, error }), undefined, undefined,
    { now: () => now, sleep: async ms => { now += ms; } }, time);
  clocks.set(session, time);
  return { session, time, finishes, logs, starts: () => starts };
}

test.each(["before death", "after death", "after restart"])("start refusal %s stays on its local run and never submits", async (when) => {
  const response = deferred<RunStarted>();
  let starts = 0;
  const { session, finishes, logs } = fixture({ start: () => ++starts === 1 ? response.promise : Promise.resolve({ runId: "next" }) });
  const original = startRun(session);
  expect(session.current).toBe(original); expect(session.view.over).toBe(false);
  if (when === "before death") {
    response.reject(new RateLimitError()); await flush();
    expect(session.current).toBe(original); expect(session.view.over).toBe(false);
    expect(original.result).toBeUndefined(); expect(original.simulation.dead).toBe(false);
    const time = original.simulation.time;
    step(original.simulation, IDLE, 1 / 60);
    expect(original.simulation.time).toBeGreaterThan(time);
  }
  session.end();
  if (when === "after restart") {
    const next = startRun(session);
    expect(session.current).toBe(next); expect(session.view.save).toBe("pending"); expect(session.view.over).toBe(false);
  }
  if (when !== "before death") { response.reject(new RateLimitError()); await flush(); }
  await flush();
  expect(finishes).toHaveLength(0);
  expect(logs.some(log => log.error instanceof RateLimitError)).toBe(true);
  if (when === "after restart") {
    expect(session.view.save).toBe("pending"); expect(session.view.over).toBe(false);
    session.end(); await flush();
    expect(session.view.save).toBe("saved"); expect(finishes.map(finish => finish.id)).toEqual(["next"]);
  } else {
    expect(session.view.save).toBe("rate-limited");
    startRun(session); expect(session.view.save).toBe("pending"); expect(session.view.over).toBe(false);
  }
});

test("429 after a team-conflict retry remains rate-limited, with no finish or further retry", async () => {
  let starts = 0;
  const { session, finishes } = fixture({ start: async () => {
    if (++starts === 1) throw new TeamConflictError("spaces");
    throw new RateLimitError();
  } });
  const run = startRun(session); await flush();
  expect(starts).toBe(2); expect(session.identity.team).toBe("spaces");
  expect(session.current).toBe(run); expect(session.view.over).toBe(false);
  expect(run.result).toBeUndefined(); expect(run.simulation.dead).toBe(false);
  const time = run.simulation.time;
  step(run.simulation, IDLE, 1 / 60);
  expect(run.simulation.time).toBeGreaterThan(time);
  session.end(); await flush();
  expect(session.view.save).toBe("rate-limited"); expect(finishes).toHaveLength(0);
});

test("a finish refusal keeps generic save failure feedback", async () => {
  const { session } = fixture({ finish: async () => { throw new RateLimitError(); } });
  startRun(session); session.end(); await flush();
  expect(session.view.save).toBe("failed");
});
test("simulation starts immediately; a death before start response submits exactly once with its own id", async () => {
  const start = deferred<RunStarted>();
  const { session, finishes } = fixture({ start: () => start.promise });
  const run = startRun(session, true); run.simulation.score = 23; run.simulation.squashes = 2; run.simulation.seconds = 3;
  session.end(); session.end(); expect(session.view.over).toBe(true); expect(finishes).toHaveLength(0);
  start.resolve({ runId: "late" }); await flush();
  expect(finishes).toEqual([{ id: "late", result: { playerId: identity.playerId, score: 23, seconds: 3, squashes: 2, touch: true, upgrades: [] } }]);
  expect(Object.isFrozen(run.result)).toBe(true); expect(session.view.save).toBe("saved");
  expect(session.view.best).toBe(7); expect(session.view.leaders[0]?.score).toBe(99);
});
test("late starts and saves after an eligible restart cannot mutate the new run", async () => {
  const first = deferred<RunStarted>(), second = deferred<RunStarted>(); let calls = 0;
  const { session, finishes } = fixture({ start: () => ++calls === 1 ? first.promise : second.promise });
  const old = startRun(session); session.end(); startRun(session);
  first.resolve({ runId: "old" }); second.resolve({ runId: "new" }); await flush();
  expect(finishes[0]?.id).toBe("old"); expect(session.current?.runId).toBe("new");
  expect(session.view.over).toBe(false); expect(session.view.save).toBe("pending"); expect(session.current).not.toBe(old);
});
test("offline start and rejected finish log failures and keep restart usable", async () => {
  const failure = new Error("offline");
  for (const overrides of [{ start: async () => { throw failure; } }, { finish: async () => { throw failure; } }]) {
    const { session, logs } = fixture(overrides);
    const run = startRun(session); session.end(); await flush();
    expect(session.view.save).toBe("failed"); expect(logs.some((entry) => entry.error === failure)).toBe(true);
    expect(logs.some((entry) => entry.message.includes(run.runId ?? String(run.token)) && entry.error instanceof Error)).toBe(true);
    startRun(session); expect(session.view.over).toBe(false);
  }
});
test("a pending save from an old run never changes current save state", async () => {
  const saved = deferred<{ saved: true }>();
  const { session } = fixture({ finish: () => saved.promise });
  startRun(session); session.end(); await flush(); startRun(session);
  saved.resolve({ saved: true }); await flush(); expect(session.view.save).toBe("pending");
});
test("reads follow the server and stale reads cannot overwrite newer reads or runs", async () => {
  const reads: ReturnType<typeof deferred<Leader[]>>[] = [], bests: ReturnType<typeof deferred<Best>>[] = [];
  const { session } = fixture({
    leaders: () => { const read = deferred<Leader[]>(); reads.push(read); return read.promise; },
    best: () => { const read = deferred<Best>(); bests.push(read); return read.promise; },
  });
  startRun(session); session.end(); await flush();
  expect(reads).toHaveLength(2); // On death, then after the durable save.
  reads[0]!.resolve([{ playerId: "b", name: "Old", score: 99 }]); bests[0]!.resolve({ best: 99 }); await flush();
  expect(session.view.leadersStatus).toBe("ready"); expect(session.view.leaders[0]?.name).toBe("Old");
  expect(session.view.bestStatus).toBe("ready"); expect(session.view.best).toBe(99);
  void session.refreshLeaders(session.current!); void session.refreshBest(session.current!);
  reads[2]!.resolve([{ playerId: "a", name: "New", score: 1 }]); bests[2]!.resolve({ best: 1 }); await flush();
  reads[1]!.resolve([{ playerId: "b", name: "Old", score: 99 }]); bests[1]!.resolve({ best: 99 }); await flush();
  expect(session.view.leaders[0]?.name).toBe("New"); expect(session.view.best).toBe(1);
  void session.refreshLeaders(session.current!); void session.refreshBest(session.current!);
  void session.refreshLeaders(session.current!); void session.refreshBest(session.current!);
  reads[4]!.resolve([]); bests[4]!.resolve({ best: 2 }); await flush();
  reads[3]!.reject(new Error("stale")); bests[3]!.reject(new Error("stale")); await flush();
  expect(session.view.leadersStatus).toBe("ready"); expect(session.view.bestStatus).toBe("ready");
  expect(session.view.best).toBe(2);
  void session.refreshLeaders(session.current!); void session.refreshBest(session.current!);
  startRun(session); reads[5]!.resolve([]); bests[5]!.resolve({ best: 99 }); await flush();
  expect(session.view.leadersStatus).toBe("loading"); expect(session.view.over).toBe(false);
  expect(session.view.bestStatus).toBe("loading");
});
test("failed reads do not misreport an acknowledged save", async () => {
  const bestFailure = new Error("best unavailable"), leadersFailure = new Error("rankings unavailable");
  const { session, logs } = fixture({ best: async () => { throw bestFailure; }, leaders: async () => { throw leadersFailure; } });
  startRun(session); session.end(); await flush();
  expect(session.view.save).toBe("saved"); expect(session.view.bestStatus).toBe("failed"); expect(session.view.leadersStatus).toBe("failed");
  expect(logs.some((entry) => entry.error === bestFailure)).toBe(true);
  expect(logs.some((entry) => entry.error === leadersFailure)).toBe(true);
});
test("touch resets between runs and subscriptions preserve the current run", async () => {
  const { session, starts } = fixture();
  const unsubscribe = session.subscribe(() => {});
  if (!session.current) startRun(session); unsubscribe();
  const detach = session.subscribe(() => {});
  if (!session.current) startRun(session); await flush(); expect(starts()).toBe(1);
  session.touch(); expect(session.current?.touch).toBe(true);
  startRun(session); expect(session.current?.touch).toBe(false);
  startRun(session, true); expect(session.current?.touch).toBe(true); detach();
});

test("2500 ms leaderboard responses apply across 2000 ms polls, including a hidden row's removal", async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let now = 0, nextPoll = Infinity, poll: (() => void) | undefined, hidden = false, unavailable = false;
  const pending: { at: number; rows: Leader[]; failed: boolean; reply: ReturnType<typeof deferred<Leader[]>> }[] = [];
  globalThis.setInterval = ((fn: () => void, ms: number) => {
    expect(ms).toBe(2000); poll = fn; nextPoll = now + ms; return 1;
  }) as typeof setInterval;
  globalThis.clearInterval = (() => { poll = undefined; nextPoll = Infinity; }) as typeof clearInterval;
  const { session } = fixture({ leaders: () => {
    const reply = deferred<Leader[]>();
    pending.push({ at: now + 2500, rows: hidden ? [] : [{ playerId: "a", name: "Visible", score: 99 }], failed: unavailable, reply });
    return reply.promise;
  } });
  const detach = session.subscribe(() => {});
  async function advanceTo(time: number) {
    while (Math.min(nextPoll, pending[0]?.at ?? Infinity) <= time) {
      now = Math.min(nextPoll, pending[0]?.at ?? Infinity);
      if (nextPoll === now) { nextPoll += 2000; poll!(); }
      while (pending[0]?.at === now) {
        const read = pending.shift()!;
        if (read.failed) read.reply.reject(new Error("unavailable")); else read.reply.resolve(read.rows);
      }
      await flush();
    }
    now = time;
  }
  try {
    startRun(session); session.end(); await flush();
    await advanceTo(2500);
    expect(session.view.leadersStatus).toBe("ready"); expect(session.view.leaders[0]?.name).toBe("Visible");
    hidden = true;
    await advanceTo(6500);
    expect(pending.length).toBeGreaterThan(0); // The next poll is already awaiting its response.
    expect(session.view.leadersStatus).toBe("ready"); expect(session.view.leaders).toEqual([]);
    await advanceTo(7800); expect(session.view.leaders).toEqual([]);
    unavailable = true; await advanceTo(10500); expect(session.view.leadersStatus).toBe("failed");
    unavailable = false; await advanceTo(14500); expect(session.view.leadersStatus).toBe("ready");
    expect(session.view.leaders).toEqual([]);
  } finally { detach(); globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});
test("game-over polling refreshes every two seconds and stops when detached or restarted", async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let callback: (() => void) | undefined, interval = 0, cleared = 0, reads = 0, teamReads = 0, standingReads = 0;
  globalThis.setInterval = ((fn: () => void, ms: number) => { callback = fn; interval = ms; return 1; }) as typeof setInterval;
  globalThis.clearInterval = (() => { cleared++; }) as typeof clearInterval;
  try {
    const { session } = fixture({ standing: async () => { standingReads++; return { rank: null, total: 0, next: null }; }, leaders: async () => { reads++; return []; }, teams: async () => { teamReads++; return { tabs: 0, spaces: 0 }; } });
    const detach = session.subscribe(() => {}); startRun(session); session.end(); await flush();
    expect(interval).toBe(2000); expect(standingReads).toBe(2); const standingBefore = standingReads; const before = reads, teamsBefore = teamReads; callback!(); await flush(); expect(reads).toBe(before + 1); expect(teamReads).toBe(teamsBefore + 1); expect(standingReads).toBe(standingBefore + 1);
    detach(); expect(cleared).toBeGreaterThan(0); const stop = session.subscribe(() => {});
    const beforeRestart = cleared; startRun(session); expect(cleared).toBeGreaterThan(beforeRestart); stop();
  } finally { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});

test("team reads apply despite newer pending requests, reject stale results, and recover independently", async () => {
  const reads: ReturnType<typeof deferred<TeamTotals>>[] = [];
  const { session, logs } = fixture({ teams: () => {
    const read = deferred<TeamTotals>(); reads.push(read); return read.promise;
  } });
  const run = startRun(session); run.simulation.score = 999;
  session.end(); await flush();
  expect(reads).toHaveLength(2); // Death and acknowledged save each refresh.
  expect(session.view.teamTotals).toBeNull();
  reads[0]!.resolve({ tabs: 1, spaces: 2 }); await flush();
  expect(session.view.teamTotals).toEqual({ tabs: 1, spaces: 2 });
  void session.refreshTeams(run);
  reads[2]!.resolve({ tabs: 0, spaces: 1 }); await flush();
  reads[1]!.reject(new Error("stale failure")); await flush();
  expect(session.view.teamTotals).toEqual({ tabs: 0, spaces: 1 });
  void session.refreshTeams(run); void session.refreshTeams(run);
  reads[4]!.resolve({ tabs: 0, spaces: 0 }); await flush();
  reads[3]!.resolve({ tabs: 999, spaces: 999 }); await flush();
  expect(session.view.teamTotals).toEqual({ tabs: 0, spaces: 0 });
  void session.refreshTeams(run);
  const failure = new Error("offline");
  reads[5]!.reject(failure); await flush();
  expect(session.view.teamsStatus).toBe("failed"); expect(session.view.teamTotals).toBeNull();
  expect(session.view.save).toBe("saved"); expect(session.view.best).toBe(7);
  expect(session.view.leaders[0]?.score).toBe(99);
  expect(logs.some(log => log.error === failure && log.message.includes("run-1"))).toBe(true);
  void session.refreshTeams(run);
  reads[6]!.resolve({ tabs: 3, spaces: 4 }); await flush();
  expect(session.view.teamsStatus).toBe("ready");
  void session.refreshTeams(run); startRun(session);
  reads[7]!.resolve({ tabs: 99, spaces: 99 }); await flush();
  expect(session.view.teamTotals).toBeNull(); expect(session.view.teamsStatus).toBe("loading");
});

test("slow team polls apply without starvation and remove hidden totals within five seconds", async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let now = 0, nextPoll = Infinity, poll: (() => void) | undefined, hidden = false, unavailable = false;
  const pending: { at: number; totals: TeamTotals; failed: boolean; reply: ReturnType<typeof deferred<TeamTotals>> }[] = [];
  globalThis.setInterval = ((fn: () => void) => { poll = fn; nextPoll = now + 2000; return 1; }) as typeof setInterval;
  globalThis.clearInterval = (() => { poll = undefined; nextPoll = Infinity; }) as typeof clearInterval;
  const { session } = fixture({ teams: () => {
    const reply = deferred<TeamTotals>();
    pending.push({ at: now + 2500, totals: { tabs: hidden ? 0 : 99, spaces: 0 }, failed: unavailable, reply });
    return reply.promise;
  } });
  const detach = session.subscribe(() => {});
  async function advanceTo(time: number) {
    while (Math.min(nextPoll, pending[0]?.at ?? Infinity) <= time) {
      now = Math.min(nextPoll, pending[0]?.at ?? Infinity);
      if (nextPoll === now) { nextPoll += 2000; poll!(); }
      while (pending[0]?.at === now) {
        const read = pending.shift()!;
        if (read.failed) read.reply.reject(new Error("unavailable")); else read.reply.resolve(read.totals);
      }
      await flush();
    }
    now = time;
  }
  try {
    startRun(session); session.end(); await flush();
    await advanceTo(2500); expect(session.view.teamTotals?.tabs).toBe(99);
    hidden = true; await advanceTo(6500);
    expect(pending.length).toBeGreaterThan(0);
    expect(session.view.teamTotals).toEqual({ tabs: 0, spaces: 0 });
    unavailable = true; await advanceTo(10500); expect(session.view.teamsStatus).toBe("failed");
    unavailable = false; await advanceTo(14500); expect(session.view.teamsStatus).toBe("ready");
  } finally { detach(); globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});

test("restart rejects through 799ms without effects and accepts at 800ms, independent of saves", async () => {
  const pending = deferred<RunStarted>();
  let startCalls = 0;
  const { session, time } = fixture({ start: () => { startCalls++; return pending.promise; } });
  const run = session.start()!; session.end(); await flush();
  expect(startCalls).toBe(1);
  const view = session.view, result = run.result;
  for (const elapsed of [0, 799]) {
    time.advance(elapsed);
    expect(session.canRestart(run.token)).toBe(false);
    expect(session.restart(run.token, true)).toBe(false);
    expect(session.start(true)).toBeNull(); session.end();
    expect(session.view).toBe(view); expect(session.current).toBe(run);
    expect(run.touch).toBe(false); expect(run.result).toBe(result);
  }
  // No subscribers/timer: eligibility still comes from the authoritative clock.
  expect(time.pending.size).toBe(0); time.advance(1);
  expect(session.restart(run.token - 1)).toBe(false);
  expect(session.canRestart(run.token)).toBe(true);
  expect(session.restart(run.token, true)).toBe(true);
  expect(session.current!.touch).toBe(true); expect(session.view.over).toBe(false);
  expect(session.restart(run.token)).toBe(false);
  await flush(); expect(startCalls).toBe(2);
  pending.resolve({ runId: "late" }); await flush();
  expect(session.view.save).toBe("pending");
});

test("choice rejects through 349ms, preserves identity on duplicate publication and accepts at 350ms", () => {
  const { session, time } = fixture(); const run = session.start()!, s = run.simulation;
  s.time = 19.99; s.spawnIn = s.fireIn = Infinity; step(s, IDLE, 0.02); session.publishChoice();
  const choice = session.view.choice!, frozen = structuredClone(s);
  for (const elapsed of [0, 349]) {
    time.advance(elapsed); session.publishChoice();
    expect(session.view.choice).toBe(choice);
    expect(session.choose(run.token, choice.number, choice.offer[0]!, true)).toBe(false);
    expect(s).toEqual(frozen); expect(run.touch).toBe(false);
  }
  time.advance(1);
  expect(session.choose(run.token + 1, choice.number, choice.offer[0]!)).toBe(false);
  expect(session.choose(run.token, choice.number + 1, choice.offer[0]!)).toBe(false);
  expect(session.choose(run.token, choice.number, choice.offer[0]!)).toBe(true);
  expect(s.time).toBe(20);
  s.time = 39.99; step(s, IDLE, 0.02); session.publishChoice();
  expect(session.view.choiceReady).toBe(false);
  expect(session.canChoose(run.token, session.view.choice!.number)).toBe(false);
});

test("readiness publishes once without input, API requests or poll resets; early timers reschedule the remainder", async () => {
  let reads = 0;
  const { session, time } = fixture({ leaders: async () => { reads++; return []; } });
  let notifications = 0; const detach = session.subscribe(() => { notifications++; });
  try {
    session.start(); session.end(); await flush(); const before = notifications, requests = reads;
    const timer = [...time.pending.values()][0]!; expect(timer.at).toBe(800);
    time.time = 100; timer.callback();
    expect(session.view.restartReady).toBe(false);
    expect([...time.pending.values()][0]!.at).toBe(800);
    time.advance(699); expect(notifications).toBe(before);
    time.advance(1); expect(session.view.restartReady).toBe(true); expect(notifications).toBe(before + 1);
    expect(reads).toBe(requests); expect(time.pending.size).toBe(0);
    time.advance(100); expect(notifications).toBe(before + 1);
  } finally { detach(); }
});

test("detach/reattach retains deadlines and obsolete callbacks cannot publish on a new transition", () => {
  const { session, time } = fixture();
  let detach = session.subscribe(() => {});
  const run = session.start()!, s = run.simulation;
  s.time = 19.99; step(s, IDLE, 0.02); session.publishChoice();
  const choiceTimer = [...time.pending.values()][0]!.callback;
  time.advance(100); detach(); expect(time.pending.size).toBe(0);
  choiceTimer(); expect(time.pending.size).toBe(0);
  detach = session.subscribe(() => {});
  expect([...time.pending.values()][0]!.at).toBe(350);
  time.advance(250); expect(session.view.choiceReady).toBe(true);
  session.end(); expect(session.view.choiceReady).toBe(false);
  expect(time.pending.size).toBe(1); choiceTimer(); expect(session.view.restartReady).toBe(false);
  const deathTimer = [...time.pending.values()][0]!.callback;
  detach(); time.advance(800); expect(session.view.restartReady).toBe(false);
  detach = session.subscribe(() => {}); expect(session.view.restartReady).toBe(true);
  session.restart(run.token); deathTimer();
  expect(session.view.restartReady).toBe(false); expect(time.pending.size).toBe(0);
  detach();
});

test("replacement and accepted selection cancel choice timers; death supersedes a choice with a full restart guard", () => {
  const { session, time } = fixture(); const detach = session.subscribe(() => {});
  try {
    const offer = () => { const s = session.current!.simulation; s.time = 19.99; step(s, IDLE, 0.02); session.publishChoice(); };
    session.start(); offer(); const stale = [...time.pending.values()][0]!.callback;
    session.start(); expect(time.pending.size).toBe(0); stale(); expect(session.view.choiceReady).toBe(false);
    offer(); time.time += 350;
    const choice = session.view.choice!; expect(session.choose(session.view.token, choice.number, choice.offer[0]!)).toBe(true);
    expect(time.pending.size).toBe(0);
    session.start(); offer(); time.advance(100); session.end();
    time.advance(799); expect(session.canRestart(session.view.token)).toBe(false);
    time.advance(1); expect(session.view.restartReady).toBe(true);
  } finally { detach(); }
});

test("standing reads apply despite newer pending requests, reject stale results, and recover independently", async () => {
  const reads: ReturnType<typeof deferred<Standing>>[] = [];
  const { session, logs } = fixture({ standing: () => {
    const read = deferred<Standing>(); reads.push(read); return read.promise;
  } });
  const run = startRun(session); run.simulation.score = 999;
  session.end(); await flush();
  expect(reads).toHaveLength(2); // Death and acknowledged save each refresh.
  expect(session.view.standing).toBeNull();
  reads[0]!.resolve({ rank: 37, total: 214, next: { rank: 36, pointsToBeat: 120 } }); await flush();
  expect(session.view.standing).toEqual({ rank: 37, total: 214, next: { rank: 36, pointsToBeat: 120 } });
  void session.refreshStanding(run);
  reads[2]!.resolve({ rank: 10, total: 214, next: { rank: 9, pointsToBeat: 1 } }); await flush();
  reads[1]!.reject(new Error("stale failure")); await flush();
  expect(session.view.standing).toEqual({ rank: 10, total: 214, next: { rank: 9, pointsToBeat: 1 } });
  void session.refreshStanding(run); void session.refreshStanding(run);
  reads[4]!.resolve({ rank: null, total: 214, next: null }); await flush();
  reads[3]!.resolve({ rank: 99, total: 214, next: { rank: 98, pointsToBeat: 99 } }); await flush();
  expect(session.view.standing).toEqual({ rank: null, total: 214, next: null });
  void session.refreshStanding(run);
  const failure = new Error("offline");
  reads[5]!.reject(failure); await flush();
  expect(session.view.standingStatus).toBe("failed"); expect(session.view.standing).toBeNull();
  expect(session.view.save).toBe("saved"); expect(session.view.best).toBe(7);
  expect(session.view.leaders[0]?.score).toBe(99);
  expect(logs.some(log => log.error === failure && log.message.includes("run-1"))).toBe(true);
  void session.refreshStanding(run);
  reads[6]!.resolve({ rank: 1, total: 214, next: null }); await flush();
  expect(session.view.standingStatus).toBe("ready");
  void session.refreshStanding(run); void session.refreshStanding(run); startRun(session);
  reads[7]!.resolve({ rank: 99, total: 214, next: { rank: 98, pointsToBeat: 99 } });
  reads[8]!.reject(new Error("late failure after restart")); await flush();
  expect(session.view.standing).toBeNull(); expect(session.view.standingStatus).toBe("loading");
});

test("slow standing polls apply without starvation and remove hidden standings within five seconds", async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let now = 0, nextPoll = Infinity, poll: (() => void) | undefined, hidden = false, unavailable = false;
  const pending: { at: number; totals: Standing; failed: boolean; reply: ReturnType<typeof deferred<Standing>> }[] = [];
  globalThis.setInterval = ((fn: () => void) => { poll = fn; nextPoll = now + 2000; return 1; }) as typeof setInterval;
  globalThis.clearInterval = (() => { poll = undefined; nextPoll = Infinity; }) as typeof clearInterval;
  const { session } = fixture({ standing: () => {
    const reply = deferred<Standing>();
    pending.push({ at: now + 2500, totals: { rank: hidden ? null : 1, total: hidden ? 0 : 1, next: null }, failed: unavailable, reply });
    return reply.promise;
  } });
  const detach = session.subscribe(() => {});
  async function advanceTo(time: number) {
    while (Math.min(nextPoll, pending[0]?.at ?? Infinity) <= time) {
      now = Math.min(nextPoll, pending[0]?.at ?? Infinity);
      if (nextPoll === now) { nextPoll += 2000; poll!(); }
      while (pending[0]?.at === now) {
        const read = pending.shift()!;
        if (read.failed) read.reply.reject(new Error("unavailable")); else read.reply.resolve(read.totals);
      }
      await flush();
    }
    now = time;
  }
  try {
    startRun(session); session.end(); await flush();
    await advanceTo(2500); expect(session.view.standing?.rank).toBe(1);
    hidden = true; await advanceTo(6500);
    expect(pending.length).toBeGreaterThan(0);
    expect(session.view.standing).toEqual({ rank: null, total: 0, next: null });
    unavailable = true; await advanceTo(10500); expect(session.view.standingStatus).toBe("failed");
    unavailable = false; await advanceTo(14500); expect(session.view.standingStatus).toBe("ready");
  } finally { detach(); globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});
