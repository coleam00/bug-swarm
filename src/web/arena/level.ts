import { THREAT_CURVE } from "../../shared/arena/constants";

// Present personal pacing milestones without changing pressure or gameplay.
export function personalLevel(ageSeconds: number): number {
  const age = Math.max(0, ageSeconds);
  let level = 1;
  for (let i = 1; i < THREAT_CURVE.length; i++) {
    if (age < THREAT_CURVE[i]![0]) break;
    level = i + 1;
  }
  return level;
}
