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
// Idle target: 30–60 seconds. Moving target: 60–180 seconds.
export const SPAWN_CURVE = [
  { time: 0, interval: 1 }, { time: 30, interval: 0.8 },
  { time: 60, interval: 0.4 }, { time: 120, interval: 0.2 },
] as const;
export function spawnInterval(time: number): number {
  for (let i = 1; i < SPAWN_CURVE.length; i++) {
    const end = SPAWN_CURVE[i]!, start = SPAWN_CURVE[i - 1]!;
    if (time < end.time) return start.interval + (end.interval - start.interval) *
      Math.max(0, (time - start.time) / (end.time - start.time));
  }
  return SPAWN_CURVE[SPAWN_CURVE.length - 1]!.interval;
}
export const FIRE_INTERVAL = 1;
export const SHOT_SPEED = 420;
export const SHOT_LIFETIME = 3;
export const STEP = 1 / 60;
