import { SPITTER_RADIUS, SPITTER_HEALTH, SPITTER_POINTS, SPITTER_DISTANCE, SPITTER_SPEED, SPITTER_STRAFE_SPEED, SPITTER_CADENCE_MS, SPITTER_SWELL_MS, GLOB_MUZZLE_OFFSET, GLOB_SPEED, WORLD_WIDTH, WORLD_HEIGHT } from "../constants";
import { nearestPlayer, type BugDefinition } from "./definition";
import type { Bug } from "../types";

const movingMs = SPITTER_CADENCE_MS - SPITTER_SWELL_MS;
function advancePhase(bug: Bug, time: number) {
  while (time >= bug.phaseUntil!) {
    if (bug.phase === "move") { bug.phase = "swell"; bug.phaseUntil! += SPITTER_SWELL_MS; }
    else { bug.phase = "move"; bug.phaseUntil! += movingMs; }
    // Interpolation cannot infer a new target or emit an attack.
    bug.vx = bug.vy = 0;
  }
}
export const spitter: BugDefinition = {
  radius: SPITTER_RADIUS, health: SPITTER_HEALTH, points: SPITTER_POINTS,
  initialize(bug, time) { bug.phase = "move"; bug.phaseUntil = time + movingMs; },
  advancePhase, committedPhases: ["swell"],
  attack(bug, state, time) {
    if (bug.phase !== "swell" || time < bug.phaseUntil!) return;
    const target = nearestPlayer(bug, state.players.values()); if (!target) return;
    const angle = Math.atan2(target.y - bug.y, target.x - bug.x), dx = Math.cos(angle), dy = Math.sin(angle);
    state.globs.push({ id: state.nextId++, x: Math.max(0, Math.min(WORLD_WIDTH, bug.x + dx * GLOB_MUZZLE_OFFSET)), y: Math.max(0, Math.min(WORLD_HEIGHT, bug.y + dy * GLOB_MUZZLE_OFFSET)), vx: dx * GLOB_SPEED, vy: dy * GLOB_SPEED, born: time });
  },
  move(bug, players, time) {
    advancePhase(bug, time);
    const target = nearestPlayer(bug, players);
    if (!target) { bug.vx = bug.vy = 0; return; }
    const dx = target.x - bug.x, dy = target.y - bug.y, distance = Math.hypot(dx, dy);
    bug.facing = Math.atan2(dy, dx);
    if (bug.phase === "swell") { bug.vx = bug.vy = 0; return; }
    const radial = Math.max(-SPITTER_SPEED, Math.min(SPITTER_SPEED, (distance - SPITTER_DISTANCE) * 1.4));
    const nx = distance ? dx / distance : Math.cos(bug.facing), ny = distance ? dy / distance : Math.sin(bug.facing), side = bug.id % 2 ? 1 : -1;
    const vx = nx * radial - ny * SPITTER_STRAFE_SPEED * side, vy = ny * radial + nx * SPITTER_STRAFE_SPEED * side;
    const scale = Math.min(1, SPITTER_SPEED / Math.hypot(vx, vy)); bug.vx = vx * scale; bug.vy = vy * scale;
  },
  valid(bug, time) {
    const duration = bug.phase === "move" ? movingMs : bug.phase === "swell" ? SPITTER_SWELL_MS : 0;
    return duration > 0 && Number.isSafeInteger(bug.phaseUntil) && bug.phaseUntil! > time && bug.phaseUntil! <= time + duration && Math.hypot(bug.vx, bug.vy) <= (bug.phase === "swell" ? 0 : SPITTER_SPEED + 0.1);
  },
};
