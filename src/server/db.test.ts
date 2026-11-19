import { expect, test } from "bun:test";
import { UPGRADE_IDS } from "../shared/upgrades";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countEvents, finishRun, getRun, hideName, leaderboard, openDb, personalBest, startRun } from "./db";

test("actual legacy schema migrates additively and survives repeated reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-db-")), path = join(dir, "app.db");
  let db = new Database(path);
  try {
    db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, at TEXT NOT NULL); INSERT INTO events(type, at) VALUES ('opened', '2026-01-01');");
    db.close(); db = openDb(path);
    const player = crypto.randomUUID(), id = startRun(db, player, "Robot", 0)!;
    finishRun(db, id, { playerId: player, score: 11, squashes: 1, seconds: 1, touch: true }, 1000);
    db.close(); db = openDb(path);
    expect(countEvents(db)).toEqual({ opened: 1, run_started: 1, run_ended: 1 });
    expect(getRun(db, id)?.score).toBe(11); expect(personalBest(db, player)).toBe(11);
    expect(db.query("SELECT upgrades FROM runs").get()).toEqual({ upgrades: "[]" });
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("event failure rolls back the entire start and finish transaction", () => {
  const db = openDb(":memory:");
  try {
    const player = crypto.randomUUID();
    db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'test'); END;");
    expect(() => startRun(db, player, "Robot", 0)).toThrow();
    expect(db.query("SELECT COUNT(*) AS n FROM players").get()).toEqual({ n: 0 });
    db.exec("DROP TRIGGER fail_event;");
    const id = startRun(db, player, "Robot", 0)!;
    db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'test'); END;");
    expect(() => finishRun(db, id, { playerId: player, score: 20, squashes: 0, seconds: 20, touch: false, upgrades: [{ id: UPGRADE_IDS[0], count: 1 }] }, 20000)).toThrow();
    expect(getRun(db, id)?.ended_at_ms).toBeNull();
    expect(getRun(db, id)?.upgrades).toBe("[]");
    expect(countEvents(db).run_ended).toBe(0);
  } finally { db.close(); }
});
test("best per player, first-best finish and id tie order, filtering before ten", () => {
  const db = openDb(":memory:");
  const score = (player: string, name: string, value: number, at: number) => {
    const id = startRun(db, player, name, 0)!;
    finishRun(db, id, { playerId: player, score: value, seconds: value, squashes: 0, touch: false }, at);
  };
  try {
    score("b", "Beta", 100, 2); score("a", "Alpha", 100, 2); score("c", "Gamma", 100, 1);
    score("c", "Gamma", 20, 0); score("c", "Gamma", 100, 5);
    expect(leaderboard(db).map((v) => v.playerId)).toEqual(["c", "a", "b"]);
    hideName(db, " ALPHA ", 5);
    expect(leaderboard(db).map((v) => v.playerId)).toEqual(["c", "b"]);
    expect(personalBest(db, "a")).toBe(100);
    for (let i = 0; i < 14; i++) score(`p${i}`, `Robot${i}`, 99 - i, 10);
    // Legacy entries that no longer pass the current list never reach public output.
    score("bad", "shit", 1000, 0);
    expect(leaderboard(db)).toEqual([
      { playerId: "c", name: "Gamma", score: 100 }, { playerId: "b", name: "Beta", score: 100 },
      ...Array.from({ length: 8 }, (_, i) => ({ playerId: `p${i}`, name: `Robot${i}`, score: 99 - i })),
    ]);
  } finally { db.close(); }
});
