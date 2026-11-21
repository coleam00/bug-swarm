import { BUG_SPAWN_MAX, BUG_SPAWN_MIN, MAX_BUGS, MAX_VIEW, PLAYER_RADIUS, SAFE_SPAWN_CLEARANCE, SAFE_SPAWN_INSET, SPAWN_CLEARANCE, VISIBILITY_PADDING, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { nextRandom } from "./random";
import { cameraFor } from "./view";
import type { ArenaState, CombatPlayer } from "./types";
export function random(state: ArenaState) { state.random = nextRandom(state.random); return state.random / 4294967296; }
export function safeSpawn(state: ArenaState, except?: string) {
  let best = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 }, bestScore = -Infinity;
  const width = WORLD_WIDTH - 2 * SAFE_SPAWN_INSET, height = WORLD_HEIGHT - 2 * SAFE_SPAWN_INSET;
  for (let i = 0; i < 320; i++) {
    const x = SAFE_SPAWN_INSET + (i < 64 ? random(state) : ((i - 64) % 16 + 0.5) / 16) * width;
    const y = SAFE_SPAWN_INSET + (i < 64 ? random(state) : (Math.floor((i - 64) / 16) + 0.5) / 16) * height;
    let clearance = Infinity, overlap = false;
    for (const b of state.bugs) clearance = Math.min(clearance, Math.hypot(x - b.x, y - b.y));
    for (const p of state.players.values()) if (p.id !== except && p.hits && Math.hypot(x - p.x, y - p.y) < PLAYER_RADIUS * 2) { overlap = true; break; }
    if (overlap) continue;
    const score = state.bugs.length ? clearance : -Math.hypot(x - WORLD_WIDTH / 2, y - WORLD_HEIGHT / 2);
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  pushBugsFromSpawn(state, best);
  return best;
}
/** Crowded rooms never delay or transfer a join. Displace attackers without scoring. */
export function pushBugsFromSpawn(state: ArenaState, point: { x: number; y: number }) {
  for (const b of state.bugs) {
    const dx = b.x - point.x, dy = b.y - point.y, distance = Math.hypot(dx, dy);
    if (distance >= SAFE_SPAWN_CLEARANCE) continue;
    const angle = b.id * 2.399963229728653;
    b.x = point.x + (distance ? dx / distance : Math.cos(angle)) * SAFE_SPAWN_CLEARANCE;
    b.y = point.y + (distance ? dy / distance : Math.sin(angle)) * SAFE_SPAWN_CLEARANCE;
  }
}
export function spawnBug(state: ArenaState, source: CombatPlayer): boolean {
  if (state.bugs.length >= MAX_BUGS || !source.hits) return false;
  for (let i = 0; i < 224; i++) {
    const angle = i < 32 ? random(state) * Math.PI * 2 : ((i - 32) % 64) * Math.PI / 32;
    const radius = i < 32 ? Math.sqrt(BUG_SPAWN_MIN ** 2 + random(state) * (BUG_SPAWN_MAX ** 2 - BUG_SPAWN_MIN ** 2)) : BUG_SPAWN_MIN + Math.floor((i - 32) / 64) * (BUG_SPAWN_MAX - BUG_SPAWN_MIN) / 2;
    const x = source.x + Math.cos(angle) * radius, y = source.y + Math.sin(angle) * radius;
    if (x < 0 || x > WORLD_WIDTH || y < 0 || y > WORLD_HEIGHT) continue;
    let valid = true;
    for (const p of state.players.values()) if (p.hits) {
      const camera = cameraFor(p.x, p.y, MAX_VIEW, MAX_VIEW);
      if (Math.hypot(p.x - x, p.y - y) < SPAWN_CLEARANCE ||
        x >= camera.x - VISIBILITY_PADDING && x <= camera.x + MAX_VIEW + VISIBILITY_PADDING &&
        y >= camera.y - VISIBILITY_PADDING && y <= camera.y + MAX_VIEW + VISIBILITY_PADDING) { valid = false; break; }
    }
    if (valid) { state.bugs.push({ id: state.nextId++, kind: "crawler", x, y, vx: 0, vy: 0 }); return true; }
  }
  return false;
}
