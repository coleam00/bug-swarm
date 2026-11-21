import { DOWNED_MS, REVIVE_IMMUNITY_MS, REVIVE_MS, REVIVE_POINTS, REVIVE_RADIUS, STEP_MS } from "./constants";
import type { ArenaState, CombatPlayer } from "./types";

export function downPlayer(state: ArenaState, p: CombatPlayer, tick = state.tick) {
  p.effects = {}; p.status = "downed"; p.hits = 0; p.vx = p.vy = 0;
  p.downedUntil = tick * STEP_MS + DOWNED_MS; p.reviveMs = 0; p.reviving = false;
  state.spawnCredits.delete(p.id);
  // Cancellation is not a miss: preserve the life's accuracy streak.
  state.shots = state.shots.filter(s => s.owner !== p.id || s.life !== p.life);
}

export function resolveRevives(state: ArenaState, time: number): CombatPlayer[] {
  const rescues: { target: CombatPlayer; rescuer: CombatPlayer }[] = [], expired: CombatPlayer[] = [];
  for (const target of state.players.values()) {
    // Newly downed this step gets the full window, without retroactive contact.
    if (target.status !== "downed" || target.downedUntil === time + DOWNED_MS) continue;
    let rescuer: CombatPlayer | undefined;
    for (const p of state.players.values()) {
      if (p.status !== "active" || p.id === target.id) continue;
      const dx = p.x - target.x, dy = p.y - target.y;
      if (dx * dx + dy * dy <= REVIVE_RADIUS ** 2 && (!rescuer || p.id < rescuer.id)) rescuer = p;
    }
    target.reviving = !!rescuer;
    if (rescuer) target.reviveMs += STEP_MS;
    // The last interval counts before the deadline, so exact completion wins.
    if (rescuer && target.reviveMs >= REVIVE_MS) rescues.push({ target, rescuer });
    else if (time >= target.downedUntil) expired.push(target);
  }
  // Resolve eligibility together: a newly revived player cannot chain a rescue.
  for (const { target, rescuer } of rescues) {
    target.status = "active"; target.hits = 1; target.downedUntil = target.reviveMs = 0; target.reviving = false;
    target.immuneUntil = time + REVIVE_IMMUNITY_MS;
    rescuer.points += REVIVE_POINTS * 10; rescuer.score = Math.round(rescuer.points / 10);
  }
  return expired;
}
