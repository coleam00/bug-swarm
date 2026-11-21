import { STEP_MS, WAVE_MS } from "../../shared/arena/constants";
import type { Snapshot } from "../../shared/arena/protocol";

export const HIVE_WARNING = "The hive is coming";
/** Immediate server time, independent of animation, interpolation and personal level. */
export function hiveWarning(snapshot?: Snapshot | null): number | null {
  if (!snapshot) return null;
  const hive = snapshot.bugs.find(b => b.kind === "hive"), now = snapshot.tick * STEP_MS;
  if (hive) return hive.phase === "arrival" ? Math.ceil(Math.max(0, (hive.phaseUntil ?? now) - now) / 1000) : null;
  const nextWave = (Math.floor(snapshot.wave / 5) + 1) * 5;
  const remaining = (nextWave - 1) * WAVE_MS - now;
  return remaining >= 0 && remaining < 10000 ? Math.ceil(remaining / 1000) : null;
}
