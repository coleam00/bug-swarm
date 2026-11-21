import { DASHER_RADIUS, DASHER_HEALTH, DASHER_POINTS, DASHER_SPEED, DASHER_TRIGGER, DASHER_WINDUP_MS, DASHER_DASH_SPEED, DASHER_DASH_MS, DASHER_RECOVERY_MS, DASHER_RECOVERY_SPEED } from "../constants";
import { approach, nearestPlayer, type BugDefinition } from "./definition";
import type { Bug } from "../types";
const durations: Record<string, number> = { approach: 0, windup: DASHER_WINDUP_MS, dash: DASHER_DASH_MS, recovery: DASHER_RECOVERY_MS };
function advancePhase(bug: Bug, time: number) {
  while (bug.phase !== "approach" && time >= bug.phaseUntil!) {
    const boundary = bug.phaseUntil!;
    if (bug.phase === "windup") { bug.phase = "dash"; bug.phaseUntil = boundary + DASHER_DASH_MS; }
    else if (bug.phase === "dash") { bug.phase = "recovery"; bug.phaseUntil = boundary + DASHER_RECOVERY_MS; }
    else { bug.phase = "approach"; bug.phaseUntil = 0; }
    bug.vx = bug.phase === "dash" ? Math.cos(bug.facing) * DASHER_DASH_SPEED : 0;
    bug.vy = bug.phase === "dash" ? Math.sin(bug.facing) * DASHER_DASH_SPEED : 0;
  }
}
export const dasher: BugDefinition = {
  radius: DASHER_RADIUS, health: DASHER_HEALTH, points: DASHER_POINTS,
  initialize(bug) { bug.phase = "approach"; bug.phaseUntil = 0; },
  advancePhase,
  move(bug, players, time) {
    advancePhase(bug, time);
    if (bug.phase === "dash") { bug.vx = Math.cos(bug.facing) * DASHER_DASH_SPEED; bug.vy = Math.sin(bug.facing) * DASHER_DASH_SPEED; return; }
    if (bug.phase === "windup") { bug.vx = bug.vy = 0; return; }
    const target = nearestPlayer(bug, players);
    approach(bug, target, bug.phase === "recovery" ? DASHER_RECOVERY_SPEED : DASHER_SPEED);
    if (bug.phase === "approach" && target && Math.hypot(target.x - bug.x, target.y - bug.y) <= DASHER_TRIGGER) {
      bug.phase = "windup"; bug.phaseUntil = time + DASHER_WINDUP_MS; bug.vx = bug.vy = 0;
    }
  },
  valid(bug, time) {
    if (!Object.hasOwn(durations, bug.phase ?? "") || !Number.isSafeInteger(bug.phaseUntil)) return false;
    const duration = durations[bug.phase!]!, until = bug.phaseUntil!;
    if (duration ? until <= time || until > time + duration : until !== 0) return false;
    const speed = bug.phase === "windup" ? 0 : bug.phase === "dash" ? DASHER_DASH_SPEED : bug.phase === "recovery" ? DASHER_RECOVERY_SPEED : DASHER_SPEED;
    if (Math.hypot(bug.vx, bug.vy) > speed + (speed ? 0.1 : 0)) return false;
    // Wire facing is rounded to .001 radians independently of velocity components.
    const directionTolerance = speed * 0.00051 + 0.002;
    return bug.phase !== "dash" || Math.hypot(bug.vx, bug.vy) < 0.1 || Math.hypot(bug.vx - Math.cos(bug.facing) * speed, bug.vy - Math.sin(bug.facing) * speed) < directionTolerance;
  },
};
