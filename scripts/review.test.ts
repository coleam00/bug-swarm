import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countEvents, finishRun, getRun, leaderboard, openDb, startRun, teamTotals } from "../src/server/db";
import { report } from "./stats";
import { finishArenaLife } from "../src/server/arena/lives";

// Seventeen cold package-script starts took 28 seconds on factory Windows.
// Bound each child independently and allow headroom for the complete scenario.
test("review and approve package scripts use separate processes, retain history and respect hide", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-review-")), home = join(dir, "home"); mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, DATA_DIR: dir };
  const path = join(dir, "app.db");
  const run = (script: string, args: string[] = []) => {
    const child = Bun.spawnSync([process.execPath, "run", "--silent", script, ...args], { cwd: join(import.meta.dir, ".."), env, stdout: "pipe", stderr: "pipe", timeout: 5000 });
    return { code: child.exitCode, out: child.stdout.toString().trim(), error: child.stderr.toString().trim() };
  };
  let db: ReturnType<typeof openDb> | undefined;
  try {
    expect(run("review")).toEqual({ code: 0, out: "No held runs", error: "" });
    for (const args of [[], ["invalid"], [crypto.randomUUID(), "extra"]]) {
      const result = run("approve", args); expect(result.code).toBe(1); expect(result.error).toContain("Usage"); expect(result.out).toBe("");
    }
    expect(run("approve", [crypto.randomUUID()]).error).toContain("Database not found");
    expect(run("review", ["extra"]).code).toBe(1); expect(existsSync(path)).toBe(false);
    db = openDb(path);
    expect(run("review", ["--"]).out).toBe("No held runs");
    const add = (name: string, at: number, finish = true) => {
      const playerId = crypto.randomUUID(), started = startRun(db!, playerId, name, 0, "tabs");
      if ("error" in started) throw new Error(started.error);
      if (finish) finishRun(db!, started.runId, { playerId, score: 13800, squashes: 1350, seconds: 300, touch: false }, at);
      return started.runId;
    };
    const late = add("Robot", 300002), early = add("Hidden Robot", 300001), blocked = add("admin", 300003);
    const arenaPlayer = (db.query("SELECT player_id FROM runs WHERE id = ?").get(early) as any).player_id;
    const arenaRun = crypto.randomUUID();
    finishArenaLife(db, { runId: arenaRun, playerId: arenaPlayer, team: "spaces", started: 0, ended: 1,
      result: { playerId: arenaPlayer, life: 1, score: 9001, kills: 0, seconds: 0, touch: true } });
    expect(getRun(db, arenaRun)).toMatchObject({ held: 0, mode: "arena" });
    expect(run("review").out).not.toContain(arenaRun);
    const pending = add("Pending", 0, false);
    expect(run("hide", ["Hidden Robot"]).code).toBe(0);
    // Escaping protects operator rows even if legacy data predates the name gate.
    db.query("UPDATE players SET name = ? WHERE id = (SELECT player_id FROM runs WHERE id = ?)").run("Old\tRobot\n", late);
    const lines = run("review").out.split(/\r?\n/);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("run id\tname\tscore\tseconds\tsquashes\twhen (UTC)");
    expect(lines[1]).toBe(`${early}\t"Hidden Robot"\t13800\t300\t1350\t1970-01-01T00:05:00.001Z`);
    expect(lines[2]).toContain('"Old\\tRobot\\n"'); expect(lines[3]).toContain(blocked);
    db.query("UPDATE players SET name = 'Robot' WHERE id = (SELECT player_id FROM runs WHERE id = ?)").run(late);
    const stats = report(db), events = countEvents(db), before = getRun(db, late)!;
    expect(run("approve", ["--", late])).toEqual({ code: 0, out: `Approved: ${late}`, error: "" });
    expect(getRun(db, late)).toEqual({ ...before, held: 0 });
    expect([early, blocked].map(id => getRun(db!, id)?.held)).toEqual([1, 1]);
    expect(run("approve", [late]).out).toBe(`Already eligible: ${late}`);
    for (const id of [early, blocked]) expect(run("approve", [id]).code).toBe(0);
    expect(leaderboard(db).map(row => row.name)).toEqual(["Robot"]);
    expect(teamTotals(db)).toEqual({ tabs: 13800, spaces: 0 });
    expect(run("review").out).toBe("No held runs");
    for (const [id, error] of [[pending, "has not finished"], [crypto.randomUUID(), "not found"]]) {
      const result = run("approve", [id!]); expect(result.code).toBe(1); expect(result.error).toContain(error!); expect(result.out).toBe("");
    }
    expect(report(db)).toBe(stats); expect(countEvents(db)).toEqual(events);
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
}, 45_000);
