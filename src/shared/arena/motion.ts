import { STEP_MS, WORLD_WIDTH, WORLD_HEIGHT } from "./constants";
import type { Bug } from "./types";
export interface BugMotion { x: number; y: number; vx: number; vy: number; stop: number }
const motions = new WeakMap<Bug, BugMotion>();
export function boundaryTime(x: number, y: number, vx: number, vy: number) {
  let stop = STEP_MS / 1000;
  if (vx > 0) stop = Math.min(stop, (WORLD_WIDTH - x) / vx); else if (vx < 0) stop = Math.min(stop, -x / vx);
  if (vy > 0) stop = Math.min(stop, (WORLD_HEIGHT - y) / vy); else if (vy < 0) stop = Math.min(stop, -y / vy);
  return Math.max(0, stop);
}
/** Reused per entity. A world edge stops the entire motion, without sliding. */
export function recordMotion(b: Bug) {
  let m = motions.get(b);
  if (!m) { m = { x: 0, y: 0, vx: 0, vy: 0, stop: 0 }; motions.set(b, m); }
  m.x = b.x; m.y = b.y; m.vx = b.vx; m.vy = b.vy; m.stop = boundaryTime(b.x, b.y, b.vx, b.vy);
  return m;
}
export function motionFor(b: Bug) { return motions.get(b)!; }
export function stopAtBoundary(b: Bug) {
  if (boundaryTime(b.x, b.y, b.vx, b.vy) === 0) b.vx = b.vy = 0;
}
