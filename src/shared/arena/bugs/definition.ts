import type { ArenaState, Bug, CombatPlayer } from "../types";
export interface BugDefinition {
  radius: number; health: number; points: number;
  initialize(bug: Bug, time: number): void;
  /** Authoritative boundary only, before phase advancement; never called by rendering. */
  attack?(bug: Bug, state: ArenaState, time: number): void;
  /** Advance only committed phase/timer/velocity state, including skipped snapshots. */
  advancePhase?(bug: Bug, time: number): void;
  /** Velocity is locked until phaseUntil in these phases; advancePhase supplies the next interval. */
  committedPhases?: readonly string[];
  /** elapsedMs is positive only for the opening movement call of an actual step. */
  move(bug: Bug, players: Iterable<CombatPlayer>, time: number, elapsedMs?: number): void;
  /** Unit vector from the bug centre toward the projectile at earliest contact. */
  blocksShot?(bug: Bug, contactX: number, contactY: number): boolean;
  valid(bug: Bug, time: number): boolean;
}
export function nearestPlayer(bug: Bug, players: Iterable<CombatPlayer>) {
  let nearest: CombatPlayer | undefined, distance = Infinity;
  for (const p of players) {
    if (p.status !== "active") continue;
    const d = Math.hypot(p.x - bug.x, p.y - bug.y);
    if (d < distance || d === distance && p.id < nearest!.id) { nearest = p; distance = d; }
  }
  return nearest;
}
export function approach(bug: Bug, target: CombatPlayer | undefined, speed: number) {
  const dx = target ? target.x - bug.x : 0, dy = target ? target.y - bug.y : 0, d = Math.hypot(dx, dy);
  if (d) bug.facing = Math.atan2(dy, dx);
  bug.vx = d ? dx / d * speed : 0; bug.vy = d ? dy / d * speed : 0;
}
