import { GLOB_LIFETIME_MS, GLOB_RADIUS, PLAYER_RADIUS, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { circleEntry } from "./combat";
import { boundaryTime } from "./motion";
import { damagePlayer } from "./damage";
import type { ArenaState, CombatPlayer, Glob } from "./types";

interface GlobMotion { duration: number; contact: number; contacts: { player: CombatPlayer; at: number }[] }
const paths = new WeakMap<Glob, GlobMotion>();
export function globMotion(g: Glob) { return paths.get(g)!; }
/** Cache before shots resolve, using the player's actual clamped displacement. */
export function prepareGlobs(state: ArenaState, time: number) {
  for (const g of state.globs) {
    let m = paths.get(g); if (!m) { m = { duration: 0, contact: Infinity, contacts: [] }; paths.set(g, m); }
    m.duration = boundaryTime(g.x, g.y, g.vx, g.vy, Math.max(0, Math.min(STEP_MS, g.born + GLOB_LIFETIME_MS - time)) / 1000);
    m.contact = Infinity; m.contacts.length = 0;
    for (const p of state.players.values()) {
      if (p.status !== "active") continue;
      const t = circleEntry(g.x - p.x + p.vx * STEP_MS / 1000, g.y - p.y + p.vy * STEP_MS / 1000, (g.vx - p.vx) * m.duration, (g.vy - p.vy) * m.duration, GLOB_RADIUS + PLAYER_RADIUS);
      if (t !== null) { const at = t * m.duration; m.contacts.push({ player: p, at }); m.contact = Math.min(m.contact, at); }
    }
  }
}
/** Surviving globs consume on contact even when protection prevents damage. */
export function advanceGlobs(state: ArenaState, time: number) {
  const contacts = state.globs.flatMap(g => globMotion(g).contacts.map(c => ({ ...c, glob: g })));
  contacts.sort((a, b) => a.at - b.at || a.glob.id - b.glob.id || (a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0));
  const consumed = new Set<Glob>();
  for (const c of contacts) if (!consumed.has(c.glob) && c.player.status === "active") { consumed.add(c.glob); damagePlayer(state, c.player, time); }
  let count = 0;
  for (const g of state.globs) {
    if (consumed.has(g)) continue;
    const m = globMotion(g); g.x += g.vx * m.duration; g.y += g.vy * m.duration;
    if (time + STEP_MS >= g.born + GLOB_LIFETIME_MS || g.x <= 0 || g.y <= 0 || g.x >= WORLD_WIDTH || g.y >= WORLD_HEIGHT) continue;
    state.globs[count++] = g;
  }
  state.globs.length = count;
}
