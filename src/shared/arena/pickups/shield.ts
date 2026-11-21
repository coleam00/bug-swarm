import { SHIELD_MS } from "../constants";
import type { PickupDefinition } from "./definition";
export const shield: PickupDefinition = {
  duration: SHIELD_MS,
  blockHit(player) { delete player.effects.shield; return true; },
};
