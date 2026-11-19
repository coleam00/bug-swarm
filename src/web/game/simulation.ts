import { ARENA_SIZE, ROBOT_RADIUS, ROBOT_SPEED, BUG_RADIUS, BUG_SPEED, SPAWN_INTERVAL, FIRE_INTERVAL, SHOT_SPEED, SHOT_LIFETIME } from "./config";
import { POINTS_PER_SECOND, POINTS_PER_SQUASH } from "../../server/rules";

export interface Point { x: number; y: number }
export interface Input { x: number; y: number; target: Point | null }
export interface Bug extends Point { id: number }
export interface Shot extends Point { vx: number; vy: number; life: number }
export interface Simulation {
  seed: number; nextId: number; time: number; seconds: number; score: number; squashes: number;
  hits: number; dead: boolean; invulnerableUntil: number; spawnIn: number; fireIn: number;
  robot: Point; bugs: Bug[]; shots: Shot[];
}
export const IDLE: Input = { x: 0, y: 0, target: null };
export function createSimulation(seed: number): Simulation {
  return { seed: seed >>> 0, nextId: 1, time: 0, seconds: 0, score: 0, squashes: 0, hits: 0,
    dead: false, invulnerableUntil: 0, spawnIn: SPAWN_INTERVAL, fireIn: FIRE_INTERVAL,
    robot: { x: ARENA_SIZE / 2, y: ARENA_SIZE / 2 }, bugs: [], shots: [] };
}
export function random(state: Simulation): number {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
export function spawnBug(state: Simulation): void {
  const perimeter = random(state) * 4 * ARENA_SIZE;
  const edge = Math.floor(perimeter / ARENA_SIZE), position = perimeter % ARENA_SIZE;
  state.bugs.push({ id: state.nextId++, x: edge === 1 ? ARENA_SIZE : edge === 3 ? 0 : position,
    y: edge === 0 ? 0 : edge === 2 ? ARENA_SIZE : position });
}
export function nearestBug(state: Simulation): Bug | undefined {
  let nearest: Bug | undefined, distance = Infinity;
  for (const bug of state.bugs) {
    const d = (bug.x - state.robot.x) ** 2 + (bug.y - state.robot.y) ** 2;
    if (d < distance - 1e-8 || (Math.abs(d - distance) <= 1e-8 && bug.id < nearest!.id)) { distance = d; nearest = bug; }
  }
  return nearest;
}
function segmentDistanceSquared(x: number, y: number, nx: number, ny: number, point: Point): number {
  const dx = nx - x, dy = ny - y;
  const fraction = Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy || 1)));
  return (point.x - x - fraction * dx) ** 2 + (point.y - y - fraction * dy) ** 2;
}

// Mutates reusable working state. No clock, DOM, network, or unseeded random source.
export function step(state: Simulation, input: Input, dt: number): void {
  if (state.dead || dt <= 0) return;
  state.time += dt;
  let dx = input.x, dy = input.y, distance = Math.hypot(dx, dy);
  let travel = ROBOT_SPEED * dt;
  if (!distance && input.target) {
    dx = input.target.x - state.robot.x; dy = input.target.y - state.robot.y;
    distance = Math.hypot(dx, dy); travel = Math.min(travel, distance);
  }
  if (distance) {
    state.robot.x = Math.max(ROBOT_RADIUS, Math.min(ARENA_SIZE - ROBOT_RADIUS, state.robot.x + dx / distance * travel));
    state.robot.y = Math.max(ROBOT_RADIUS, Math.min(ARENA_SIZE - ROBOT_RADIUS, state.robot.y + dy / distance * travel));
  }
  state.spawnIn -= dt;
  while (state.spawnIn <= 1e-9) { spawnBug(state); state.spawnIn += SPAWN_INTERVAL; }
  for (const bug of state.bugs) {
    const bx = state.robot.x - bug.x, by = state.robot.y - bug.y, length = Math.hypot(bx, by);
    const amount = Math.min(BUG_SPEED * dt, length);
    if (length) { bug.x += bx / length * amount; bug.y += by / length * amount; }
  }
  state.fireIn -= dt;
  if (state.fireIn <= 1e-9) {
    state.fireIn += FIRE_INTERVAL;
    const target = nearestBug(state);
    if (target) {
      const sx = target.x - state.robot.x, sy = target.y - state.robot.y, length = Math.hypot(sx, sy) || 1;
      state.shots.push({ ...state.robot, vx: sx / length * SHOT_SPEED, vy: sy / length * SHOT_SPEED, life: SHOT_LIFETIME });
    }
  }
  let kept = 0;
  for (const shot of state.shots) {
    const nx = shot.x + shot.vx * dt, ny = shot.y + shot.vy * dt;
    let hit = -1, closest = Infinity;
    for (let i = 0; i < state.bugs.length; i++) {
      const bug = state.bugs[i]!;
      if (segmentDistanceSquared(shot.x, shot.y, nx, ny, bug) <= (BUG_RADIUS + 3) ** 2) {
        const distance = (bug.x - shot.x) ** 2 + (bug.y - shot.y) ** 2;
        if (distance < closest) { closest = distance; hit = i; }
      }
    }
    if (hit !== -1) { state.bugs.splice(hit, 1); state.squashes++; continue; }
    shot.x = nx; shot.y = ny; shot.life -= dt;
    if (shot.life > 0) state.shots[kept++] = shot;
  }
  state.shots.length = kept;
  kept = 0;
  for (const bug of state.bugs) {
    if ((bug.x - state.robot.x) ** 2 + (bug.y - state.robot.y) ** 2 <= (BUG_RADIUS + ROBOT_RADIUS) ** 2) {
      if (state.time >= state.invulnerableUntil) {
        state.hits++; state.invulnerableUntil = state.time + 1;
        if (state.hits === 3) state.dead = true;
      }
    } else state.bugs[kept++] = bug;
  }
  state.bugs.length = kept;
  state.seconds = Math.floor(state.time + 1e-9);
  state.score = state.squashes * POINTS_PER_SQUASH + state.seconds * POINTS_PER_SECOND;
}
