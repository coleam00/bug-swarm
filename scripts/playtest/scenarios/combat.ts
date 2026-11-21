import type { Context } from "../context";
import { visibleEffect } from "../agreement";
export default async function combat(c: Context) {
  await c.startServer(); await c.join();
  const [a, b, observer] = c.players;
  a!.plan = "fight"; b!.plan = "follow"; observer!.plan = "follow";
  let witnessed = false;
  await c.wait("A-only kill visibly bursts on B", () => {
    const af = a!.observation!.frame!, bf = b!.observation!.frame!;
    const effect = bf.paint.effects.find(e => e.type === "kill");
    const authored = effect && c.latest!.snapshots.find(s => s.events.some(e => e.id === effect.id && e.tick === effect.tick));
    if (af.local.kills > 0 && effect && authored) { visibleEffect(bf, effect.id, effect.tick, authored.observedAt); witnessed = true; }
    return witnessed;
  }, 25000);
  c.check("A-only firing raises A score and B paints its kill event", a!.observation!.frame!.local.score > 0 && witnessed);
  await c.capture("shared-kill");
  for (const p of [b!, observer!]) {
    if (p.observation!.frame!.local.status === "downed") await c.wait(`${p.name} first life expires`, () => p.observation!.frame!.local.status !== "downed", 12000);
    if (p.observation!.frame!.local.status === "out") { await c.results(p); await c.capture("early-life-over"); await p.respawn(); await c.wait("combat player active", () => p.observation!.frame!.local.status === "active"); }
  }
  b!.plan = "fight"; c.startBots();
  const start = performance.now(); await c.run(60000);
  c.check("Two browser players aim/fire for 60 seconds and both score", performance.now() - start >= 60000 && a!.observation!.frame!.local.score > 0 && b!.observation!.frame!.local.score > 0, [a!.observation!.frame!.local, b!.observation!.frame!.local]);
  await c.capture("combat"); await c.stopBots();
  // Separate through input before waiting for ordinary damage and downed expiry.
  a!.plan = { x: 700, y: 700 }; b!.plan = { x: 1700, y: 700 }; observer!.plan = { x: 1200, y: 1700 };
  await c.run(3500);
  c.players.forEach(p => { p.plan = "hunt"; });
  await c.wait("all browser lives expire naturally", () => c.players.every(p => p.observation!.frame!.local.status === "out"), 45000);
  await c.release();
  for (const p of c.players) await c.results(p);
  await c.capture("life-over"); await c.board();
  const lives = c.players.map(p => p.observation!.frame!.local.life);
  await Promise.all(c.players.map(p => p.respawn()));
  await c.wait("fresh input respawns each browser", () => c.players.every((p, i) => p.observation!.frame!.local.life > lives[i]!));
  await c.run(600); await c.capture("respawn");
}
