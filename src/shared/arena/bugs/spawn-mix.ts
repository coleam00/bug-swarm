import { DASHER_UNLOCK_WAVE, DASHER_FULL_WAVE, DASHER_INITIAL_SHARE, DASHER_FULL_SHARE } from "../constants";
import type { BugKind } from "../types";
export function dasherShare(wave: number) {
  return wave < DASHER_UNLOCK_WAVE ? 0 : DASHER_INITIAL_SHARE + (DASHER_FULL_SHARE - DASHER_INITIAL_SHARE) * Math.min(1, (wave - DASHER_UNLOCK_WAVE) / (DASHER_FULL_WAVE - DASHER_UNLOCK_WAVE));
}
const mix: { kind: BugKind; weight: (wave: number) => number }[] = [
  { kind: "crawler", weight: () => 1 },
  { kind: "dasher", weight: wave => { const p = dasherShare(wave); return p / (1 - p); } },
];
export function spawnKind(wave: number, random: () => number): BugKind {
  let total = 0, count = 0, only = mix[0]!.kind;
  for (const entry of mix) { const w = entry.weight(wave); total += w; if (w > 0) { count++; only = entry.kind; } }
  if (count === 1) return only;
  let choice = random() * total;
  for (const entry of mix) { choice -= entry.weight(wave); if (choice < 0) return entry.kind; }
  return mix.at(-1)!.kind;
}
