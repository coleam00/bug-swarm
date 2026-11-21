import { HEAT_CAPACITY, SHOT_LIFETIME_MS, SHOT_SPEED, WORLD_HEIGHT, WORLD_WIDTH, REVIVE_RADIUS, PLAYER_SPEED, STEP_MS } from "../constants";
import { nextRandom } from "../random";
import { clampMove } from "../movement";
import type { Bug, Input, Player, Life } from "../types";
export type Policy = "mover" | "aimer";
export interface Observation { players: readonly (Player & Pick<Life, "status">)[]; bugs: readonly Bug[] }
export interface PolicyState { random: number; x: number; y: number; pause: boolean; steps: number }
export const createPolicy = (seed: number): PolicyState => ({ random: seed >>> 0, x: 1200, y: 1200, pause: false, steps: 0 });
export function intercept(dx: number, dy: number, vx: number, vy: number): number | null {
  const a = vx * vx + vy * vy - SHOT_SPEED * SHOT_SPEED, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-8) { const t = -c / b; return t > 0 ? t : null; }
  const d = b * b - 4 * a * c; if (d < 0) return null;
  const t1 = (-b - Math.sqrt(d)) / (2 * a), t2 = (-b + Math.sqrt(d)) / (2 * a);
  const t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity); return Number.isFinite(t) ? t : null;
}
export function policyInput(policy: Policy, observation: Observation, p: Player & { heat?: number; status: Life["status"] }, state: PolicyState): Input {
  if (p.status !== "active") return { move: { x: 0, y: 0 }, aim: p.facing, fire: false };
  let x = 0, y = 0, aim = p.facing, fire = policy === "mover";
  let nearest: Bug | undefined, distance = Infinity;
  for (const b of observation.bugs) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < distance || d === distance && b.id < nearest!.id) { nearest = b; distance = d; } }
  if (policy === "aimer" && distance > 200) {
    let target: Observation["players"][number] | undefined, closest = 450;
    for (const q of observation.players) {
      if (q.id === p.id || q.status !== "downed") continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < closest || d === closest && (!target || q.id < target.id)) { target = q; closest = d; }
    }
    if (target) {
      const strength = closest > REVIVE_RADIUS ? Math.min(1, (closest - REVIVE_RADIUS + 1) / (PLAYER_SPEED * STEP_MS / 1000)) : 0;
      return { move: { x: (target.x - p.x) / (closest || 1) * strength, y: (target.y - p.y) / (closest || 1) * strength }, aim: p.facing, fire: false };
    }
  }
  if (policy === "mover" || !nearest) {
    if (state.steps++ % 90 === 0 || Math.hypot(state.x - p.x, state.y - p.y) < 80) {
      state.random = nextRandom(state.random); state.x = 150 + state.random / 4294967296 * (WORLD_WIDTH - 300);
      state.random = nextRandom(state.random); state.y = 150 + state.random / 4294967296 * (WORLD_HEIGHT - 300);
    }
    const length = Math.hypot(state.x - p.x, state.y - p.y) || 1; x = (state.x - p.x) / length; y = (state.y - p.y) / length;
  } else {
    // Approach at long range; retreat and circle inside the desired separation.
    const dx = (nearest.x - p.x) / (distance || 1), dy = (nearest.y - p.y) / (distance || 1);
    const radial = Math.max(-1, Math.min(1, (distance - 350) / 100));
    x = dx * radial - dy * 0.45; y = dy * radial + dx * 0.45;
    const t = intercept(nearest.x - p.x, nearest.y - p.y, nearest.vx, nearest.vy);
    if (t !== null) aim = Math.atan2(nearest.y + nearest.vy * t - p.y, nearest.x + nearest.vx * t - p.x);
    if ((p.heat ?? 0) >= Math.min(12, HEAT_CAPACITY - 1)) state.pause = true;
    if ((p.heat ?? 0) <= 3) state.pause = false;
    fire = !state.pause && t !== null && t <= SHOT_LIFETIME_MS / 1000;
  }
  for (const b of observation.bugs) {
    const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
    if (d < 150 && d > 0) { const force = (150 - d) / 150 * 2; x += dx / d * force; y += dy / d * force; }
  }
  x += Math.max(0, (180 - p.x) / 90) - Math.max(0, (p.x - WORLD_WIDTH + 180) / 90);
  y += Math.max(0, (180 - p.y) / 90) - Math.max(0, (p.y - WORLD_HEIGHT + 180) / 90);
  const move = clampMove(x, y);
  if (policy === "mover") aim = Math.atan2(move.y, move.x);
  return { move, aim, fire };
}
