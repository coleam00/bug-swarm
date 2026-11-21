import { MAX_BUGS, PLAYER_RADIUS, SPAWN_CLEARANCE, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { nextRandom } from "./random";
import type { ArenaState } from "./types";
export function random(state: ArenaState) { state.random = nextRandom(state.random); return state.random / 4294967296; }
export function safeSpawn(state: ArenaState, except?: string) {
  let best = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }, bestScore = -Infinity;
  for (let i = 0; i < 320; i++) {
    const margin = PLAYER_RADIUS * 5; // Leave room for the robot and heat bar at a clamped camera edge.
    const x = i < 64 ? margin + random(state) * (WORLD_WIDTH - 2 * margin) : (0.5 + (i - 64) % 16) * WORLD_WIDTH / 16;
    const y = i < 64 ? margin + random(state) * (WORLD_HEIGHT - 2 * margin) : (0.5 + Math.floor((i - 64) / 16)) * WORLD_HEIGHT / 16;
    let clearance = 10000, overlap = false;
    for (const b of state.bugs) clearance = Math.min(clearance, Math.hypot(x - b.x, y - b.y));
    for (const p of state.players.values()) if (p.id !== except && p.hits && Math.hypot(x - p.x, y - p.y) < PLAYER_RADIUS * 2) overlap = true;
    const score = (overlap ? -100000 : 0) + Math.min(clearance, 300) * 10 + (state.bugs.length ? clearance : -Math.hypot(x - 1200, y - 1200));
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}
export function spawnBug(state: ArenaState): boolean {
  if (state.bugs.length >= MAX_BUGS) return false;
  const edge = state.spawnIndex++ % 2 === 0;
  for (let i = 0; i < 288; i++) {
    let x = i < 32 ? random(state) * WORLD_WIDTH : ((i - 32) % 16 + 0.5) * WORLD_WIDTH / 16;
    let y = i < 32 ? random(state) * WORLD_HEIGHT : (Math.floor((i - 32) / 16) + 0.5) * WORLD_HEIGHT / 16;
    if (edge && i < 32) { const side = Math.floor(random(state) * 4); if (side < 2) x = side * WORLD_WIDTH; else y = (side - 2) * WORLD_HEIGHT; }
    else if (edge) { const side = (i - 32) % 4; if (side < 2) x = side * WORLD_WIDTH; else y = (side - 2) * WORLD_HEIGHT; }
    let valid = true;
    for (const p of state.players.values()) if (p.hits && Math.hypot(p.x - x, p.y - y) < SPAWN_CLEARANCE) { valid = false; break; }
    if (valid) { state.bugs.push({ id: state.nextId++, kind: "crawler", x, y, vx: 0, vy: 0 }); return true; }
  }
  return false;
}
