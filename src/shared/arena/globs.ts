import { GLOB_LIFETIME_MS, GLOB_RADIUS, PLAYER_RADIUS, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { circleEntry } from "./combat";
import { boundaryTime } from "./motion";
import type { ArenaState, CombatPlayer, Glob } from "./types";

interface GlobMotion { duration: number }
interface GlobContact { glob: Glob; player: CombatPlayer; at: number }
const paths = new WeakMap<Glob, GlobMotion>();
export function globMotion(g: Glob) { return paths.get(g)!; }
/** Cache geometry before shots resolve; player eligibility is checked at each contact. */
export function prepareGlobs(state: ArenaState, time: number) {
  const contacts: GlobContact[] = [];
  for (const g of state.globs) {
    let m = paths.get(g); if (!m) { m = { duration: 0 }; paths.set(g, m); }
    m.duration = boundaryTime(g.x, g.y, g.vx, g.vy, Math.max(0, Math.min(STEP_MS, g.born + GLOB_LIFETIME_MS - time)) / 1000);
    for (const p of state.players.values()) {
      if (p.status !== "active") continue;
      const t = circleEntry(g.x - p.x + p.vx * STEP_MS / 1000, g.y - p.y + p.vy * STEP_MS / 1000, (g.vx - p.vx) * m.duration, (g.vy - p.vy) * m.duration, GLOB_RADIUS + PLAYER_RADIUS);
      if (t !== null) contacts.push({ glob: g, player: p, at: t * m.duration });
    }
  }
  return contacts.sort((a, b) => a.at - b.at || a.glob.id - b.glob.id || (a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0));
}
/** Contacts resolve between shot intervals; finish surviving travel and expiry. */
export function advanceGlobs(state: ArenaState, time: number) {
  let count = 0;
  for (const g of state.globs) {
    const m = globMotion(g); g.x += g.vx * m.duration; g.y += g.vy * m.duration;
    if (time + STEP_MS >= g.born + GLOB_LIFETIME_MS || g.x <= 0 || g.y <= 0 || g.x >= WORLD_WIDTH || g.y >= WORLD_HEIGHT) continue;
    state.globs[count++] = g;
  }
  state.globs.length = count;
}
