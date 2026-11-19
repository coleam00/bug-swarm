import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countEvents, finishRun, leaderboard, openDb, startRun } from "../src/server/db";
import { report } from "./stats";
test("hide CLI normalizes and is idempotent, preserves history and accepts now-blocked names", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-hide-")), home = join(dir, "home"); mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, DATA_DIR: dir };
  const db = openDb(join(dir, "app.db"));
  try {
    const id = startRun(db, "a", "Robot", 0)!;
    finishRun(db, id, { playerId: "a", score: 1, squashes: 0, seconds: 1, touch: false }, 1000);
    const before = report(db), events = countEvents(db);
    for (const name of [" ROBOT ", "Robot", "5h1t"]) {
      const child = Bun.spawnSync([process.execPath, "scripts/hide.ts", name], { env, stdout: "pipe", stderr: "pipe" });
      expect(child.exitCode, child.stderr.toString()).toBe(0);
    }
    expect(leaderboard(db)).toEqual([]); expect(report(db)).toBe(before); expect(countEvents(db)).toEqual(events);
    expect(db.query("SELECT COUNT(*) AS n FROM hidden_names").get()).toEqual({ n: 2 });
    for (const args of [[], ["a", "b"], ["a<b"]]) {
      const child = Bun.spawnSync([process.execPath, "scripts/hide.ts", ...args], { env, stdout: "pipe", stderr: "pipe" });
      expect(child.exitCode).toBe(1); expect(child.stdout.toString()).toBe("");
    }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}, 15_000);
