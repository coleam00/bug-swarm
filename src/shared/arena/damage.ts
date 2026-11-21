import { IMMUNITY_MS } from "./constants";
import { downPlayer } from "./revive";
import type { ArenaState, CombatPlayer } from "./types";
/** Shared tick-time protection and downing rules for bodies and hostile globs. */
export function damagePlayer(state: ArenaState, p: CombatPlayer, time: number) {
  if (p.status !== "active" || p.immuneUntil > time || p.spawnProtectedUntil > time) return;
  p.immuneUntil = time + IMMUNITY_MS;
  if (p.hits === 1) downPlayer(state, p); else p.hits--;
}
