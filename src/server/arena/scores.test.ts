import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { finishRun, getRun, hideName, leaderboard, listHeldRuns, openDb, personalBest, startRun, teamTotals } from "../db";
import { finishArenaLife, startArenaLife, type LifeRecord } from "./lives";

test("mixed release 1 and arena scores share best, top ten, standing and per-run teams and survive reopen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "arena-scores-")), path = join(dir, "app.db");
  let db = openDb(path);
  try {
    const a = crypto.randomUUID(), b = crypto.randomUUID(), c = crypto.randomUUID();
    const legacy = (playerId: string, name: string, score: number, team: "tabs" | "spaces" = "tabs") => {
      const started = startRun(db, playerId, name, 0, team); if ("error" in started) throw Error(started.error);
      finishRun(db, started.runId, { playerId, score, seconds: 100, squashes: (score - 100) / 10, touch: false }, 100000);
      return started.runId;
    };
    const old = legacy(a, "Alpha", 200), second = legacy(b, "Beta", 300);
    const life = (playerId: string, score: number, team: "tabs" | "spaces", ended: number): LifeRecord => ({ runId: crypto.randomUUID(), playerId, started: 0, ended, team,
      result: { playerId, life: 1, score, kills: 0, seconds: 1, touch: true } });
    const authoritative = life(a, 9001, "spaces", 100001); startArenaLife(db, authoritative); finishArenaLife(db, authoritative);
    legacy(c, "Gamma", 100); finishArenaLife(db, life(c, 300, "tabs", 100002));
    legacy(a, "Alpha", 4000); // personal best includes historical held scores; public ranking excludes them.
    const unfinished = life(b, 99999, "tabs", 100003); startArenaLife(db, unfinished);
    const app = createApp(db), read = async (path: string) => (await app.request(path)).json();
    expect(await read("/api/leaderboard")).toEqual([
      { playerId: a, name: "Alpha", score: 9001 }, { playerId: b, name: "Beta", score: 300 }, { playerId: c, name: "Gamma", score: 300 },
    ]);
    expect(await read(`/api/players/${b}/best`)).toEqual({ best: 300 });
    expect(await read(`/api/players/${b}/standing`)).toEqual({ rank: 2, total: 3, next: { rank: 1, pointsToBeat: 8702 } });
    expect(await read(`/api/players/${c}/standing`)).toEqual({ rank: 3, total: 3, next: { rank: 2, pointsToBeat: 1 } });
    expect(await read("/api/teams")).toEqual({ tabs: 900, spaces: 9001 });
    expect(listHeldRuns(db).map(r => r.score)).toEqual([4000]); expect(personalBest(db, a)).toBe(9001);
    expect(getRun(db, authoritative.runId)).toMatchObject({ held: 0, mode: "arena", squashes: 0, seconds: 1, score: 9001 });
    hideName(db, " alpha ", 200000); expect(leaderboard(db).map(r => r.name)).toEqual(["Beta", "Gamma"]);
    expect(teamTotals(db)).toEqual({ tabs: 700, spaces: 0 }); expect(personalBest(db, a)).toBe(9001);
    const rows = db.query("SELECT * FROM runs ORDER BY id").all(); db.close(); db = openDb(path);
    expect(db.query("SELECT * FROM runs ORDER BY id").all()).toEqual(rows);
    expect(getRun(db, old)?.score).toBe(200); expect(getRun(db, second)?.score).toBe(300);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
