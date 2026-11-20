import { expect, test } from "bun:test";
import type { Best, Finish, Leader, RunStarted, TeamTotals } from "../../shared/api";
import { RateLimitError, TeamConflictError, type GameApi } from "./api";
import { Session } from "./session";
import { request } from "./api";
import { createApp } from "../../server/app";
import { countEvents, getRun, openDb } from "../../server/db";
import { plausible } from "../../server/rules";
import { arenaForViewport } from "./arena";
import { step, IDLE } from "./simulation";

test("every start samples arena once and isolates dimensions from its provider", () => {
  let calls = 0, dimensions = { ...arenaForViewport(390, 844) };
  const api: GameApi = { teams: async () => ({ tabs: 0, spaces: 0 }), start: async () => ({ runId: "arena" }), finish: async () => ({ saved: true }),
    best: async () => ({ best: null }), leaders: async () => [] };
  const session = new Session(identity, api, () => 42, undefined, () => { calls++; return dimensions; });
  const first = session.start();
  dimensions.width = 1;
  expect(first.simulation.arena).toEqual({ width: 450, height: 800 });
  dimensions = { ...arenaForViewport(844, 390) };
  const next = session.start(true);
  expect(calls).toBe(2); expect(next.simulation.arena).toEqual({ width: 800, height: 450 });
  expect(first.simulation.arena).toEqual({ width: 450, height: 800 });
});

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
  { startDelay: 250, responseDelay: 0, finishDelay: 50, pause: 0, restart: true },
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
  const api: GameApi = {
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
    const run = session.start(true), s = run.simulation;
    expect(s.time).toBe(0); expect(run.runId).toBeUndefined();
    while (!s.dead) { step(s, IDLE, 1 / 60); await advanceTo(Math.ceil(s.time * 1000)); }
    await advanceTo(now + scenario.pause);
    const expected = { playerId: identity.playerId, score: s.score, squashes: s.squashes, seconds: s.seconds, touch: true, upgrades: [] };
    expect(expected).toMatchObject({ score: 93, squashes: 8, seconds: 13 });
    session.end(); session.end(); await flush();
    if (scenario.restart) {
      session.start(); // Restart must stay immediate while the old save waits for elapsed time.
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
  const run = session.start(), s = run.simulation;
  s.time = 19.99; s.spawnIn = s.fireIn = Infinity;
  let transitions = 0;
  const unsubscribe = session.subscribe(() => { transitions++; });
  step(s, IDLE, 0.02); session.publishChoice(); session.publishChoice();
  expect(transitions).toBe(1);
  const choice = session.view.choice!, id = choice.offer[0]!;
  expect(Object.isFrozen(choice)).toBe(true); expect(Object.isFrozen(choice.offer)).toBe(true);
  expect(session.choose(run.token + 1, choice.number, id)).toBe(false);
  expect(session.choose(run.token, choice.number - 1, id)).toBe(false);
  expect(session.choose(run.token, choice.number, id, true)).toBe(true);
  expect(session.choose(run.token, choice.number, id)).toBe(false);
  expect(transitions).toBe(2); expect(run.touch).toBe(true);
  session.end(); const summary = session.view.upgrades, result = run.result!;
  expect(result.upgrades).toBe(summary); expect(summary).toEqual([{ id, count: 1 }]);
  expect(Object.isFrozen(summary)).toBe(true); expect(summary.every(Object.isFrozen)).toBe(true);
  expect(() => { (summary[0] as { count: number }).count = 99; }).toThrow();
  session.start(); s.upgrades.counts[id] = 99;
  expect(session.choose(run.token, choice.number, id)).toBe(false);
  start.resolve({ runId: "original" }); await flush();
  expect(finishes[0]?.result).toBe(result); expect(finishes[0]?.result.upgrades).toEqual([{ id, count: 1 }]);
  expect(session.view.upgrades).toEqual([]); expect(session.view.over).toBe(false);
  unsubscribe();
});
function fixture(overrides: Partial<GameApi> = {}) {
  const finishes: { id: string; result: Finish }[] = [], logs: { message: string; error: unknown }[] = [];
  let starts = 0, now = 0;
  const api: GameApi = {
    teams: async () => ({ tabs: 0, spaces: 0 }),
    start: async () => ({ runId: `run-${++starts}` }),
    finish: async (id, result) => { finishes.push({ id, result }); return { saved: true }; },
    best: async () => ({ best: 7 }), leaders: async () => [{ playerId: "other", name: "Server", score: 99 }],
    ...overrides,
  };
  return { session: new Session(identity, api, () => 42, (message, error) => logs.push({ message, error }), undefined, undefined,
    { now: () => now, sleep: async ms => { now += ms; } }), finishes, logs, starts: () => starts };
}

test.each(["before death", "after death", "after restart"])("start refusal %s stays on its local run and never submits", async (when) => {
  const response = deferred<RunStarted>();
  let starts = 0;
  const { session, finishes, logs } = fixture({ start: () => ++starts === 1 ? response.promise : Promise.resolve({ runId: "next" }) });
  const original = session.start();
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
    const next = session.start();
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
    session.start(); expect(session.view.save).toBe("pending"); expect(session.view.over).toBe(false);
  }
});

test("429 after a team-conflict retry remains rate-limited, with no finish or further retry", async () => {
  let starts = 0;
  const { session, finishes } = fixture({ start: async () => {
    if (++starts === 1) throw new TeamConflictError("spaces");
    throw new RateLimitError();
  } });
  const run = session.start(); await flush();
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
  session.start(); session.end(); await flush();
  expect(session.view.save).toBe("failed");
});
test("simulation starts immediately; a death before start response submits exactly once with its own id", async () => {
  const start = deferred<RunStarted>();
  const { session, finishes } = fixture({ start: () => start.promise });
  const run = session.start(true); run.simulation.score = 23; run.simulation.squashes = 2; run.simulation.seconds = 3;
  session.end(); session.end(); expect(session.view.over).toBe(true); expect(finishes).toHaveLength(0);
  start.resolve({ runId: "late" }); await flush();
  expect(finishes).toEqual([{ id: "late", result: { playerId: identity.playerId, score: 23, seconds: 3, squashes: 2, touch: true, upgrades: [] } }]);
  expect(Object.isFrozen(run.result)).toBe(true); expect(session.view.save).toBe("saved");
  expect(session.view.best).toBe(7); expect(session.view.leaders[0]?.score).toBe(99);
});
test("late starts and saves after immediate restart cannot mutate the new run", async () => {
  const first = deferred<RunStarted>(), second = deferred<RunStarted>(); let calls = 0;
  const { session, finishes } = fixture({ start: () => ++calls === 1 ? first.promise : second.promise });
  const old = session.start(); session.end(); session.start();
  first.resolve({ runId: "old" }); second.resolve({ runId: "new" }); await flush();
  expect(finishes[0]?.id).toBe("old"); expect(session.current?.runId).toBe("new");
  expect(session.view.over).toBe(false); expect(session.view.save).toBe("pending"); expect(session.current).not.toBe(old);
});
test("offline start and rejected finish log failures and keep restart usable", async () => {
  const failure = new Error("offline");
  for (const overrides of [{ start: async () => { throw failure; } }, { finish: async () => { throw failure; } }]) {
    const { session, logs } = fixture(overrides);
    const run = session.start(); session.end(); await flush();
    expect(session.view.save).toBe("failed"); expect(logs.some((entry) => entry.error === failure)).toBe(true);
    expect(logs.some((entry) => entry.message.includes(run.runId ?? String(run.token)) && entry.error instanceof Error)).toBe(true);
    session.start(); expect(session.view.over).toBe(false);
  }
});
test("a pending save from an old run never changes current save state", async () => {
  const saved = deferred<{ saved: true }>();
  const { session } = fixture({ finish: () => saved.promise });
  session.start(); session.end(); await flush(); session.start();
  saved.resolve({ saved: true }); await flush(); expect(session.view.save).toBe("pending");
});
test("reads follow the server and stale reads cannot overwrite newer reads or runs", async () => {
  const reads: ReturnType<typeof deferred<Leader[]>>[] = [], bests: ReturnType<typeof deferred<Best>>[] = [];
  const { session } = fixture({
    leaders: () => { const read = deferred<Leader[]>(); reads.push(read); return read.promise; },
    best: () => { const read = deferred<Best>(); bests.push(read); return read.promise; },
  });
  session.start(); session.end(); await flush();
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
  session.start(); reads[5]!.resolve([]); bests[5]!.resolve({ best: 99 }); await flush();
  expect(session.view.leadersStatus).toBe("loading"); expect(session.view.over).toBe(false);
  expect(session.view.bestStatus).toBe("loading");
});
test("failed reads do not misreport an acknowledged save", async () => {
  const bestFailure = new Error("best unavailable"), leadersFailure = new Error("rankings unavailable");
  const { session, logs } = fixture({ best: async () => { throw bestFailure; }, leaders: async () => { throw leadersFailure; } });
  session.start(); session.end(); await flush();
  expect(session.view.save).toBe("saved"); expect(session.view.bestStatus).toBe("failed"); expect(session.view.leadersStatus).toBe("failed");
  expect(logs.some((entry) => entry.error === bestFailure)).toBe(true);
  expect(logs.some((entry) => entry.error === leadersFailure)).toBe(true);
});
test("touch resets between runs and subscriptions preserve the current run", async () => {
  const { session, starts } = fixture();
  const unsubscribe = session.subscribe(() => {});
  if (!session.current) session.start(); unsubscribe();
  const detach = session.subscribe(() => {});
  if (!session.current) session.start(); await flush(); expect(starts()).toBe(1);
  session.touch(); expect(session.current?.touch).toBe(true);
  session.start(); expect(session.current?.touch).toBe(false);
  session.start(true); expect(session.current?.touch).toBe(true); detach();
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
    session.start(); session.end(); await flush();
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
  let callback: (() => void) | undefined, interval = 0, cleared = 0, reads = 0, teamReads = 0;
  globalThis.setInterval = ((fn: () => void, ms: number) => { callback = fn; interval = ms; return 1; }) as typeof setInterval;
  globalThis.clearInterval = (() => { cleared++; }) as typeof clearInterval;
  try {
    const { session } = fixture({ leaders: async () => { reads++; return []; }, teams: async () => { teamReads++; return { tabs: 0, spaces: 0 }; } });
    const detach = session.subscribe(() => {}); session.start(); session.end(); await flush();
    expect(interval).toBe(2000); const before = reads, teamsBefore = teamReads; callback!(); await flush(); expect(reads).toBe(before + 1); expect(teamReads).toBe(teamsBefore + 1);
    detach(); expect(cleared).toBeGreaterThan(0); const stop = session.subscribe(() => {});
    const beforeRestart = cleared; session.start(); expect(cleared).toBeGreaterThan(beforeRestart); stop();
  } finally { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});

test("team reads apply despite newer pending requests, reject stale results, and recover independently", async () => {
  const reads: ReturnType<typeof deferred<TeamTotals>>[] = [];
  const { session, logs } = fixture({ teams: () => {
    const read = deferred<TeamTotals>(); reads.push(read); return read.promise;
  } });
  const run = session.start(); run.simulation.score = 999;
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
  void session.refreshTeams(run); session.start();
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
    session.start(); session.end(); await flush();
    await advanceTo(2500); expect(session.view.teamTotals?.tabs).toBe(99);
    hidden = true; await advanceTo(6500);
    expect(pending.length).toBeGreaterThan(0);
    expect(session.view.teamTotals).toEqual({ tabs: 0, spaces: 0 });
    unavailable = true; await advanceTo(10500); expect(session.view.teamsStatus).toBe("failed");
    unavailable = false; await advanceTo(14500); expect(session.view.teamsStatus).toBe("ready");
  } finally { detach(); globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});
