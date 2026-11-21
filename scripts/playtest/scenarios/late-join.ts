import type { Context } from "../context";
export default async function lateJoin(c: Context) {
  await c.startServer(300); await c.join();
  c.check("Same bot room advanced through 300 seconds of ordinary ticks", c.latest!.warmup?.steps === 6000);
  for (const p of c.players) {
    const f = p.observation!.frame!, admission = c.latest!.lives.find(v => v.player.id === f.playerId && !v.record.result)!;
    c.check(`${p.name} spawn clearance >= 300 at admission`, admission.clearance === null || admission.clearance >= 300 - 1e-6, admission);
    c.check(`${p.name} viewport centered on newcomer`, Math.abs((f.local.x - f.camera.x) * f.scale - f.width / 2) < 2 && Math.abs((f.local.y - f.camera.y) * f.scale - f.height / 2) < 2);
    c.check(`${p.name} joins the warmed arena`, f.snapshot.tick >= 6000 && f.snapshot.players.length >= c.bots + 1);
    p.plan = "fight";
  }
  await c.capture("late-admission");
  const life = c.players[0]!.observation!.frame!.local.life;
  await c.run(10000, () => { const p = c.players[0]!.observation!.frame!.local; c.check("Newcomer survival sample", p.life === life && p.status === "active"); });
  await c.capture("ten-second-survival");
}
