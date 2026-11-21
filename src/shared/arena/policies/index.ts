import { GLOB_LIFETIME_MS, GLOB_RADIUS } from "../constants";
import { DASHER_DASH_MS, DASHER_DASH_SPEED, DASHER_RADIUS, DASHER_DODGE_CLEARANCE, DASHER_DODGE_FORCE, PLAYER_RADIUS, HEAT_CAPACITY, SHOT_LIFETIME_MS, SHOT_SPEED, WORLD_HEIGHT, WORLD_WIDTH, REVIVE_RADIUS, PLAYER_SPEED, STEP_MS } from "../constants";
import { nextRandom } from "../random";
import { clampMove } from "../movement";
import type { Bug, Glob, Input, Player, Life, Pickup } from "../types";
import { shellBlocks } from "../bugs/beetle";
import { safePickup } from "./pickups";
export type Policy = "mover" | "aimer";
export interface Observation { players: readonly (Player & Pick<Life, "status">)[]; bugs: readonly Bug[]; globs: readonly Glob[]; pickups: readonly Pickup[]; tick: number }
export interface PolicyState { random: number; x: number; y: number; pause: boolean; steps: number; dodgeId?: number; dodgeX?: number; dodgeY?: number; flankId?: number; flankSide?: number; globDodgeId?: number; globDodgeX?: number; globDodgeY?: number }
export const createPolicy = (seed: number): PolicyState => ({ random: seed >>> 0, x: 1200, y: 1200, pause: false, steps: 0 });
export function intercept(dx: number, dy: number, vx: number, vy: number): number | null {
  const a = vx * vx + vy * vy - SHOT_SPEED * SHOT_SPEED, b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
  if (Math.abs(a) < 1e-8) { const t = -c / b; return t > 0 ? t : null; }
  const d = b * b - 4 * a * c; if (d < 0) return null;
  const t1 = (-b - Math.sqrt(d)) / (2 * a), t2 = (-b + Math.sqrt(d)) / (2 * a);
  const t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity); return Number.isFinite(t) ? t : null;
}
export function policyInput(policy: Policy, observation: Observation, p: Player & { heat?: number; status: Life["status"] }, state: PolicyState): Input {
  if (p.status !== "active") { state.flankId = state.flankSide = undefined; return { move: { x: 0, y: 0 }, aim: p.facing, fire: false }; }
  let x = 0, y = 0, aim = p.facing, fire = policy === "mover";
  let nearest: Bug | undefined, distance = Infinity;
  for (const b of observation.bugs) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < distance || d === distance && b.id < nearest!.id) { nearest = b; distance = d; } }
  // Rescue and avoidance always use the closest danger, independently of the gun target.
  let target = nearest, exposed = false, targetDistance = distance;
  if (policy === "aimer") {
    let closest = Infinity;
    for (const b of observation.bugs) {
      const t = intercept(b.x - p.x, b.y - p.y, b.vx, b.vy);
      if (t === null || t > SHOT_LIFETIME_MS / 1000) continue;
      const dx = p.x - b.x - b.vx * t, dy = p.y - b.y - b.vy * t, length = Math.hypot(dx, dy) || 1;
      if (b.kind === "beetle" && shellBlocks(b.facing, dx / length, dy / length, 0.12)) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < closest || d === closest && (!target || b.id < target.id)) { target = b; closest = d; exposed = true; }
    }
    targetDistance = target ? Math.hypot(target.x - p.x, target.y - p.y) : Infinity;
    if (target?.kind !== "beetle") state.flankId = state.flankSide = undefined;
  }
  if (policy === "mover" || !target) {
    if (state.steps++ % 90 === 0 || Math.hypot(state.x - p.x, state.y - p.y) < 80) {
      state.random = nextRandom(state.random); state.x = 150 + state.random / 4294967296 * (WORLD_WIDTH - 300);
      state.random = nextRandom(state.random); state.y = 150 + state.random / 4294967296 * (WORLD_HEIGHT - 300);
    }
    const length = Math.hypot(state.x - p.x, state.y - p.y) || 1; x = (state.x - p.x) / length; y = (state.y - p.y) / length;
  } else {
    // Approach at long range; retreat and circle inside the desired separation.
    const dx = (target.x - p.x) / (targetDistance || 1), dy = (target.y - p.y) / (targetDistance || 1);
    const radial = Math.max(-1, Math.min(1, (targetDistance - 350) / 100));
    x = dx * radial - dy * 0.45; y = dy * radial + dx * 0.45;
    const t = intercept(target.x - p.x, target.y - p.y, target.vx, target.vy);
    if (t !== null) aim = Math.atan2(target.y + target.vy * t - p.y, target.x + target.vx * t - p.x);
    if ((p.heat ?? 0) >= Math.min(12, HEAT_CAPACITY - 1)) state.pause = true;
    if ((p.heat ?? 0) <= 3) state.pause = false;
    fire = exposed && !state.pause && t !== null && t <= SHOT_LIFETIME_MS / 1000;
    if (target.kind === "beetle" && (!exposed || targetDistance < 200)) {
      const tx = -dy, ty = dx;
      const clearance = (side: number) => Math.min(
        tx * side > 0 ? (WORLD_WIDTH - PLAYER_RADIUS - p.x) / Math.abs(tx) : tx ? (p.x - PLAYER_RADIUS) / Math.abs(tx) : Infinity,
        ty * side > 0 ? (WORLD_HEIGHT - PLAYER_RADIUS - p.y) / Math.abs(ty) : ty ? (p.y - PLAYER_RADIUS) / Math.abs(ty) : Infinity);
      if (state.flankId !== target.id || clearance(state.flankSide ?? 1) < 65) {
        state.flankId = target.id; state.flankSide = clearance(-1) > clearance(1) ? -1 : 1;
      }
      const radial = Math.max(-1.5, Math.min(1, (targetDistance - 85) / 45));
      x = dx * radial + tx * state.flankSide! * 1.4 + target.vx / PLAYER_SPEED;
      y = dy * radial + ty * state.flankSide! * 1.4 + target.vy / PLAYER_SPEED;
    }
    if (exposed) state.flankId = state.flankSide = undefined;
  }
  for (const b of observation.bugs) {
    const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
    const separation = policy === "aimer" && b.id === target?.id && b.kind === "beetle" ? 65 : 150;
    if (d < separation && d > 0) { const force = (separation - d) / separation * 2; x += dx / d * force; y += dy / d * force; }
  }
  x += Math.max(0, (180 - p.x) / 90) - Math.max(0, (p.x - WORLD_WIDTH + 180) / 90);
  y += Math.max(0, (180 - p.y) / 90) - Math.max(0, (p.y - WORLD_HEIGHT + 180) / 90);
  let dodging = false;
  if (policy === "aimer") {
    const committed = observation.bugs.find(b => b.id === state.dodgeId && (b.phase === "windup" || b.phase === "dash"));
    let threat = committed;
    if (!threat) {
      state.dodgeId = undefined;
      for (const b of observation.bugs) {
        if (b.kind !== "dasher" || b.phase !== "windup") continue;
        const dx = p.x - b.x, dy = p.y - b.y, along = dx * Math.cos(b.facing) + dy * Math.sin(b.facing);
        const across = Math.abs(-dx * Math.sin(b.facing) + dy * Math.cos(b.facing));
        if (along < 0 || along > DASHER_DASH_SPEED * DASHER_DASH_MS / 1000 + PLAYER_RADIUS + DASHER_RADIUS || across > PLAYER_RADIUS + DASHER_RADIUS + 12) continue;
        if (!threat || b.phaseUntil! < threat.phaseUntil! || b.phaseUntil === threat.phaseUntil && b.id < threat.id) threat = b;
      }
      if (threat) {
        let dx = -Math.sin(threat.facing), dy = Math.cos(threat.facing);
        const clearance = (sign: number) => Math.min(
          dx * sign > 0 ? (WORLD_WIDTH - PLAYER_RADIUS - p.x) / Math.abs(dx) : dx ? (p.x - PLAYER_RADIUS) / Math.abs(dx) : Infinity,
          dy * sign > 0 ? (WORLD_HEIGHT - PLAYER_RADIUS - p.y) / Math.abs(dy) : dy ? (p.y - PLAYER_RADIUS) / Math.abs(dy) : Infinity);
        if (clearance(-1) > clearance(1)) { dx = -dx; dy = -dy; }
        state.dodgeId = threat.id; state.dodgeX = dx; state.dodgeY = dy;
      }
    }
    if (threat) {
      const dx = p.x - threat.x, dy = p.y - threat.y;
      const along = dx * Math.cos(threat.facing) + dy * Math.sin(threat.facing);
      const across = Math.abs(-dx * Math.sin(threat.facing) + dy * Math.cos(threat.facing));
      // Keep the escape side through the dash, but preserve crowd avoidance and
      // stop pushing once clear of the corridor (or beyond the dash's reach).
      if (along >= 0 && along <= DASHER_DASH_SPEED * DASHER_DASH_MS / 1000 + PLAYER_RADIUS + DASHER_RADIUS && across < DASHER_DODGE_CLEARANCE) {
        dodging = true;
        x += state.dodgeX! * DASHER_DODGE_FORCE; y += state.dodgeY! * DASHER_DODGE_FORCE;
      }
    }
  }
  if (policy === "aimer") {
    let threat: Glob | undefined, first = Infinity;
    const movement = clampMove(x, y), clearance = PLAYER_RADIUS + GLOB_RADIUS + 12;
    for (const g of observation.globs) {
      const horizon = Math.min(1, (g.born + GLOB_LIFETIME_MS - observation.tick * STEP_MS) / 1000);
      if (horizon <= 0) continue;
      // Check both holding position and the intended path: do not step into a glob.
      for (const moving of [false, true]) {
        const dx = g.x - p.x, dy = g.y - p.y, vx = g.vx - (moving ? movement.x * PLAYER_SPEED : 0), vy = g.vy - (moving ? movement.y * PLAYER_SPEED : 0);
        const dot = dx * vx + dy * vy, speed2 = vx * vx + vy * vy;
        if (dot >= 0 || !speed2) continue;
        const t = Math.min(horizon, -dot / speed2);
        if (Math.hypot(dx + vx * t, dy + vy * t) > clearance) continue;
        if (t < first || t === first && g.id < threat!.id) { threat = g; first = t; }
      }
    }
    if (threat) {
      if (state.globDodgeId !== threat.id) {
        const speed = Math.hypot(threat.vx, threat.vy); let dx = -threat.vy / speed, dy = threat.vx / speed;
        const room = (sign: number) => Math.min(
          dx * sign > 0 ? (WORLD_WIDTH - PLAYER_RADIUS - p.x) / Math.abs(dx) : dx ? (p.x - PLAYER_RADIUS) / Math.abs(dx) : Infinity,
          dy * sign > 0 ? (WORLD_HEIGHT - PLAYER_RADIUS - p.y) / Math.abs(dy) : dy ? (p.y - PLAYER_RADIUS) / Math.abs(dy) : Infinity);
        if (room(-1) > room(1)) { dx = -dx; dy = -dy; }
        state.globDodgeId = threat.id; state.globDodgeX = dx; state.globDodgeY = dy;
      }
      dodging = true; x += state.globDodgeX! * 2.5; y += state.globDodgeY! * 2.5;
    } else state.globDodgeId = undefined;
  }
  if (policy === "aimer" && distance > 200 && !dodging) {
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
  if (policy === "aimer" && !dodging && state.flankId === undefined) {
    const pickup = safePickup(observation, p);
    if (pickup) { const dx = pickup.x - p.x, dy = pickup.y - p.y, d = Math.hypot(dx, dy) || 1; x = dx / d; y = dy / d; }
  }
  const move = clampMove(x, y);
  if (policy === "mover") aim = Math.atan2(move.y, move.x);
  return { move, aim, fire };
}
