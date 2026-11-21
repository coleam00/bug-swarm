import { IMMUNITY_MS } from "./constants";
import { downPlayer } from "./revive";
import { PICKUPS, PICKUP_KINDS } from "./pickups/registry";
import type { ArenaState, CombatPlayer } from "./types";
/** The entry point for enemy contact and hostile globs. Returns whether a hit resolved. */
export function damagePlayer(state: ArenaState, p: CombatPlayer, time: number, downedTick = state.tick): boolean {
  if (p.status !== "active" || p.immuneUntil > time || p.spawnProtectedUntil > time) return false;
  p.immuneUntil = time + IMMUNITY_MS;
  for (const kind of PICKUP_KINDS) if ((p.effects[kind] ?? 0) > time && PICKUPS[kind].blockHit?.(p)) return true;
  if (p.hits === 1) downPlayer(state, p, downedTick); else p.hits--;
  return true;
}
