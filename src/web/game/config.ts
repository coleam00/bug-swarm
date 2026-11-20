export const ARENA_AREA = 360_000;
export const MIN_ARENA_ASPECT = 9 / 16;
export const MAX_ARENA_ASPECT = 16 / 9;
export const ROBOT_RADIUS = 14;
export const ROBOT_SPEED = 180;
export const BUG_KINDS = [
  { id: "base", speed: 40, radius: 12, color: "#e98278", unlockAt: 0 },
  { id: "fast", speed: 100, radius: 8, color: "#f3bf61", unlockAt: 30 },
] as const;
export type BugKind = typeof BUG_KINDS[number]["id"];
export const BUG_DEFINITIONS = Object.fromEntries(BUG_KINDS.map((kind) => [kind.id, kind])) as
  Record<BugKind, typeof BUG_KINDS[number]>;
export const FAST_BUG_EVERY = 4;
export const FIRST_SPAWN_DELAY = 9.3;
// Opening pursuit only eases toward normal speed; it never exceeds it.
export const OPENING_SPEED_CURVE = [
  { time: 0, multiplier: 0.6 }, { time: 15, multiplier: 1 },
] as const;
// Idle target: 18–40 seconds. Broad evasive median target: 75–110 seconds.
export const SPAWN_CURVE = [
  // Time to learn steering, then a short wave before the first upgrade. The
  // existing schedule resumes at 20s; weapons and upgrades do not change.
  { time: 0, interval: 0.35 }, { time: 11.7, interval: 0.35 },
  { time: 20, interval: 4 }, { time: 30, interval: 4 },
  { time: 60, interval: 0.3 }, { time: 120, interval: 0.2 }, { time: 180, interval: 0.18 },
] as const;
export function spawnInterval(time: number): number {
  for (let i = 1; i < SPAWN_CURVE.length; i++) {
    const end = SPAWN_CURVE[i]!, start = SPAWN_CURVE[i - 1]!;
    if (time < end.time) return start.interval + (end.interval - start.interval) *
      Math.max(0, (time - start.time) / (end.time - start.time));
  }
  // Approach six spawns/second from below, preserving server score plausibility.
  return 1 / 6 + (0.18 - 1 / 6) * Math.exp(-(time - 180) / 60);
}
export function bugSpeedMultiplier(time: number): number {
  for (let i = 1; i < OPENING_SPEED_CURVE.length; i++) {
    const start = OPENING_SPEED_CURVE[i - 1]!, end = OPENING_SPEED_CURVE[i]!;
    if (time < end.time) return start.multiplier + (end.multiplier - start.multiplier) *
      Math.max(0, (time - start.time) / (end.time - start.time));
  }
  return 1 + Math.max(0, time - 45) / 45 + (Math.max(0, time - 90) / 45) ** 2;
}
export const FIRE_INTERVAL = 1.5;
export const SHOT_SPEED = 420;
export const SHOT_LIFETIME = 3;
export const STEP = 1 / 60;
export const DRONE_ORBIT_RADIUS = 36;
export const DRONE_ANGULAR_SPEED = 2;
