import { BUGS } from "../../../src/shared/arena/bugs/registry";
import type { Context } from "../context";
import type { CombatEvent } from "../../../src/shared/arena/types";
import { same } from "../agreement";
import type { ArenaFrame } from "../../../src/web/arena/observation";
import { HIVE_RADIUS, WORLD_WIDTH, WORLD_HEIGHT } from "../../../src/shared/arena/constants";
import { minimapBounds } from "../../../src/web/arena/minimap";
export function hiveBodyInView(f: ArenaFrame) {
  // Hive art has a large warning extent. Dispatching that draw is not proof
  // that the body itself entered this screen.
  const radius = HIVE_RADIUS * f.scale, map = minimapBounds(f.width, f.height, WORLD_WIDTH, WORLD_HEIGHT, true);
  return f.paint.bugs.some(b => {
    const x = (b.x - f.camera.x) * f.scale, y = (b.y - f.camera.y) * f.scale;
    return b.kind === "hive" && x - radius >= 0 && x + radius <= f.width && y - radius >= 86 && y + radius <= f.height &&
      !(x + radius > map.x && x - radius < map.x + map.width && y + radius > map.y && y - radius < map.y + map.height);
  });
}
/** Adapter for main's fifth-wave hive; every action remains browser input. */
export default async function boss(c: Context) {
  if (!("hive" in BUGS)) {
    c.report.status = "skip"; c.report.skip = "No hive exists in the bug registry.";
    console.log("boss: SKIP — " + c.report.skip); return;
  }
  // Idle setup bots die naturally and wait at life-over, then respawn through
  // the normal protocol. This reaches wave five without aged-life pressure.
  await c.startServer(119, true);
  // Freeze encounter health with the two setup bots. Browser startup speed must
  // not decide whether some humans enter before the fifth-wave boundary.
  await c.wait("Setup bots reach the fifth-wave hive before browser admission", () =>
    !!c.latest?.snapshots.at(-1)?.bugs.some(b => b.kind === "hive"), 10000);
  await c.join();
  const arrows = new Set<string>(), bodies = new Set<string>(), awards = new Map<string, { amount: number; life: number }>();
  let killed: Extract<CombatEvent, { type: "kill" }> | undefined;
  const observe = () => {
    for (const p of c.players) {
      const f = p.observation!.frame!, boss = f.paint.hive;
      if (boss) {
        const authority = c.latest!.snapshots.find(s => s.tick === f.snapshot.tick && s.arenaId === f.snapshot.arenaId)?.bugs.find(b => b.id === boss.id);
        c.check(`${p.name} painted hive health agrees with server`, authority && boss.hp === authority.hp && boss.maxHp === authority.maxHp);
        if (boss.arrow) arrows.add(p.name);
      }
      for (const reward of f.paint.hiveRewards ?? []) if (reward.playerId === f.playerId) awards.set(`${reward.playerId}/${reward.life}`, reward);
    }
    killed ??= c.latest!.snapshots.flatMap(s => s.events).find((e): e is Extract<CombatEvent, { type: "kill" }> => e.type === "kill" && e.kind === "hive");
  };
  await c.wait("fifth-wave hive health and off-screen arrow on every screen", () => { observe(); return arrows.size === c.players.length; }, 10000);
  c.check("Bots and browsers share the fifth-wave arena", c.players.every(p => p.observation!.frame!.snapshot.wave === 5));
  await c.capture("hive-edge-arrow");
  c.players.forEach(p => { p.plan = "boss"; });
  const bodyDeadline = performance.now() + 30000;
  while (bodies.size < c.players.length && performance.now() < bodyDeadline) {
    await c.run(100, async () => {
      observe();
      for (const p of c.players) if (!bodies.has(p.name) && hiveBodyInView(p.observation!.frame!)) {
        bodies.add(p.name); await c.capture(`hive-body-${p.name}`);
      }
    });
  }
  c.check("Every browser paints the hive body inside its viewport", bodies.size === c.players.length);
  const end = performance.now() + 60000;
  while (!killed && performance.now() < end) {
    await c.run(100, async () => {
      observe();
      for (const p of c.players) if (!killed && p.observation!.frame!.local.status === "out") {
        // Natural deaths must not strand a browser for the rest of the fight.
        // Save/standing checks precede the same fresh-input respawn as combat.
        await c.results(p); observe();
        if (!killed) await p.respawn();
      }
    });
  }
  c.check("Browser players and bots defeat the hive", killed);
  const browserIds = new Set(c.players.map(p => p.observation!.frame!.playerId));
  const contributors = killed!.rewards?.filter(r => browserIds.has(r.playerId)) ?? [];
  c.check("At least one browser contributes to the kill", contributors.length > 0);
  await c.wait("every eligible browser contributor paints its reward", () => { observe(); return contributors.every(r => awards.has(`${r.playerId}/${r.life}`)); }, 1500);
  // The game's reward ledger excludes ended/replaced lives. Compare every
  // eligible browser life, rather than demanding an award for an expired life.
  for (const reward of contributors) same(awards.get(`${reward.playerId}/${reward.life}`)!.amount, reward.amount, "Painted hive reward amount");
  c.check("Every browser contributor sees its authoritative hive reward", true, contributors);
  await c.capture("hive-rewards");
}
