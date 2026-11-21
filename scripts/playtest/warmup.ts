import type { Connection, RoomManager } from "../../src/server/arena/rooms";
import { createPolicy, policyInput } from "../../src/shared/arena/policies";
import { STEP_MS } from "../../src/shared/arena/constants";
import { TEAMS } from "../../src/shared/teams";
export function validateWarmup(seconds: number, env: Record<string, string | undefined>) {
  if (env.ARENA_PLAYTEST !== "1") throw Error("Warm-up requires ARENA_PLAYTEST=1, including in production");
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 900) throw Error("Warm-up seconds must be an integer in 0..900");
}
/** Bot-only transport uses ordinary hello/input/respawn validation. Never used for browser players. */
export function botDriver(manager: RoomManager, count: number, seed: number) {
  const bots: { c: Connection; seq: number; policy: ReturnType<typeof createPolicy> }[] = [];
  for (let i = 0; i < count; i++) {
    const c = manager.open({ send() { return 1; }, close() {}, getBufferedAmount() { return 0; } });
    manager.message(c, JSON.stringify({ v: 1, type: "hello", playerId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, name: `WarmBot${i + 1}`, team: TEAMS[i % TEAMS.length], touch: false, buildId: manager.buildId }));
    if (!c.room) throw Error("Warm-up bot admission failed");
    bots.push({ c, seq: 0, policy: createPolicy(seed + i) });
  }
  return {
    bots,
    input() { for (const bot of bots) {
      const { c } = bot, state = c.room!.state, p = state.players.get(c.id!)!;
      if (p.status === "out") manager.message(c, JSON.stringify({ v: 1, type: "respawn", life: p.life, touch: false }));
      else if (p.status === "active") manager.message(c, JSON.stringify({ v: 1, type: "input", seq: ++bot.seq, life: p.life, touch: false, ...policyInput("aimer", { players: [...state.players.values()], bugs: state.bugs, globs: state.globs, tick: state.tick }, p, bot.policy) }));
    } },
  };
}
export async function warmRoom(manager: RoomManager, driver: ReturnType<typeof botDriver>, seconds: number, advanceClock: () => void, env: Record<string, string | undefined>) {
  validateWarmup(seconds, env);
  const owned = new Set(driver.bots.map(b => b.c));
  if (manager.rooms.size !== 1 || [...manager.active.values()].some(c => !owned.has(c))) throw Error("Warm-up requires one new bot-only room before human admission");
  const room = [...manager.rooms.values()][0]!;
  if (room.state.tick !== 0) throw Error("Warm-up only accepts a newly created arena");
  const start = performance.now(), steps = seconds * 1000 / STEP_MS;
  for (let i = 0; i < steps; i++) { advanceClock(); driver.input(); manager.tick(room, false); if (i % 100 === 0) await Bun.sleep(0); }
  if (!await manager.writer.drain(performance.now() + 4000)) throw Error("Warm-up lifecycle writes failed");
  return { seconds, steps, elapsedMs: performance.now() - start };
}
