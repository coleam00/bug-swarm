import { existsSync } from "node:fs";
import { join } from "node:path";
import { listHeldRuns, openDb } from "../src/server/db";

if (import.meta.main) {
  let db: ReturnType<typeof openDb> | undefined;
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--") args.shift();
    if (args.length) throw new Error("Usage: bun run review");
    const path = join(process.env.DATA_DIR ?? "data", "app.db");
    const rows = existsSync(path) ? listHeldRuns(db = openDb(path)) : [];
    if (!rows.length) console.log("No held runs");
    else {
      console.log("run id\tname\tscore\tseconds\tsquashes\twhen (UTC)");
      for (const row of rows) console.log([row.id, JSON.stringify(row.name), row.score,
        row.seconds, row.squashes, new Date(row.ended_at_ms).toISOString()].join("\t"));
    }
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally { db?.close(); }
}
