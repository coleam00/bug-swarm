import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { openDb } from "../src/server/db";

export function parseWindow(args: string[]): { since: number; until: number } {
  const values = { since: -Infinity, until: Infinity };
  const seen = new Set<string>();
  if (args[0] === "--") args = args.slice(1);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if ((flag !== "--since" && flag !== "--until") || seen.has(flag) || !value) throw new Error("Use --since <ISO timestamp> and/or --until <ISO timestamp>.");
    // Require a real calendar date and timezone, not Date.parse's rollover or local-time guesses.
    const parts = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
    const time = Date.parse(value);
    const calendar = parts ? Date.parse(`${value.slice(0, 10)}T00:00:00Z`) : NaN;
    if (!parts || !Number.isFinite(time) || !Number.isFinite(calendar) || new Date(calendar).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Filters must be valid ISO timestamps with a timezone.");
    seen.add(flag); values[flag === "--since" ? "since" : "until"] = time;
  }
  if (values.since > values.until) throw new Error("--since must be before --until.");
  return values;
}
export function report(db: Database | null, since = -Infinity, until = Infinity): string {
  const rows = db ? db.query(`SELECT player_id, COUNT(*) AS runs, SUM(touch) AS touches FROM runs
    WHERE ended_at_ms IS NOT NULL AND ended_at_ms >= ? AND ended_at_ms < ? GROUP BY player_id`)
    .all(Number.isFinite(since) ? since : -8640000000000000, Number.isFinite(until) ? until : 8640000000000000) as { player_id: string; runs: number; touches: number }[] : [];
  const counts = rows.map((row) => row.runs).sort((a, b) => a - b);
  const n = counts.length, mid = Math.floor(n / 2);
  const median = n ? n % 2 ? counts[mid]! : (counts[mid - 1]! + counts[mid]!) / 2 : 0;
  const finished = counts.reduce((sum, count) => sum + count, 0);
  const touches = rows.reduce((sum, row) => sum + row.touches, 0);
  return `players: ${n}\nfinished_runs: ${finished}\nmedian_runs_per_player: ${median.toFixed(1)}\ntouch_share: ${finished ? Math.round(touches / finished * 100) : 0}%`;
}
if (import.meta.main) {
  let db: Database | null = null;
  try {
    const { since, until } = parseWindow(process.argv.slice(2));
    const path = join(process.env.DATA_DIR ?? "data", "app.db");
    if (existsSync(path)) db = openDb(path);
    console.log(report(db, since, until));
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally { db?.close(); }
}
