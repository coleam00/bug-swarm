import { MAX_PICKUPS, PICKUP_DROP_CHANCE, PICKUP_LIFETIME_MS, PICKUP_RADIUS, PLAYER_RADIUS, STEP_MS } from "../constants";
import { circleEntry } from "../combat";
import { nextRandom } from "../random";
import type { ArenaState, CombatPlayer, PickupKind } from "../types";
import { PICKUPS, PICKUP_KINDS } from "./registry";

export function expiresAt(kind: PickupKind, time: number) { return time + PICKUPS[kind].duration; }
export function cleanupPickups(state: ArenaState, time: number) {
  let count = 0;
  for (const pickup of state.pickups) if (pickup.expiresAt > time) state.pickups[count++] = pickup;
  state.pickups.length = count;
  for (const p of state.players.values()) for (const kind of PICKUP_KINDS)
    if (p.status !== "active" || (p.effects[kind] ?? 0) <= time) delete p.effects[kind];
}
export function dropPickup(state: ArenaState, kind: keyof typeof PICKUP_DROP_CHANCE, x: number, y: number, time: number) {
  // Every lethal hit consumes a chance roll, even at capacity. Spawning uses a separate stream.
  state.pickupRandom = nextRandom(state.pickupRandom);
  if (state.pickupRandom / 4294967296 >= PICKUP_DROP_CHANCE[kind] || state.pickups.length >= MAX_PICKUPS) return;
  let index = 0;
  if (PICKUP_KINDS.length > 1) { state.pickupRandom = nextRandom(state.pickupRandom); index = Math.floor(state.pickupRandom / 4294967296 * PICKUP_KINDS.length); }
  state.pickups.push({ id: state.nextId++, kind: PICKUP_KINDS[index]!, x, y, expiresAt: time + STEP_MS + PICKUP_LIFETIME_MS });
}
/** Call after player movement and before combat: new drops are available next step. */
export function collectPickups(state: ArenaState, time: number) {
  state.pickups.sort((a, b) => a.id - b.id);
  let count = 0;
  for (const pickup of state.pickups) {
    let winner: CombatPlayer | undefined, first = Infinity;
    for (const p of state.players.values()) {
      if (p.status !== "active") continue;
      const dx = p.vx * STEP_MS / 1000, dy = p.vy * STEP_MS / 1000;
      const entry = circleEntry(p.x - dx - pickup.x, p.y - dy - pickup.y, dx, dy, PLAYER_RADIUS + PICKUP_RADIUS);
      if (entry !== null && (entry < first || entry === first && (!winner || p.id < winner.id))) { winner = p; first = entry; }
    }
    if (winner) winner.effects[pickup.kind] = expiresAt(pickup.kind, time);
    else state.pickups[count++] = pickup;
  }
  state.pickups.length = count;
}
