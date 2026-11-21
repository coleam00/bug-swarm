import { MAX_PLAYERS, PLAYER_HITS, PLAYER_RADIUS, STEP_MS, WAVE_MS } from "./constants";
import { threatRate } from "./threat";
import { movePlayer } from "./movement";
import { neutralInput, lifeDefaults, type ArenaState, type Input, type Player, type LifeResult } from "./types";
import { safeSpawn, spawnBug } from "./spawn";
import { BUGS } from "./bugs/registry";
import { fireAndAdvance, circleEntry } from "./combat";
import { motionFor, stopAtBoundary } from "./motion";
import { resolveRevives } from "./revive";
import { nextRandom } from "./random";
import { cleanupPickups, collectPickups } from "./pickups/lifecycle";
import { damagePlayer } from "./damage";
export function createArena(seed: number): ArenaState { return { tick: 0, random: seed >>> 0, pickupRandom: nextRandom((seed ^ 0x9e3779b9) >>> 0), pickups: [], players: new Map(), slots: new Map(),
  wave: 0, bugs: [], shots: [], events: [], ended: [], nextId: 1, spawnCredits: new Map(), spawnCursor: -1 }; }
export function joinPlayer(state: ArenaState, identity: Pick<Player, "id" | "name" | "team">) {
  if (state.players.has(identity.id) || state.players.size >= MAX_PLAYERS) return null;
  let slot = 0; const occupied = new Set(state.slots.values()); while (occupied.has(slot)) slot++;
  const p = { ...identity, ...safeSpawn(state), vx: 0, vy: 0, facing: 0, ...lifeDefaults(state.tick) };
  state.players.set(p.id, p); state.slots.set(p.id, slot); state.spawnCredits.set(p.id, 0); return p;
}
export function endLife(state: ArenaState, id: string): LifeResult | null {
  const p = state.players.get(id); if (!p || p.status === "out") return null;
  p.effects = {}; p.status = "out"; p.downedUntil = p.reviveMs = 0; p.reviving = false;
  p.hits = 0; p.vx = p.vy = 0; state.spawnCredits.delete(id);
  const result = { playerId: id, life: p.life, score: p.score, kills: p.kills, seconds: (state.tick - p.startedTick) * STEP_MS / 1000, touch: p.touch };
  state.shots = state.shots.filter(s => s.owner !== id || s.life !== p.life); state.ended.push(result); return result;
}
export function respawnPlayer(state: ArenaState, id: string, life: number) {
  const p = state.players.get(id); if (!p || p.status !== "out" || p.life !== life) return null;
  Object.assign(p, safeSpawn(state, id), lifeDefaults(state.tick, life + 1), { hits: PLAYER_HITS, vx: 0, vy: 0 }); state.spawnCredits.set(id, 0); return p;
}
export function leavePlayer(state: ArenaState, id: string): void { endLife(state, id); state.players.delete(id); state.slots.delete(id); }
export function stepArena(state: ArenaState, inputs: ReadonlyMap<string, Input>): void {
  state.events.length = 0; state.ended.length = 0;
  const time = state.tick * STEP_MS;
  cleanupPickups(state, time);
  let requested = false;
  for (const [id, p] of state.players) {
    if (p.status !== "active") { state.spawnCredits.delete(id); continue; }
    movePlayer(p, inputs.get(id) ?? neutralInput());
    const age = (state.tick - p.startedTick) * STEP_MS / 1000;
    // Knots align with fixed ticks: trapezoidal integration is exact on each segment.
    const credit = (state.spawnCredits.get(id) ?? 0) + (threatRate(age) + threatRate(age + STEP_MS / 1000)) * STEP_MS / 2000;
    state.spawnCredits.set(id, credit); requested ||= credit >= 1 - 1e-9;
  }
  collectPickups(state, time);
  if (state.tick % (WAVE_MS / STEP_MS) === 0) state.wave++;
  if (requested) {
    const start = state.spawnCursor + 1;
    for (let offset = 0; offset < MAX_PLAYERS; offset++) {
      const slot = (start + offset) % MAX_PLAYERS;
      for (const [id, p] of state.players) {
        if (state.slots.get(id) !== slot) continue;
        const credit = state.spawnCredits.get(id) ?? 0, count = Math.floor(credit + 1e-9);
        if (!count) continue;
        // Consume requests even at capacity or when placement fails; never bank a burst.
        state.spawnCredits.set(id, Math.max(0, credit - count));
        for (let i = 0; i < count; i++) if (spawnBug(state, p)) state.spawnCursor = slot;
      }
    }
  }
  for (const bug of state.bugs) { BUGS[bug.kind].move(bug, state.players.values(), time); stopAtBoundary(bug); }
  fireAndAdvance(state, inputs, time);
  for (const b of state.bugs) { const m = motionFor(b); b.x = m.x + m.vx * m.stop; b.y = m.y + m.vy * m.stop; }
  state.tick++;
  for (const p of state.players.values()) {
    if (p.status !== "active" || p.immuneUntil > time || p.spawnProtectedUntil > time) continue;
    for (const b of state.bugs) {
      const m = motionFor(b), dt = STEP_MS / 1000, px = p.x - p.vx * dt, py = p.y - p.vy * dt, radius = PLAYER_RADIUS + BUGS[b.kind].radius;
      const moving = circleEntry(px - m.x, py - m.y, (p.vx - m.vx) * m.stop, (p.vy - m.vy) * m.stop, radius);
      const stopped = circleEntry(px + p.vx * m.stop - b.x, py + p.vy * m.stop - b.y, p.vx * (dt - m.stop), p.vy * (dt - m.stop), radius);
      if (moving === null && stopped === null) continue;
      damagePlayer(state, p, time);
      break;
    }
  }
  for (const p of resolveRevives(state, state.tick * STEP_MS)) endLife(state, p.id);
  cleanupPickups(state, state.tick * STEP_MS);
  // Publish phase/velocity for the following interval, after resolving completed motion and life states.
  for (const b of state.bugs) { BUGS[b.kind].move(b, state.players.values(), state.tick * STEP_MS); stopAtBoundary(b); }
}
