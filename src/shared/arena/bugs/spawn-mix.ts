import { MAX_SPITTERS, SPITTER_SHARE, SPITTER_UNLOCK_WAVE, BEETLE_MAX_ALIVE, BEETLE_SHARE, BEETLE_UNLOCK_WAVE, DASHER_UNLOCK_WAVE, DASHER_FULL_WAVE, DASHER_INITIAL_SHARE, DASHER_FULL_SHARE } from "../constants";
import type { Bug, BugKind } from "../types";
export function dasherShare(wave: number) {
  return wave < DASHER_UNLOCK_WAVE ? 0 : DASHER_INITIAL_SHARE + (DASHER_FULL_SHARE - DASHER_INITIAL_SHARE) * Math.min(1, (wave - DASHER_UNLOCK_WAVE) / (DASHER_FULL_WAVE - DASHER_UNLOCK_WAVE));
}
const beetleShare = (wave: number) => wave >= BEETLE_UNLOCK_WAVE ? BEETLE_SHARE : 0;
const spitterShare = (wave: number, available: boolean) => wave >= SPITTER_UNLOCK_WAVE && available ? SPITTER_SHARE : 0;
const mix: { kind: BugKind; weight: (wave: number, spitterAvailable: boolean) => number; maxAlive?: number }[] = [
  { kind: "crawler", weight: (wave, available) => 1 - dasherShare(wave) - beetleShare(wave) - spitterShare(wave, available) },
  { kind: "dasher", weight: dasherShare },
  { kind: "spitter", weight: spitterShare },
  { kind: "beetle", weight: beetleShare, maxAlive: BEETLE_MAX_ALIVE },
];
export function spawnKind(wave: number, random: () => number, bugs: readonly Bug[] = []): BugKind {
  let spitters = 0;
  for (const bug of bugs) if (bug.kind === "spitter" && ++spitters >= MAX_SPITTERS) break;
  const spitterAvailable = spitters < MAX_SPITTERS;
  let total = 0, count = 0, only = mix[0]!.kind;
  for (const entry of mix) { const w = entry.weight(wave, spitterAvailable); total += w; if (w > 0) { count++; only = entry.kind; } }
  if (count === 1) return only;
  let choice = random() * total;
  for (const entry of mix) {
    choice -= entry.weight(wave, spitterAvailable);
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
