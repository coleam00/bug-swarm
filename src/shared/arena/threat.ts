import { THREAT_CURVE } from "./constants";
/** Bugs per second, based only on seconds in the current life. */
export function threatRate(seconds: number): number {
  seconds = Math.max(0, seconds);
  for (let i = 1; i < THREAT_CURVE.length; i++) {
    const [a, low] = THREAT_CURVE[i - 1]!, [b, high] = THREAT_CURVE[i]!;
    if (seconds <= b) return low + (high - low) * (seconds - a) / (b - a);
  }
  return THREAT_CURVE.at(-1)![1];
}
