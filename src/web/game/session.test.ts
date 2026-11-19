import { expect, test } from "bun:test";
import type { Best, Finish, Leader, RunStarted } from "../../shared/api";
import type { GameApi } from "./api";
import { Session } from "./session";

const identity = { playerId: crypto.randomUUID(), name: "Robot" };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture(overrides: Partial<GameApi> = {}) {
  const finishes: { id: string; result: Finish }[] = [], logs: string[] = [];
  let starts = 0;
  const api: GameApi = {
    start: async () => ({ runId: `run-${++starts}` }),
    finish: async (id, result) => { finishes.push({ id, result }); return { saved: true }; },
    best: async () => ({ best: 7 }), leaders: async () => [{ playerId: "other", name: "Server", score: 99 }],
    ...overrides,
  };
  return { session: new Session(identity, api, () => 42, (message) => logs.push(message)), finishes, logs, starts: () => starts };
}
test("simulation starts immediately; a death before start response submits exactly once with its own id", async () => {
  const start = deferred<RunStarted>();
  const { session, finishes } = fixture({ start: () => start.promise });
  const run = session.start(true); run.simulation.score = 23; run.simulation.squashes = 2; run.simulation.seconds = 3;
  session.end(); session.end(); expect(session.view.over).toBe(true); expect(finishes).toHaveLength(0);
  start.resolve({ runId: "late" }); await flush();
  expect(finishes).toEqual([{ id: "late", result: { playerId: identity.playerId, score: 23, seconds: 3, squashes: 2, touch: true } }]);
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
  for (const overrides of [{ start: async () => { throw new Error("offline"); } }, { finish: async () => { throw new Error("offline"); } }]) {
    const { session, logs } = fixture(overrides);
    session.start(); session.end(); await flush();
    expect(session.view.save).toBe("failed"); expect(logs.some((line) => line.startsWith("Score save failed ["))).toBe(true);
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
  reads[1]!.resolve([{ playerId: "a", name: "New", score: 1 }]); bests[1]!.resolve({ best: 1 }); await flush();
  reads[0]!.resolve([{ playerId: "b", name: "Old", score: 99 }]); bests[0]!.resolve({ best: 99 }); await flush();
  expect(session.view.leaders[0]?.name).toBe("New"); expect(session.view.best).toBe(1);
  void session.refreshLeaders(session.current!); session.start(); reads[2]!.resolve([]); await flush();
  expect(session.view.leadersStatus).toBe("loading"); expect(session.view.over).toBe(false);
});
test("failed reads do not misreport an acknowledged save", async () => {
  const { session, logs } = fixture({ best: async () => { throw new Error("read failed"); }, leaders: async () => { throw new Error("read failed"); } });
  session.start(); session.end(); await flush();
  expect(session.view.save).toBe("saved"); expect(session.view.bestStatus).toBe("failed"); expect(session.view.leadersStatus).toBe("failed");
  expect(logs.some((line) => line.includes("Leaderboard read failed"))).toBe(true);
});
test("touch resets between runs and StrictMode-style reattachment doesn't start again", async () => {
  const { session, starts } = fixture();
  const unsubscribe = session.subscribe(() => {});
  if (!session.current) session.start(); unsubscribe();
  const detach = session.subscribe(() => {});
  if (!session.current) session.start(); await flush(); expect(starts()).toBe(1);
  session.touch(); expect(session.current?.touch).toBe(true);
  session.start(); expect(session.current?.touch).toBe(false);
  session.start(true); expect(session.current?.touch).toBe(true); detach();
});
test("game-over polling refreshes every two seconds and stops when detached or restarted", async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let callback: (() => void) | undefined, interval = 0, cleared = 0, reads = 0;
  globalThis.setInterval = ((fn: () => void, ms: number) => { callback = fn; interval = ms; return 1; }) as typeof setInterval;
  globalThis.clearInterval = (() => { cleared++; }) as typeof clearInterval;
  try {
    const { session } = fixture({ leaders: async () => { reads++; return []; } });
    const detach = session.subscribe(() => {}); session.start(); session.end(); await flush();
    expect(interval).toBe(2000); const before = reads; callback!(); await flush(); expect(reads).toBe(before + 1);
    session.start(); expect(cleared).toBeGreaterThan(0); detach();
  } finally { globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});
