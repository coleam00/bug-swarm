import type { CombatPlayer } from "../types";
export interface PickupDefinition {
  duration: number;
  /** Called only after status, spawn protection and hit immunity permit damage. */
  blockHit?: (player: CombatPlayer) => boolean;
  angles?: readonly number[];
  fireRate?: number;
  heatPerShot?: number;
}
