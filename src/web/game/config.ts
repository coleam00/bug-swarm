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
// Idle ceiling: 60 seconds. Evasive median target: 60–180 seconds.
export const SPAWN_CURVE = [
  { time: 0, interval: 0.9 }, { time: 20, interval: 0.8 }, { time: 30, interval: 0.7 },
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
  return 1 + Math.max(0, time - 45) / 45 + (Math.max(0, time - 90) / 45) ** 2;
}
export const FIRE_INTERVAL = 1.5;
export const SHOT_SPEED = 420;
export const SHOT_LIFETIME = 3;
export const STEP = 1 / 60;
export const DRONE_ORBIT_RADIUS = 36;
export const DRONE_ANGULAR_SPEED = 2;
