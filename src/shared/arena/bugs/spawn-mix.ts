import { SPITTER_UNLOCK_WAVE, SPITTER_SHARE } from "../constants";
import { DASHER_UNLOCK_WAVE, DASHER_FULL_WAVE, DASHER_INITIAL_SHARE, DASHER_FULL_SHARE } from "../constants";
import type { BugKind } from "../types";
export function dasherShare(wave: number) {
  return wave < DASHER_UNLOCK_WAVE ? 0 : DASHER_INITIAL_SHARE + (DASHER_FULL_SHARE - DASHER_INITIAL_SHARE) * Math.min(1, (wave - DASHER_UNLOCK_WAVE) / (DASHER_FULL_WAVE - DASHER_UNLOCK_WAVE));
}
export function spawnKind(wave: number, random: () => number, spitterAvailable = true): BugKind {
  const dasher = dasherShare(wave), spitter = wave >= SPITTER_UNLOCK_WAVE && spitterAvailable ? SPITTER_SHARE : 0;
  if (!dasher && !spitter) return "crawler";
  const choice = random();
  return choice < 1 - dasher - spitter ? "crawler" : choice < 1 - spitter ? "dasher" : "spitter";
}
