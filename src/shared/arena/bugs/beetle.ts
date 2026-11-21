import { BEETLE_ARMOUR_HALF_ANGLE, BEETLE_HEALTH, BEETLE_POINTS, BEETLE_RADIUS, BEETLE_SPEED, BEETLE_TURN_RATE } from "../constants";
import { nearestPlayer, type BugDefinition } from "./definition";

/** Shortest signed angle, with a deterministic positive half-turn tie. */
export function angleDifference(angle: number) {
  const wrapped = ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return wrapped === -Math.PI ? Math.PI : wrapped;
}
/** Contact sector, shared with the policy's conservative centre-shot approximation. */
export function shellBlocks(facing: number, contactX: number, contactY: number, margin = 0) {
  return contactX * Math.cos(facing) + contactY * Math.sin(facing) >= Math.cos(BEETLE_ARMOUR_HALF_ANGLE + margin) - 1e-10;
}
export const beetle: BugDefinition = {
  radius: BEETLE_RADIUS, health: BEETLE_HEALTH, points: BEETLE_POINTS,
  initialize() {},
  move(bug, players, _time, elapsedMs = 0) {
    const target = nearestPlayer(bug, players);
    if (!target || target.x === bug.x && target.y === bug.y) { bug.vx = bug.vy = 0; return; }
    if (elapsedMs > 0) {
      const delta = angleDifference(Math.atan2(target.y - bug.y, target.x - bug.x) - bug.facing);
      const limit = BEETLE_TURN_RATE * elapsedMs / 1000;
      bug.facing = angleDifference(bug.facing + Math.max(-limit, Math.min(limit, delta)));
    }
    bug.vx = Math.cos(bug.facing) * BEETLE_SPEED; bug.vy = Math.sin(bug.facing) * BEETLE_SPEED;
  },
  blocksShot(bug, x, y) { return shellBlocks(bug.facing, x, y); },
  valid(bug) {
    const speed = Math.hypot(bug.vx, bug.vy);
    return bug.phase === undefined && bug.phaseUntil === undefined && speed <= BEETLE_SPEED + 0.1 &&
      (speed < 0.1 || Math.hypot(bug.vx - Math.cos(bug.facing) * speed, bug.vy - Math.sin(bug.facing) * speed) < 0.1);
  },
};
