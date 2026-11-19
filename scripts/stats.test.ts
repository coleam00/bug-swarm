import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishRun, hideName, openDb, recordEvent, startRun } from "../src/server/db";
import { parseWindow, report } from "./stats";

test("bet counts accepted finishes, hidden players, grouped median, rounding and finish-time bounds", () => {
  const db = openDb(":memory:");
  try {
    const add = (player: string, at: number, touch: boolean) => {
      const id = (startRun(db, player, `Robot${player}`, 0, "tabs") as { runId: string }).runId;
      const result = { playerId: player, score: 1, squashes: 0, seconds: 1, touch };
      finishRun(db, id, result, at); finishRun(db, id, result, at);
    };
    recordEvent(db, "opened"); startRun(db, "abandoned", "Abandoned", 0, "tabs");
    expect(report(db)).toBe("players: 0\nfinished_runs: 0\nmedian_runs_per_player: 0.0\ntouch_share: 0%");
    add("a", 1000, true); add("a", 2000, true); add("a", 3000, true); add("b", 4000, false);
    const before = report(db);
    expect(before).toBe("players: 2\nfinished_runs: 4\nmedian_runs_per_player: 2.0\ntouch_share: 75%");
    hideName(db, "Robota", 5000); expect(report(db)).toBe(before);
    expect(report(db, 2000, 4000)).toBe("players: 1\nfinished_runs: 2\nmedian_runs_per_player: 2.0\ntouch_share: 100%");
    add("c", 5000, false); add("c", 6000, false);
    expect(report(db)).toContain("median_runs_per_player: 2.0\ntouch_share: 50%");
    expect(report(db, 3000, 6000)).toContain("touch_share: 33%");
    // Counts [7, 1, 2] have a median of 2, rather than their mean of 3.3.
    for (let i = 0; i < 4; i++) add("a", 7000 + i, false);
    expect(report(db)).toBe("players: 3\nfinished_runs: 10\nmedian_runs_per_player: 2.0\ntouch_share: 30%");
  } finally { db.close(); }
});
test("ISO flags support offsets, optional separator and independent bounds; reject invalid arguments", () => {
  expect(parseWindow(["--", "--since", "2026-11-28T09:00:00-06:00"])).toEqual({ since: Date.parse("2026-11-28T15:00:00Z"), until: Infinity });
  expect(parseWindow(["--until", "2026-11-28T16:15:00Z"]).since).toBe(-Infinity);
  for (const args of [["--since"], ["--wat", "x"], ["--since", "2026-02-30T00:00:00Z"], ["--since", "2026-11-28"], ["--since", "2026-11-28T09:00:00"], ["--since", "2027-01-01T00:00:00Z", "--until", "2026-01-01T00:00:00Z"], ["--since", "2026-01-01T00:00:00Z", "--since", "2026-01-01T00:00:00Z"]]) expect(() => parseWindow(args)).toThrow();
});
test("stats CLI has exact stdout, fails cleanly and doesn't create a missing database", () => {
  const dir = mkdtempSync(join(tmpdir(), "swarm-stats-")), home = join(dir, "home"); mkdirSync(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, DATA_DIR: join(dir, "data") };
  try {
    const empty = Bun.spawnSync([process.execPath, "scripts/stats.ts"], { env, stdout: "pipe", stderr: "pipe" });
    expect(empty.exitCode).toBe(0); expect(empty.stdout.toString()).toBe(report(null) + "\n");
    expect(existsSync(join(dir, "data"))).toBe(false);
    const bad = Bun.spawnSync([process.execPath, "scripts/stats.ts", "--since", "bad"], { env, stdout: "pipe", stderr: "pipe" });
    expect(bad.exitCode).toBe(1); expect(bad.stdout.toString()).toBe(""); expect(bad.stderr.toString()).not.toBe("");
    const db = openDb(join(dir, "data", "app.db"));
    const playerId = crypto.randomUUID();
    try {
      for (const at of ["2026-11-28T14:59:59Z", "2026-11-28T15:00:00Z", "2026-11-28T15:01:00Z"]) {
        const id = (startRun(db, playerId, "Robot", 0, "tabs") as { runId: string }).runId;
        finishRun(db, id, { playerId, score: 1, squashes: 0, seconds: 1, touch: true }, Date.parse(at));
      }
    } finally { db.close(); }
    const output = Bun.spawnSync([process.execPath, "scripts/stats.ts", "--", "--since", "2026-11-28T15:00:00Z", "--until", "2026-11-28T15:01:00Z"], { env, stdout: "pipe", stderr: "pipe" });
    expect(output.exitCode).toBe(0); expect(output.stdout.toString()).toBe("players: 1\nfinished_runs: 1\nmedian_runs_per_player: 1.0\ntouch_share: 100%\n");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 15_000);
