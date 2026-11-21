import { expect, test } from "bun:test";
import { hiveWarning } from "./hive-warning";
import { createBug } from "../../shared/arena/bugs/registry";
import type { Snapshot } from "../../shared/arena/protocol";

test("hive countdown uses each authoritative schedule, exclusive ten-second threshold and inclusive zero boundary", () => {
  const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "test", tick: 0, wave: 1, players: [], bugs: [], shots: [], globs: [], pickups: [], events: [] };
  expect(hiveWarning()).toBeNull(); expect(hiveWarning(null)).toBeNull();
  for (const [wave, boundary] of [[4, 2400], [9, 5400], [14, 8400]] as const) {
    snapshot.wave = wave;
    for (const [offset, expected] of [[-200, null], [-199, 10], [-180, 9], [-21, 2], [-20, 1], [-1, 1], [0, 0]] as const) {
      snapshot.tick = boundary + offset; expect(hiveWarning(snapshot)).toBe(expected);
    }
    snapshot.tick = boundary + 1; snapshot.wave = wave + 1;
    expect(hiveWarning(snapshot)).toBeNull(); // No queued warning after a skipped encounter.
  }
  const boss = createBug("hive", 1, 0, 0); snapshot.bugs = [boss]; snapshot.wave = 9; snapshot.tick = 5399;
  expect(hiveWarning(snapshot)).toBeNull(); // Surviving boss suppresses the next schedule.
  boss.phase = "arrival"; boss.phaseUntil = 272000;
  expect(hiveWarning(snapshot)).toBe(3);
  snapshot.tick = 5440; expect(hiveWarning(snapshot)).toBe(0);
  snapshot.tick++; expect(hiveWarning(snapshot)).toBe(0); // Await authoritative activation.
  boss.phase = "active"; expect(hiveWarning(snapshot)).toBeNull();
  snapshot.tick = 2401; snapshot.wave = 5; expect(hiveWarning(snapshot)).toBeNull();
});
