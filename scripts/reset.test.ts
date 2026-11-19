import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countEvents, finishRun, hideName, leaderboard, openDb, recordEvent, startRun, teamTotals } from "../src/server/db";
import { reset, resetData } from "./reset";
import { report } from "./stats";

test("reset removes finished/abandoned runs, players and all events, retaining moderation; deletion rolls back atomically", () => {
  const db = openDb(":memory:");
  try {
    const playerId = crypto.randomUUID();
    const started = startRun(db, playerId, "Robot", 0, "tabs") as { runId: string };
    finishRun(db, started.runId, { playerId, score: 11, squashes: 1, seconds: 1, touch: true }, 1000);
    startRun(db, crypto.randomUUID(), "Other", 0, "spaces");
    recordEvent(db, "opened"); hideName(db, "Hidden", 0);
    db.exec("CREATE TRIGGER prevent_reset BEFORE DELETE ON players BEGIN SELECT RAISE(ABORT, 'injected failure'); END;");
    expect(() => resetData(db)).toThrow("injected failure");
    expect(countEvents(db)).toEqual({ opened: 1, run_started: 2, run_ended: 1 });
    expect(leaderboard(db)).toHaveLength(1);
    db.exec("DROP TRIGGER prevent_reset");
    expect(resetData(db)).toEqual({ events: 4, runs: 2, players: 2 });
    expect(resetData(db)).toEqual({ events: 0, runs: 0, players: 0 });
    expect(leaderboard(db)).toEqual([]);
    expect(teamTotals(db)).toEqual({ tabs: 0, spaces: 0 });
    expect(countEvents(db)).toEqual({ opened: 0, run_started: 0, run_ended: 0 });
    expect(report(db)).toBe(report(null));
    expect(db.query("SELECT name_key FROM hidden_names").all()).toEqual([{ name_key: "hidden" }]);
  } finally { db.close(); }
});

test("reset CLI requires exactly --yes, respects DATA_DIR and doesn't create missing data", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-reset-")), home = join(dir, "home"), data = join(dir, "data");
  mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, DATA_DIR: data };
  const run = (...args: string[]) => Bun.spawnSync([process.execPath, "scripts/reset.ts", ...args], { env, stdout: "pipe", stderr: "pipe", timeout: 10000 });
  try {
    for (const args of [[], ["--yes", "--yes"], ["--no"], ["--yes", "extra"]]) {
      const child = run(...args);
      expect(child.exitCode).toBe(1); expect(child.stdout.toString()).toBe("");
      expect(child.stderr.toString()).toContain(join(data, "app.db"));
    }
    expect(existsSync(data)).toBe(false);
    expect(run("--", "--yes").exitCode).toBe(0);
    expect(existsSync(data)).toBe(false);
    const db = openDb(join(data, "app.db"));
    try { recordEvent(db, "opened"); } finally { db.close(); }
    expect(() => reset([], data)).toThrow();
    const verify = openDb(join(data, "app.db"));
    try { expect(countEvents(verify).opened).toBe(1); } finally { verify.close(); }
    const other = join(dir, "other");
    expect(reset(["--yes"], other).events).toBe(0);
    const child = run("--yes");
    expect(child.exitCode).toBe(0); expect(child.stdout.toString()).toContain("Deleted events: 1");
    expect(child.stdout.toString()).toContain("moderation");
    expect(existsSync(join(data, "app.db"))).toBe(true);
    expect(reset(["--yes"], data).events).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 15000);
