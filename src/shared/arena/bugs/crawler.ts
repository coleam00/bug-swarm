import { CRAWLER_RADIUS, CRAWLER_SPEED } from "../constants";
import type { Bug, CombatPlayer } from "../types";
export const crawler = {
  radius: CRAWLER_RADIUS, health: 1, points: 10,
  move(bug: Bug, players: Iterable<CombatPlayer>) {
    let nearest: CombatPlayer | undefined, distance = Infinity;
    for (const p of players) {
      if (p.status !== "active") continue;
      const d = Math.hypot(p.x - bug.x, p.y - bug.y);
      if (d < distance || (d === distance && p.id < nearest!.id)) { nearest = p; distance = d; }
    }
    bug.vx = nearest && distance ? (nearest.x - bug.x) / distance * CRAWLER_SPEED : 0;
    bug.vy = nearest && distance ? (nearest.y - bug.y) / distance * CRAWLER_SPEED : 0;
  },
};
