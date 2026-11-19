import { join } from "node:path";
import { hideName, openDb } from "../src/server/db";

if (import.meta.main) {
  let db: ReturnType<typeof openDb> | undefined;
  try {
    const args = process.argv.slice(2);
    if (args[0] === "--") args.shift();
    if (args.length !== 1 || !/^[A-Za-z0-9 _-]{2,16}$/.test(args[0]!.trim())) throw new Error('Usage: bun run hide "<name>" (2–16 name characters)');
    db = openDb(join(process.env.DATA_DIR ?? "data", "app.db"));
    hideName(db, args[0]!, Date.now());
    console.log(`Hidden: ${args[0]!.trim()}`);
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
  finally { db?.close(); }
}
