import { HIVE_RADIUS, HIVE_BASE_HEALTH, HIVE_PLAYER_HEALTH, HIVE_MAX_HEALTH, HIVE_SPEED, HIVE_GROUP_RADIUS, HIVE_CLEARANCE, HIVE_ARRIVAL_MS, HIVE_BROOD_MS, HIVE_RING_MS, HIVE_BROOD_COUNT, HIVE_RING_COUNT, HIVE_GLOB_SPEED, HIVE_REWARD_BASE, HIVE_REWARD_POOL, CRAWLER_RADIUS, MAX_BUGS, WORLD_WIDTH, WORLD_HEIGHT, STEP_MS } from "../constants";
import type { ArenaState, Bug, CombatPlayer, HiveReward } from "../types";
import type { BugDefinition } from "./definition";
import { createBug } from "./registry";
import { hivePlacement } from "./hive-placement";

export const arrivingHive = (bug: Bug) => bug.kind === "hive" && bug.phase === "arrival";
export function spawnHive(state: ArenaState, time: number) {
  if (state.hive) return;
  const position = hivePlacement(state.players.values());
  const bug = createBug("hive", state.nextId++, position.x, position.y, time);
  let living = 0; for (const p of state.players.values()) if (p.status !== "out") living++;
  bug.hp = bug.maxHp = HIVE_BASE_HEALTH + HIVE_PLAYER_HEALTH * living;
  const activation = time + (position.clearance + 1e-7 >= HIVE_CLEARANCE ? 0 : HIVE_ARRIVAL_MS);
  if (activation > time) { bug.phase = "arrival"; bug.phaseUntil = activation; }
  state.hive = { id: bug.id, broodAt: activation + HIVE_BROOD_MS, ringAt: activation + HIVE_RING_MS, contributions: new Map() };
  state.bugs.push(bug);
}

export function contributeHive(state: ArenaState, bug: Bug, player: CombatPlayer, damage: number) {
  const ledger = state.hive?.id === bug.id ? state.hive.contributions : undefined;
  if (!ledger) return;
  const old = ledger.get(player.id);
  ledger.set(player.id, { life: player.life, damage: damage + (old?.life === player.life ? old.damage : 0) });
}
/** Largest remainders conserve the pool; ended/replaced lives leave its denominator. */
export function rewardHive(state: ArenaState): HiveReward[] {
  const eligible: { player: CombatPlayer; damage: number; share: number; remainder: number }[] = [];
  for (const [id, credit] of state.hive?.contributions ?? []) {
    const p = state.players.get(id);
    if (p && p.status !== "out" && p.life === credit.life && credit.damage > 0) eligible.push({ player: p, damage: credit.damage, share: 0, remainder: 0 });
  }
  const damage = eligible.reduce((sum, e) => sum + e.damage, 0);
  let remaining = HIVE_REWARD_POOL;
  for (const e of eligible) { const numerator = HIVE_REWARD_POOL * e.damage; e.share = Math.floor(numerator / damage); e.remainder = numerator % damage; remaining -= e.share; }
  eligible.sort((a, b) => b.remainder - a.remainder || (a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0));
  for (let i = 0; i < remaining && i < eligible.length; i++) eligible[i]!.share++;
  const awards = eligible.map(({ player: p, share }) => {
    const amount = HIVE_REWARD_BASE + share; p.points += amount * 10; p.score = Math.round(p.points / 10);
    return { playerId: p.id, life: p.life, amount, x: p.x, y: p.y };
  });
  state.hive = undefined;
  return awards;
}

// Reused synchronous scratch, bounded by the room's 20 players.
const active: CombatPlayer[] = [];
export const hive: BugDefinition = {
  radius: HIVE_RADIUS, health: HIVE_MAX_HEALTH, points: 0,
  initialize(bug) { bug.maxHp = bug.hp; bug.phase = "active"; },
  advancePhase(bug, time) { if (bug.phase === "arrival" && time >= bug.phaseUntil!) { bug.phase = "active"; delete bug.phaseUntil; } },
  committedPhases: ["arrival"],
  move(bug, players, time) {
    hive.advancePhase!(bug, time);
    bug.vx = bug.vy = 0; if (arrivingHive(bug)) return;
    active.length = 0; for (const p of players) if (p.status === "active") active.push(p);
    let target: CombatPlayer | undefined, count = -1, nearest = Infinity;
    for (const p of active) {
      let neighbors = 0; for (const q of active) if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= HIVE_GROUP_RADIUS ** 2) neighbors++;
      const distance = (p.x - bug.x) ** 2 + (p.y - bug.y) ** 2;
      if (neighbors > count || neighbors === count && (distance < nearest || distance === nearest && p.id < target!.id)) { target = p; count = neighbors; nearest = distance; }
    }
    if (!target) return;
    let x = 0, y = 0;
    for (const p of active) if ((p.x - target.x) ** 2 + (p.y - target.y) ** 2 <= HIVE_GROUP_RADIUS ** 2) { x += p.x; y += p.y; }
    const dx = x / count - bug.x, dy = y / count - bug.y, d = Math.hypot(dx, dy);
    if (d) { bug.facing = Math.atan2(dy, dx); const speed = Math.min(HIVE_SPEED, d * 1000 / STEP_MS); bug.vx = dx / d * speed; bug.vy = dy / d * speed; }
    // The whole body stays in bounds, including during the following step.
    bug.vx = Math.max((HIVE_RADIUS - bug.x) * 1000 / STEP_MS, Math.min((WORLD_WIDTH - HIVE_RADIUS - bug.x) * 1000 / STEP_MS, bug.vx));
    bug.vy = Math.max((HIVE_RADIUS - bug.y) * 1000 / STEP_MS, Math.min((WORLD_HEIGHT - HIVE_RADIUS - bug.y) * 1000 / STEP_MS, bug.vy));
  },
  attack(bug, state, time) {
    const encounter = state.hive; if (!encounter || encounter.id !== bug.id || arrivingHive(bug) && time < bug.phaseUntil!) return;
    if (time >= encounter.broodAt) {
      encounter.broodAt = time + HIVE_BROOD_MS;
      for (let i = 0; i < HIVE_BROOD_COUNT && state.bugs.length < MAX_BUGS; i++) {
        const angle = bug.facing + i * Math.PI * 2 / HIVE_BROOD_COUNT, offset = HIVE_RADIUS + CRAWLER_RADIUS + 6;
        state.bugs.push(createBug("crawler", state.nextId++, Math.max(CRAWLER_RADIUS, Math.min(WORLD_WIDTH - CRAWLER_RADIUS, bug.x + Math.cos(angle) * offset)), Math.max(CRAWLER_RADIUS, Math.min(WORLD_HEIGHT - CRAWLER_RADIUS, bug.y + Math.sin(angle) * offset)), time));
      }
    }
    if (time >= encounter.ringAt) {
      encounter.ringAt = time + HIVE_RING_MS;
      for (let i = 0; i < HIVE_RING_COUNT; i++) { const angle = i * Math.PI / (HIVE_RING_COUNT / 2); state.globs.push({ id: state.nextId++, x: bug.x, y: bug.y, vx: Math.cos(angle) * HIVE_GLOB_SPEED, vy: Math.sin(angle) * HIVE_GLOB_SPEED, born: time, source: "hive" }); }
    }
  },
  valid(bug, time) {
    return Number.isSafeInteger(bug.maxHp) && bug.maxHp! >= HIVE_BASE_HEALTH && bug.maxHp! <= HIVE_MAX_HEALTH && (bug.maxHp! - HIVE_BASE_HEALTH) % HIVE_PLAYER_HEALTH === 0 && bug.hp <= bug.maxHp! &&
      (bug.phase === "active" ? bug.phaseUntil === undefined && Math.hypot(bug.vx, bug.vy) <= HIVE_SPEED + 0.1 : bug.phase === "arrival" && Number.isSafeInteger(bug.phaseUntil) && bug.phaseUntil! > time && bug.phaseUntil! <= time + HIVE_ARRIVAL_MS && bug.vx === 0 && bug.vy === 0);
  },
};
