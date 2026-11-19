import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Finish, Leader, TeamTotals } from "../shared/api";
import { TEAMS, type Team } from "../shared/teams";
import { nameKey, validateName } from "./rules";
export { TEAMS } from "../shared/teams";

// Every event the app records, named once. The server writes them and `bun run stats` reads them,
// so both import this list instead of typing the strings. Add your product's events here.
export const EVENT_TYPES = ["opened", "run_started", "run_ended"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// One SQLite file holds the app's data. Tables are created here, and schema changes
// are additive: add a table or a column, never drop or rename one.
export function openDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      at TEXT NOT NULL
    );`);
    const columns = db.query("PRAGMA table_info(events)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "run_id")) db.exec("ALTER TABLE events ADD COLUMN run_id TEXT;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), started_at_ms INTEGER NOT NULL,
        ended_at_ms INTEGER, score INTEGER, squashes INTEGER, seconds INTEGER, touch INTEGER,
        upgrades TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS hidden_names (name_key TEXT PRIMARY KEY, hidden_at_ms INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS unique_run_event ON events(type, run_id)
        WHERE run_id IS NOT NULL AND type IN ('${EVENT_TYPES[1]}', '${EVENT_TYPES[2]}');
      CREATE INDEX IF NOT EXISTS runs_player_score ON runs(player_id, score DESC, ended_at_ms);
      CREATE INDEX IF NOT EXISTS runs_finished ON runs(ended_at_ms) WHERE ended_at_ms IS NOT NULL;
    `);
    for (const table of ["players", "runs"]) {
      const columns = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(column => column.name === "team")) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN team TEXT CHECK (team IN (${TEAMS.map(team => `'${team}'`).join(",")}));`);
      }
    }
  }).immediate();
  return db;
}

export function recordEvent(db: Database, type: EventType, at = new Date()): void {
  db.query("INSERT INTO events (type, at) VALUES (?, ?)").run(type, at.toISOString());
}

/** How many events of each type were recorded. Types with none still appear, with 0. */
export function countEvents(db: Database): Record<EventType, number> {
  const counts = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<EventType, number>;
  const rows = db.query("SELECT type, COUNT(*) AS n FROM events GROUP BY type").all() as { type: string; n: number }[];
  for (const row of rows) {
    if ((EVENT_TYPES as readonly string[]).includes(row.type)) counts[row.type as EventType] = row.n;
  }
  return counts;
}

export interface Run {
  team: Team | null;
  id: string; player_id: string; started_at_ms: number; ended_at_ms: number | null;
  score: number | null; squashes: number | null; seconds: number | null; touch: number | null; upgrades: string;
}
export function getRun(db: Database, id: string): Run | null {
  return db.query("SELECT * FROM runs WHERE id = ?").get(id) as Run | null;
}
export type StartResult = { runId: string } | { error: "team-required" | "name-conflict" } | { error: "team-conflict"; team: Team };
export function startRun(db: Database, playerId: string, name: string, now: number, team?: Team): StartResult {
  return db.transaction(() => {
    const player = db.query("SELECT name, team FROM players WHERE id = ?").get(playerId) as { name: string; team: Team | null } | null;
    if (player && player.name !== name) return { error: "name-conflict" } as const;
    if (!player && !team) return { error: "team-required" } as const;
    if (player?.team && team && player.team !== team) return { error: "team-conflict", team: player.team } as const;
    const assigned = player?.team ?? team ?? null;
    if (!player) db.query("INSERT INTO players(id, name, name_key, team) VALUES (?, ?, ?, ?)").run(playerId, name, nameKey(name), assigned);
    else if (!player.team && team) db.query("UPDATE players SET team = ? WHERE id = ?").run(team, playerId);
    const id = crypto.randomUUID();
    db.query("INSERT INTO runs(id, player_id, started_at_ms, team) VALUES (?, ?, ?, ?)").run(id, playerId, now, assigned);
    db.query("INSERT INTO events(type, at, run_id) VALUES (?, ?, ?)").run(EVENT_TYPES[1], new Date(now).toISOString(), id);
    return { runId: id };
  }).immediate();
}
export function finishRun(db: Database, id: string, finish: Finish, now: number): boolean {
  return db.transaction(() => {
    const result = db.query(`UPDATE runs SET ended_at_ms = ?, score = ?, squashes = ?, seconds = ?, touch = ?, upgrades = ?
      WHERE id = ? AND ended_at_ms IS NULL`).run(now, finish.score, finish.squashes, finish.seconds, Number(finish.touch), JSON.stringify(finish.upgrades ?? []), id);
    if (!result.changes) return false;
    db.query("INSERT INTO events(type, at, run_id) VALUES (?, ?, ?)").run(EVENT_TYPES[2], new Date(now).toISOString(), id);
    return true;
  })();
}
export function personalBest(db: Database, playerId: string): number | null {
  return (db.query("SELECT MAX(score) AS best FROM runs WHERE player_id = ? AND ended_at_ms IS NOT NULL")
    .get(playerId) as { best: number | null }).best;
}
export function leaderboard(db: Database): Leader[] {
  const rows = db.query(`WITH bests AS (
      SELECT player_id, MAX(score) AS score FROM runs WHERE ended_at_ms IS NOT NULL GROUP BY player_id
    ) SELECT p.id AS playerId, p.name, b.score, MIN(r.ended_at_ms) AS achieved
    FROM bests b JOIN players p ON p.id = b.player_id
    JOIN runs r ON r.player_id = b.player_id AND r.score = b.score AND r.ended_at_ms IS NOT NULL
    WHERE NOT EXISTS (SELECT 1 FROM hidden_names h WHERE h.name_key = p.name_key)
    GROUP BY p.id ORDER BY b.score DESC, achieved ASC, p.id ASC`).all() as Leader[];
  return rows.filter((row) => !validateName(row.name).error).slice(0, 10)
    .map(({ playerId, name, score }) => ({ playerId, name, score }));
}
export function hideName(db: Database, name: string, now: number): void {
  db.query("INSERT OR IGNORE INTO hidden_names(name_key, hidden_at_ms) VALUES (?, ?)").run(nameKey(name), now);
}
export function teamTotals(db: Database): TeamTotals {
  const totals: TeamTotals = { tabs: 0, spaces: 0 };
  const rows = db.query(`SELECT r.team, SUM(r.score) AS total FROM runs r
    JOIN players p ON p.id = r.player_id
    WHERE r.ended_at_ms IS NOT NULL AND r.team IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM hidden_names h WHERE h.name_key = p.name_key)
    GROUP BY r.team`).all() as { team: string; total: number }[];
  for (const team of TEAMS) totals[team] = rows.find(row => row.team === team)?.total ?? 0;
  return totals;
}
