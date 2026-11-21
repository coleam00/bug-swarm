import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app";
import { approveRun, countEvents, finishRun, hideName, openDb, startRun } from "./db";
import { BoardController } from "../web/board/polling";
import { FakeScheduler } from "../web/board/polling.test-support";
import { ArenaResults } from "../web/arena/results";
import { request, type ScoresApi } from "../web/api";

test("external approval expires both caches at one second and reaches real board and game-over polls within five", async () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-release-")), path = join(dir, "app.db");
  const db = openDb(path), owner = openDb(path), clock = new FakeScheduler();
  const app = createApp(db, { now: clock.now });
  const fetcher = async (path: string, init?: RequestInit) => app.request(path, init);
  const api: ScoresApi = {
    standing: id => request(`/api/players/${id}/standing`, fetcher),
    best: id => request(`/api/players/${id}/best`, fetcher),
    leaders: () => request("/api/leaderboard", fetcher), teams: () => request("/api/teams", fetcher),
  };
  const board = new BoardController(api, clock);
  const playerId = crypto.randomUUID();
  const results = new ArenaResults(playerId, api, () => {}, { schedule: clock.setTimeout, cancel: clock.clearTimeout });
  const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  try {
    for (let i = 0; i < 10; i++) {
      const playerId = crypto.randomUUID(), started = startRun(db, playerId, `Robot ${i}`, 0, "tabs");
      if ("error" in started) throw new Error(started.error);
      finishRun(db, started.runId, { playerId, score: 100 - i, seconds: 100 - i, squashes: 0, touch: false }, 100000);
    }
    const hiddenPlayer = crypto.randomUUID(), hidden = startRun(db, hiddenPlayer, "Hidden Robot", 0, "spaces");
    if ("error" in hidden) throw new Error(hidden.error);
    finishRun(db, hidden.runId, { playerId: hiddenPlayer, score: 13800, seconds: 300, squashes: 1350, touch: false }, 300000);
    hideName(owner, "Hidden Robot", 300000);
    const run = startRun(db, playerId, "Review Robot", 0, "spaces");
    if ("error" in run) throw Error(run.error);
    finishRun(db, run.runId, { playerId, score: 13800, seconds: 300, squashes: 1350, touch: false }, 300000);
    clock.time = 300000;
    results.show({ v: 1, type: "life_over", playerId, life: 1, score: 0, kills: 0, seconds: 1, touch: false, save: "saved" });
    await settle(); board.start(); await settle();
    expect(results.view?.best).toBe(13800);
    expect(results.view?.teamTotals).toEqual({ tabs: 955, spaces: 0 });
    expect(board.getSnapshot().leaders.data?.map(row => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await api.standing(playerId)).toEqual({ rank: null, total: 10, next: null });
    expect(results.view?.standing).toEqual({ rank: null, total: 10, next: null });
    approveRun(owner, run.runId!); approveRun(owner, hidden.runId);
    await clock.tick(999); await settle();
    expect((await api.leaders())[0]?.name).toBe("Robot 0"); expect(await api.teams()).toEqual({ tabs: 955, spaces: 0 });
    expect(await api.standing(playerId)).toEqual({ rank: null, total: 10, next: null });
    await clock.tick(1); await settle();
    expect((await api.leaders())[0]?.name).toBe("Review Robot"); expect(await api.teams()).toEqual({ tabs: 955, spaces: 13800 });
    expect(await api.standing(playerId)).toEqual({ rank: 1, total: 11, next: null });
    expect(await api.standing(hiddenPlayer)).toEqual({ rank: null, total: 11, next: null });
    await clock.tick(1000); await settle();
    expect(results.view?.teamTotals).toEqual({ tabs: 955, spaces: 13800 });
    expect(results.view?.standing).toEqual({ rank: 1, total: 11, next: null });
    const snapshot = board.getSnapshot();
    expect(snapshot.leaders.data?.[0]?.name).toBe("Review Robot");
    expect(snapshot.leaders.data?.map(row => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(snapshot.teams.data?.totals).toEqual({ tabs: 955, spaces: 13800 });
    expect(clock.time - 300000).toBeLessThanOrEqual(5000);
    expect(countEvents(db).run_ended).toBe(12); // Status polling never adds another finish event.
  } finally {
    board.stop(); results.dispose();
    owner.close(); db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
