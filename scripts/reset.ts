import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/server/db";

export function resetData(db: Database) {
  return db.transaction(() => {
    const count = (table: string) => (db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const deleted = { events: count("events"), runs: count("runs"), players: count("players") };
    db.exec("DELETE FROM events; DELETE FROM runs; DELETE FROM players;");
    return deleted;
  }).immediate();
}

export function reset(args: string[], dataDir: string) {
  const path = resolve(dataDir, "app.db");
  if (args[0] === "--") args = args.slice(1);
  if (args.length !== 1 || args[0] !== "--yes") {
    throw new Error(`Refusing to reset ${path}. This deletes ALL players, runs and events. Confirm with: bun run reset -- --yes`);
  }
  if (!existsSync(path)) return { events: 0, runs: 0, players: 0 };
  const db = openDb(path);
  try { return resetData(db); }
  finally { db.close(); }
}

if (import.meta.main) {
  try {
    const deleted = reset(process.argv.slice(2), process.env.DATA_DIR ?? "data");
    console.log(`Deleted events: ${deleted.events}, runs: ${deleted.runs}, players: ${deleted.players}. Hidden names (moderation), schema and indexes preserved.`);
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
