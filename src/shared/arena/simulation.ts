import { MAX_PLAYERS, SPAWN_COLUMNS, SPAWN_JITTER, SPAWN_ROWS, SPAWN_SPACING, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { movePlayer } from "./movement";
import { nextRandom } from "./random";
import { neutralInput, type ArenaState, type Input, type Player } from "./types";
export function createArena(seed: number): ArenaState { return { tick: 0, random: seed >>> 0, players: new Map(), slots: new Map() }; }
export function joinPlayer(state: ArenaState, identity: Pick<Player, "id" | "name" | "team">): Player | null {
  if (state.players.has(identity.id) || state.players.size >= MAX_PLAYERS) return null;
  let slot = 0;
  const occupied = new Set(state.slots.values());
  while (occupied.has(slot)) slot++;
  const jitter = () => { state.random = nextRandom(state.random); return (state.random / 4294967296 - 0.5) * SPAWN_JITTER; };
  const player = { ...identity, x: WORLD_WIDTH / 2 + (slot % SPAWN_COLUMNS - (SPAWN_COLUMNS - 1) / 2) * SPAWN_SPACING + jitter(),
    y: WORLD_HEIGHT / 2 + (Math.floor(slot / SPAWN_COLUMNS) - (SPAWN_ROWS - 1) / 2) * SPAWN_SPACING + jitter(), vx: 0, vy: 0, facing: 0 };
  state.players.set(identity.id, player); state.slots.set(identity.id, slot);
  return player;
}
export function leavePlayer(state: ArenaState, id: string): void { state.players.delete(id); state.slots.delete(id); }
export function stepArena(state: ArenaState, inputs: ReadonlyMap<string, Input>): void {
  for (const [id, player] of state.players) movePlayer(player, inputs.get(id) ?? neutralInput());
  state.tick++;
}
