import { ROBOT_RADIUS, ROBOT_SPEED, BUG_KINDS, BUG_DEFINITIONS, FAST_BUG_EVERY, spawnInterval, bugSpeedMultiplier, FIRE_INTERVAL, SHOT_SPEED, SHOT_LIFETIME, DRONE_ORBIT_RADIUS, DRONE_ANGULAR_SPEED, type BugKind } from "./config";
import { SQUARE_ARENA, type Arena } from "./arena";
import { POINTS_PER_SECOND, POINTS_PER_SQUASH } from "../../server/rules";
import { REVIEW_LASER, TEST_SHIELD, REFACTOR_BOMB, CI_DRONE, shieldCapacity, bombRecharge, laserFireMultiplier, type UpgradeId } from "../../shared/upgrades";
import { createUpgrades, openChoice, selectUpgrade, type UpgradeState } from "./upgrades";

export interface Point { x: number; y: number }
export interface Input { x: number; y: number; target: Point | null }
export interface Bug extends Point { id: number; kind: BugKind }
// Read-only checkpoints around scored bomb/projectile resolution, before contact damage.
// Observers must not mutate the simulation or retain its array as a snapshot.
export interface KillObserver {
  beforeKills(bugs: readonly Readonly<Bug>[], squashes: number): void;
  afterKills(bugs: readonly Readonly<Bug>[], squashes: number): void;
}
export interface Shot extends Point { vx: number; vy: number; life: number; remaining?: number; laser?: boolean }
export interface Simulation {
  readonly arena: Arena;
  seed: number; nextId: number; time: number; seconds: number; score: number; squashes: number;
  hits: number; dead: boolean; invulnerableUntil: number; spawnIn: number; fireIn: number; eligibleSpawns: number;
  robot: Point; bugs: Bug[]; shots: Shot[];
  upgrades: UpgradeState;
  shieldCharges: number;
  bombReadyAt: number; bombLastAt: number; bombDetonations: number; bombOrigin: Point;
  drones: { fireIn: number }[]; droneOrigin: Point;
}
export const IDLE: Input = { x: 0, y: 0, target: null };
export function createSimulation(seed: number, arena: Arena = SQUARE_ARENA): Simulation {
  return { arena: Object.freeze({ ...arena }), seed: seed >>> 0, nextId: 1, time: 0, seconds: 0, score: 0, squashes: 0, hits: 0,
    dead: false, invulnerableUntil: 0, spawnIn: spawnInterval(0), fireIn: FIRE_INTERVAL, eligibleSpawns: 0,
    robot: { x: arena.width / 2, y: arena.height / 2 }, bugs: [], shots: [], upgrades: createUpgrades(seed), shieldCharges: 0,
    bombReadyAt: Infinity, bombLastAt: -Infinity, bombDetonations: 0, bombOrigin: { x: 0, y: 0 }, drones: [], droneOrigin: { x: 0, y: 0 } };
}
export function chooseUpgrade(state: Simulation, choiceNumber: number, id: UpgradeId): boolean {
  if (state.dead || !selectUpgrade(state.upgrades, choiceNumber, id)) return false;
  if (id === TEST_SHIELD) state.shieldCharges = shieldCapacity(state.upgrades.counts[TEST_SHIELD]);
  if (id === REFACTOR_BOMB) state.bombReadyAt = state.upgrades.counts[REFACTOR_BOMB] === 1
    ? state.time : state.bombLastAt + bombRecharge(state.upgrades.counts[REFACTOR_BOMB]);
  if (id === CI_DRONE) state.drones.push({ fireIn: 0 });
  if (id === REVIEW_LASER && state.upgrades.counts[REVIEW_LASER] === 1)
    state.fireIn = Math.min(state.fireIn, FIRE_INTERVAL * laserFireMultiplier(1));
  return true;
}
// Both drawing and firing use this calculation; the caller reuses its output.
export function dronePosition(state: Readonly<Simulation>, index: number, out: Point): void {
  const angle = state.time * DRONE_ANGULAR_SPEED + index * Math.PI * 2 / state.drones.length;
  out.x = state.robot.x + Math.cos(angle) * DRONE_ORBIT_RADIUS;
  out.y = state.robot.y + Math.sin(angle) * DRONE_ORBIT_RADIUS;
}
export function random(state: Simulation): number {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
export function spawnBug(state: Simulation, kind: BugKind = BUG_KINDS[0].id): void {
  const { width, height } = state.arena;
  let position = random(state) * 2 * (width + height);
  let x: number, y: number;
  if (position < width) { x = position; y = 0; }
  else if ((position -= width) < height) { x = width; y = position; }
  else if ((position -= height) < width) { x = width - position; y = height; }
  else { x = 0; y = height - (position - width); }
  state.bugs.push({ id: state.nextId++, kind, x, y });
}
export function nearestBug(state: Simulation, origin: Point = state.robot): Bug | undefined {
  let nearest: Bug | undefined, distance = Infinity;
  for (const bug of state.bugs) {
    const d = (bug.x - origin.x) ** 2 + (bug.y - origin.y) ** 2;
    if (d < distance - 1e-8 || (Math.abs(d - distance) <= 1e-8 && bug.id < nearest!.id)) { distance = d; nearest = bug; }
  }
  return nearest;
}
function fire(state: Simulation, origin: Point): void {
  const target = nearestBug(state, origin);
  if (!target) return;
  const sx = target.x - origin.x, sy = target.y - origin.y, length = Math.hypot(sx, sy) || 1;
  state.shots.push({ x: origin.x, y: origin.y, vx: sx / length * SHOT_SPEED, vy: sy / length * SHOT_SPEED, life: SHOT_LIFETIME,
    remaining: 1 + state.upgrades.counts[REVIEW_LASER], laser: state.upgrades.counts[REVIEW_LASER] > 0 });
}
function segmentDistanceSquared(x: number, y: number, nx: number, ny: number, point: Point): number {
  const dx = nx - x, dy = ny - y;
  const fraction = Math.max(0, Math.min(1, ((point.x - x) * dx + (point.y - y) * dy) / (dx * dx + dy * dy || 1)));
  return (point.x - x - fraction * dx) ** 2 + (point.y - y - fraction * dy) ** 2;
}

// Mutates reusable working state. No clock, DOM, network, or unseeded random source.
export function step(state: Simulation, input: Input, dt: number, observer?: KillObserver): number {
  if (state.dead || state.upgrades.offer || dt <= 0) return 0;
  dt = Math.min(dt, Math.max(0, state.upgrades.nextChoiceAt - state.time));
  state.time += dt;
  let dx = input.x, dy = input.y, distance = Math.hypot(dx, dy);
  let travel = ROBOT_SPEED * dt;
  if (!distance && input.target) {
    dx = input.target.x - state.robot.x; dy = input.target.y - state.robot.y;
    distance = Math.hypot(dx, dy); travel = Math.min(travel, distance);
  }
  if (distance) {
    state.robot.x = Math.max(ROBOT_RADIUS, Math.min(state.arena.width - ROBOT_RADIUS, state.robot.x + dx / distance * travel));
    state.robot.y = Math.max(ROBOT_RADIUS, Math.min(state.arena.height - ROBOT_RADIUS, state.robot.y + dy / distance * travel));
  }
  state.spawnIn -= dt;
  while (state.spawnIn <= 1e-9) {
    // Keep countdown overshoot: cadence and unlocks use scheduled time, not the frame boundary.
    const at = state.time + state.spawnIn;
    const fast = at + 1e-9 >= BUG_KINDS[1].unlockAt && state.eligibleSpawns++ % FAST_BUG_EVERY === 0;
    spawnBug(state, fast ? BUG_KINDS[1].id : BUG_KINDS[0].id);
    state.spawnIn += spawnInterval(at);
  }
  const speedMultiplier = bugSpeedMultiplier(state.time);
  for (const bug of state.bugs) {
    const bx = state.robot.x - bug.x, by = state.robot.y - bug.y, length = Math.hypot(bx, by);
    const amount = Math.min(BUG_DEFINITIONS[bug.kind].speed * speedMultiplier * dt, length);
    if (length) { bug.x += bx / length * amount; bug.y += by / length * amount; }
  }
  state.fireIn -= dt;
  if (state.fireIn <= 1e-9) {
    state.fireIn += FIRE_INTERVAL * laserFireMultiplier(state.upgrades.counts[REVIEW_LASER]);
    fire(state, state.robot);
  }
  // Reuse the simulation-owned scratch point; no per-frame drone positions.
  for (let i = 0; i < state.drones.length; i++) {
    const drone = state.drones[i]!;
    drone.fireIn -= dt;
    if (drone.fireIn <= 1e-9) {
      drone.fireIn += FIRE_INTERVAL;
      dronePosition(state, i, state.droneOrigin); fire(state, state.droneOrigin);
    }
  }
  observer?.beforeKills(state.bugs, state.squashes);
  if (state.time + 1e-9 >= state.bombReadyAt && state.bugs.length > 0) {
    state.squashes += state.bugs.length; state.bugs.length = 0;
    state.bombLastAt = state.time; state.bombReadyAt = state.time + bombRecharge(state.upgrades.counts[REFACTOR_BOMB]);
    state.bombDetonations++; state.bombOrigin.x = state.robot.x; state.bombOrigin.y = state.robot.y;
  }
  let kept = 0;
  for (const shot of state.shots) {
    const nx = shot.x + shot.vx * dt, ny = shot.y + shot.vy * dt;
    shot.remaining ??= 1;
    while (shot.remaining > 0) {
      let hit = -1, closest = Infinity, closestId = Infinity;
      for (let i = 0; i < state.bugs.length; i++) {
        const bug = state.bugs[i]!;
        if (segmentDistanceSquared(shot.x, shot.y, nx, ny, bug) <= (BUG_DEFINITIONS[bug.kind].radius + 3) ** 2) {
          const vx = nx - shot.x, vy = ny - shot.y, lengthSquared = vx * vx + vy * vy;
          const projection = ((bug.x - shot.x) * vx + (bug.y - shot.y) * vy) / (lengthSquared || 1);
          const perpendicular = (bug.x - shot.x) ** 2 + (bug.y - shot.y) ** 2 - projection * projection * lengthSquared;
          const distance = Math.max(0, projection - Math.sqrt(Math.max(0, (BUG_DEFINITIONS[bug.kind].radius + 3) ** 2 - perpendicular) / (lengthSquared || 1)));
          if (distance < closest - 1e-9 || (Math.abs(distance - closest) <= 1e-9 && bug.id < closestId)) {
            closest = distance; closestId = bug.id; hit = i;
          }
        }
      }
      if (hit === -1) break;
      state.bugs.splice(hit, 1); state.squashes++; shot.remaining--;
    }
    if (shot.remaining === 0) continue;
    shot.x = nx; shot.y = ny; shot.life -= dt;
    if (shot.life > 0) state.shots[kept++] = shot;
  }
  state.shots.length = kept;
  observer?.afterKills(state.bugs, state.squashes);
  // Contact costs protection/health, never a free enemy removal. Surviving
  // attackers can hit again after immunity unless the player moves or kills them.
  for (const bug of state.bugs) {
    if ((bug.x - state.robot.x) ** 2 + (bug.y - state.robot.y) ** 2 <= (BUG_DEFINITIONS[bug.kind].radius + ROBOT_RADIUS) ** 2 &&
      state.time >= state.invulnerableUntil) {
      if (state.shieldCharges > 0) state.shieldCharges--;
      else state.hits++;
      state.invulnerableUntil = state.time + 1;
      if (state.hits === 3) state.dead = true;
    }
  }
  state.seconds = Math.floor(state.time + 1e-9);
  state.score = state.squashes * POINTS_PER_SQUASH + state.seconds * POINTS_PER_SECOND;
  if (!state.dead && state.time + 1e-9 >= state.upgrades.nextChoiceAt) {
    state.time = state.upgrades.nextChoiceAt;
    openChoice(state.upgrades);
  }
  return dt;
}
