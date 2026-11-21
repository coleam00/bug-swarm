import { CRAWLER_RADIUS, CRAWLER_SPEED, CRAWLER_HEALTH, CRAWLER_POINTS } from "../constants";
import { approach, nearestPlayer, type BugDefinition } from "./definition";
export const crawler: BugDefinition = {
  radius: CRAWLER_RADIUS, health: CRAWLER_HEALTH, points: CRAWLER_POINTS,
  initialize() {},
  move(bug, players) { approach(bug, nearestPlayer(bug, players), CRAWLER_SPEED); },
  valid(bug) { return bug.phase === undefined && bug.phaseUntil === undefined && Math.hypot(bug.vx, bug.vy) <= CRAWLER_SPEED + 0.1; },
};
