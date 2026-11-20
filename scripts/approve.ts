import { existsSync } from "node:fs";
import { join } from "node:path";
import { approveRun, openDb } from "../src/server/db";
import { isId } from "../src/server/rules";

if (import.meta.main) {
  let db: ReturnType<typeof openDb> | undefined;
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--") args.shift();
    if (args.length !== 1 || !isId(args[0])) throw new Error("Usage: bun run approve <run id> (UUID)");
    const path = join(process.env.DATA_DIR ?? "data", "app.db");
    if (!existsSync(path)) throw new Error("Database not found.");
    db = openDb(path);
    const result = approveRun(db, args[0]);
    console.log(`${result === "approved" ? "Approved" : "Already eligible"}: ${args[0]}`);
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally { db?.close(); }
}
