import { BEETLE_MAX_ALIVE, BEETLE_SHARE, BEETLE_UNLOCK_WAVE, DASHER_UNLOCK_WAVE, DASHER_FULL_WAVE, DASHER_INITIAL_SHARE, DASHER_FULL_SHARE } from "../constants";
import type { Bug, BugKind } from "../types";
export function dasherShare(wave: number) {
  return wave < DASHER_UNLOCK_WAVE ? 0 : DASHER_INITIAL_SHARE + (DASHER_FULL_SHARE - DASHER_INITIAL_SHARE) * Math.min(1, (wave - DASHER_UNLOCK_WAVE) / (DASHER_FULL_WAVE - DASHER_UNLOCK_WAVE));
}
const beetleShare = (wave: number) => wave >= BEETLE_UNLOCK_WAVE ? BEETLE_SHARE : 0;
const mix: { kind: BugKind; weight: (wave: number) => number; maxAlive?: number }[] = [
  { kind: "crawler", weight: wave => 1 - dasherShare(wave) - beetleShare(wave) },
  { kind: "dasher", weight: dasherShare },
  { kind: "beetle", weight: beetleShare, maxAlive: BEETLE_MAX_ALIVE },
];
export function spawnKind(wave: number, random: () => number, bugs: readonly Bug[] = []): BugKind {
  let total = 0, count = 0, only = mix[0]!.kind;
  for (const entry of mix) { const w = entry.weight(wave); total += w; if (w > 0) { count++; only = entry.kind; } }
  if (count === 1) return only;
  let choice = random() * total;
  for (const entry of mix) {
    choice -= entry.weight(wave);
    if (choice < 0) {
      if (entry.maxAlive !== undefined) {
        let alive = 0;
        for (const bug of bugs) if (bug.kind === entry.kind && ++alive >= entry.maxAlive) return "crawler";
      }
      return entry.kind;
    }
  }
  return mix.at(-1)!.kind;
}
