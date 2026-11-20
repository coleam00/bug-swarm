import { expect, test } from "bun:test";
import { UPGRADE_IDS } from "../shared/upgrades";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countEvents, finishRun, getRun, hideName, leaderboard, openDb, personalBest, rankedPlayers, startRun, teamTotals } from "./db";

test("actual legacy schema migrates additively and survives repeated reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-db-")), path = join(dir, "app.db");
  let db = new Database(path);
  try {
    db.exec("CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, at TEXT NOT NULL); INSERT INTO events(type, at) VALUES ('opened', '2026-01-01');");
    db.close(); db = openDb(path);
    const player = crypto.randomUUID(), id = (startRun(db, player, "Robot", 0, "tabs") as { runId: string }).runId;
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
    expect(() => startRun(db, player, "Robot", 0, "tabs")).toThrow();
    expect(db.query("SELECT COUNT(*) AS n FROM players").get()).toEqual({ n: 0 });
    db.exec("DROP TRIGGER fail_event;");
    const id = (startRun(db, player, "Robot", 0, "tabs") as { runId: string }).runId;
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
    const id = (startRun(db, player, name, 0, "tabs") as { runId: string }).runId;
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
    score("zero", "Zero", 0, 0);
    startRun(db, "unfinished", "Unfinished", 0, "tabs");
    // Legacy entries that no longer pass the current list never reach public output.
    score("bad", "shit", 1000, 0);
    expect(rankedPlayers(db).map(row => row.playerId)).toEqual(["c", "b", ...Array.from({ length: 14 }, (_, i) => `p${i}`), "zero"]);
    expect(leaderboard(db)).toEqual([
      { playerId: "c", name: "Gamma", score: 100 }, { playerId: "b", name: "Beta", score: 100 },
      ...Array.from({ length: 8 }, (_, i) => ({ playerId: `p${i}`, name: `Robot${i}`, score: 99 - i })),
    ]);
  } finally { db.close(); }
});

test("populated pre-team database preserves history and never backfills run snapshots", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-teams-")), path = join(dir, "app.db");
  let db = new Database(path);
  try {
    db.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, at TEXT NOT NULL, run_id TEXT);
      CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER, score INTEGER, squashes INTEGER, seconds INTEGER, touch INTEGER, upgrades TEXT NOT NULL DEFAULT '[]');
      INSERT INTO players VALUES ('legacy', 'Robot', 'robot');
      INSERT INTO runs (id, player_id, started_at_ms, ended_at_ms, score) VALUES ('finished', 'legacy', 0, 1000, 11);
      INSERT INTO runs (id, player_id, started_at_ms) VALUES ('pending', 'legacy', 0);
      INSERT INTO events (type, at, run_id) VALUES ('run_ended', '2026-01-01', 'finished');`);
    db.close(); db = openDb(path); db.close(); db = openDb(path);
    expect(getRun(db, "finished")?.score).toBe(11);
    expect(getRun(db, "finished")?.team).toBeNull();
    expect(rankedPlayers(db)).toEqual([{ playerId: "legacy", name: "Robot", score: 11 }]);
    expect(countEvents(db).run_ended).toBe(1);
    expect(teamTotals(db)).toEqual({ tabs: 0, spaces: 0 });
    const started = startRun(db, "legacy", "Robot", 0, "spaces");
    expect("runId" in started).toBe(true);
    if (!("runId" in started)) throw new Error(started.error);
    const finish = { playerId: "legacy", score: 2, squashes: 0, seconds: 2, touch: false };
    finishRun(db, "pending", finish, 2000);
    expect(getRun(db, "pending")?.team).toBeNull();
    finishRun(db, started.runId, finish, 2000);
    expect(teamTotals(db)).toEqual({ tabs: 0, spaces: 2 });
    expect(() => db.exec("UPDATE players SET team = 'other'")).toThrow();
    expect(() => db.exec("UPDATE runs SET team = 'other'")).toThrow();
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("failed start event also rolls back a legacy player's team assignment", () => {
  const db = openDb(":memory:");
  try {
    db.exec("INSERT INTO players(id, name, name_key) VALUES ('legacy', 'Robot', 'robot');");
    db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'test'); END;");
    expect(() => startRun(db, "legacy", "Robot", 0, "tabs")).toThrow();
    expect(db.query("SELECT team FROM players").get()).toEqual({ team: null });
    expect(db.query("SELECT COUNT(*) AS n FROM runs").get()).toEqual({ n: 0 });
  } finally { db.close(); }
});

test("team moderation filters each player's run-team sums without changing retained history", () => {
  const db = openDb(":memory:");
  try {
    const add = (playerId: string, name: string, team: "tabs" | "spaces", score: number) => {
      const result = startRun(db, playerId, name, 0, team);
      if ("error" in result) throw new Error(result.error);
      finishRun(db, result.runId, { playerId, score, seconds: score, squashes: 0, touch: true }, 1000);
      return result.runId;
    };
    for (const [i, name] of ["nigga", "f u c k", "fuuuck", "admin", "Cole Medin"].entries()) {
      add(`blocked${i}`, name, "tabs", 100);
      add(`duplicate${i}`, name, "spaces", 200);
    }
    add("one", "Hancock", "tabs", 10);
    add("one", "Hancock", "tabs", 20);
    add("two", "Hancock", "spaces", 30);
    // Run snapshots determine attribution even when the current team differs.
    db.query("UPDATE players SET team = 'spaces' WHERE id = 'one'").run();
    const legacy = add("legacy", "Scunthorpe", "tabs", 500);
    db.query("UPDATE runs SET team = NULL WHERE id = ?").run(legacy);
    startRun(db, "abandoned", "Robot", 0, "tabs");
    add("hidden", "Hidden Robot", "spaces", 1000);
    hideName(db, "Hidden Robot", 0);
    const history = () => ["players", "runs", "events"].map(table => db.query(`SELECT * FROM ${table} ORDER BY id`).all());
    const before = history();
    expect(teamTotals(db)).toEqual({ tabs: 30, spaces: 30 });
    expect(personalBest(db, "blocked0")).toBe(100);
    expect(personalBest(db, "one")).toBe(20);
    expect(history()).toEqual(before);
    hideName(db, "Hancock", 0);
    expect(teamTotals(db)).toEqual({ tabs: 0, spaces: 0 });
  } finally { db.close(); }
});
