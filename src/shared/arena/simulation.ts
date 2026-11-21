import { IMMUNITY_MS, MAX_PLAYERS, PLAYER_HITS, PLAYER_RADIUS, STEP_MS, TRICKLE_RATE, WAVE_MS } from "./constants";
import { movePlayer } from "./movement";
import { neutralInput, lifeDefaults, type ArenaState, type Input, type Player, type LifeResult } from "./types";
import { safeSpawn, spawnBug } from "./spawn";
import { BUGS } from "./bugs/registry";
import { fireAndAdvance } from "./combat";
export function createArena(seed: number): ArenaState { return { tick: 0, random: seed >>> 0, players: new Map(), slots: new Map(),
  wave: 0, bugs: [], shots: [], events: [], ended: [], nextId: 1, spawnCredit: 0, spawnIndex: 0 }; }
export function joinPlayer(state: ArenaState, identity: Pick<Player, "id" | "name" | "team">) {
  if (state.players.has(identity.id) || state.players.size >= MAX_PLAYERS) return null;
  let slot = 0; const occupied = new Set(state.slots.values()); while (occupied.has(slot)) slot++;
  const p = { ...identity, ...safeSpawn(state), vx: 0, vy: 0, facing: 0, ...lifeDefaults(state.tick) };
  state.players.set(p.id, p); state.slots.set(p.id, slot); return p;
}
export function endLife(state: ArenaState, id: string): LifeResult | null {
  const p = state.players.get(id); if (!p || !p.hits) return null;
  p.hits = 0; p.vx = p.vy = 0;
  const result = { playerId: id, life: p.life, score: p.score, kills: p.kills, seconds: (state.tick - p.startedTick) * STEP_MS / 1000, touch: p.touch };
  state.shots = state.shots.filter(s => s.owner !== id || s.life !== p.life); state.ended.push(result); return result;
}
export function respawnPlayer(state: ArenaState, id: string, life: number) {
  const p = state.players.get(id); if (!p || p.hits || p.life !== life) return null;
  Object.assign(p, safeSpawn(state, id), lifeDefaults(state.tick, life + 1), { hits: PLAYER_HITS, vx: 0, vy: 0 }); return p;
}
export function leavePlayer(state: ArenaState, id: string): void { endLife(state, id); state.players.delete(id); state.slots.delete(id); }
export function stepArena(state: ArenaState, inputs: ReadonlyMap<string, Input>): void {
  state.events.length = 0; state.ended.length = 0;
  const time = state.tick * STEP_MS;
  let living = 0;
  for (const [id, p] of state.players) if (p.hits) { living++; movePlayer(p, inputs.get(id) ?? neutralInput()); }
  if (state.tick % (WAVE_MS / STEP_MS) === 0) { state.wave++; for (let i = 0; i < (6 + 3 * state.wave) * living; i++) if (!spawnBug(state)) break; }
  state.spawnCredit = living ? state.spawnCredit + living * TRICKLE_RATE * STEP_MS / 1000 : 0;
  while (state.spawnCredit >= 1 - 1e-9) { spawnBug(state); state.spawnCredit = Math.max(0, state.spawnCredit - 1); }
  for (const bug of state.bugs) BUGS[bug.kind].move(bug, state.players.values());
  fireAndAdvance(state, inputs, time);
  for (const b of state.bugs) { b.x += b.vx * STEP_MS / 1000; b.y += b.vy * STEP_MS / 1000; }
  state.tick++;
  for (const p of state.players.values()) {
    if (!p.hits || p.immuneUntil > time) continue;
    for (const b of state.bugs) if (Math.hypot(p.x - b.x, p.y - b.y) <= PLAYER_RADIUS + BUGS[b.kind].radius) {
      p.immuneUntil = time + IMMUNITY_MS;
      if (p.hits === 1) endLife(state, p.id); else p.hits--;
      break;
    }
  }
}
