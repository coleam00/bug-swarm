import { DASHER_DASH_MS, DASHER_DASH_SPEED, DASHER_DODGE_CLEARANCE, PICKUP_ROUTE_CLEARANCE, PICKUP_SAFE_DISTANCE, PICKUP_SEEK_DISTANCE, PLAYER_SPEED, PLAYER_RADIUS, GLOB_RADIUS, GLOB_LIFETIME_MS, STEP_MS } from "../constants";
import type { Pickup, Player } from "../types";
import type { Observation } from "./index";
function distanceToSegment(x: number, y: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}
function intersects(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const cross = (x: number, y: number, u: number, v: number) => x * v - y * u;
  const denominator = cross(bx - ax, by - ay, dx - cx, dy - cy);
  if (!denominator) return false;
  const t = cross(cx - ax, cy - ay, dx - cx, dy - cy) / denominator;
  const u = cross(cx - ax, cy - ay, bx - ax, by - ay) / denominator;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
/** Bounded by six pickups and the bug cap; no retained target can outlive a safety check. */
export function safePickup(observation: Observation, p: Player): Pickup | undefined {
  if (!observation.pickups.length) return;
  if (observation.bugs.some(b => Math.hypot(b.x - p.x, b.y - p.y) <= PICKUP_SAFE_DISTANCE)) return;
  let best: Pickup | undefined, nearest = PICKUP_SEEK_DISTANCE;
  for (const pickup of observation.pickups) {
    const d = Math.hypot(pickup.x - p.x, pickup.y - p.y);
    if (d > nearest || d === nearest && best && pickup.id > best.id || pickup.expiresAt <= observation.tick * STEP_MS + d / PLAYER_SPEED * 1000 + STEP_MS) continue;
    // Test the proposed pickup route, rather than the policy's previous heading.
    if (observation.globs.some(g => {
      const horizon = Math.min(d / PLAYER_SPEED + STEP_MS / 1000, (g.born + GLOB_LIFETIME_MS - observation.tick * STEP_MS) / 1000);
      if (horizon <= 0) return false;
      const dx = g.x - p.x, dy = g.y - p.y;
      const vx = g.vx - (pickup.x - p.x) / (d || 1) * PLAYER_SPEED, vy = g.vy - (pickup.y - p.y) / (d || 1) * PLAYER_SPEED;
      const t = Math.max(0, Math.min(horizon, -(dx * vx + dy * vy) / (vx * vx + vy * vy || 1)));
      return Math.hypot(dx + vx * t, dy + vy * t) <= PLAYER_RADIUS + GLOB_RADIUS + 12;
    })) continue;
    const unsafe = observation.bugs.some(b => {
      if (distanceToSegment(b.x, b.y, p.x, p.y, pickup.x, pickup.y) < PICKUP_ROUTE_CLEARANCE) return true;
      if (b.kind !== "dasher" || b.phase !== "windup" && b.phase !== "dash") return false;
      const length = DASHER_DASH_SPEED * (b.phase === "dash" ? Math.max(0, b.phaseUntil! - observation.tick * STEP_MS) : DASHER_DASH_MS) / 1000;
      const ex = b.x + Math.cos(b.facing) * length, ey = b.y + Math.sin(b.facing) * length;
      return intersects(p.x, p.y, pickup.x, pickup.y, b.x, b.y, ex, ey) || Math.min(
        distanceToSegment(p.x, p.y, b.x, b.y, ex, ey), distanceToSegment(pickup.x, pickup.y, b.x, b.y, ex, ey),
        distanceToSegment(b.x, b.y, p.x, p.y, pickup.x, pickup.y), distanceToSegment(ex, ey, p.x, p.y, pickup.x, pickup.y)) < DASHER_DODGE_CLEARANCE;
    });
    if (!unsafe) { best = pickup; nearest = d; }
  }
  return best;
}
