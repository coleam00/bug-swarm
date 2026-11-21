import type { Context } from "../context";
export default async function revive(c: Context) {
  await c.startServer(); await c.join();
  const [a, b, observer] = c.players, af = a!.observation!.frame!, id = af.playerId, life = af.local.life;
  const position = { x: af.local.x, y: af.local.y }, run = c.latest!.lives.find(v => v.player.id === id)!.record.runId;
  a!.plan = "still"; b!.plan = { x: position.x + 160, y: position.y, guard: true }; observer!.plan = { x: position.x - 220, y: position.y, guard: true };
  await c.run(1800);
  await c.wait("A naturally downed on every screen", () => c.players.every(p => p.observation!.frame!.paint.players.some(q => q.id === id && q.status === "downed")), 35000);
  c.check("B waits outside revive radius", Math.hypot(b!.observation!.frame!.local.x - position.x, b!.observation!.frame!.local.y - position.y) > 90);
  await c.capture("downed"); const score = af.local.score;
  observer!.plan = { x: position.x - 220, y: position.y, fire: true };
  // Do not walk into the swarm during the cooling half of a burst. The other
  // browser covers the casualty while B waits outside contact with a ready gun.
  await c.wait("Rescuer cools its gun before closing", () => b!.observation!.frame!.local.heat <= 3, 2500);
  c.check("Rescuer remains active before approaching", b!.observation!.frame!.local.status === "active");
  b!.plan = { ...position, radius: 75, fire: true };
  await c.wait("every screen paints a positive revive meter", () => c.players.every(p => p.observation!.frame!.paint.players.some(q => q.id === id && q.reviveRing)), 8000);
  await c.capture("revive-meter");
  // Keep defending while holding contact; stopping fire here exposes the helper
  // to the same swarm that downed A. Rescue credit comes from ordinary contact.
  await c.wait("A active again on every screen", () => c.players.every(p => p.observation!.frame!.paint.players.some(q => q.id === id && q.status === "active")), 5000);
  c.check("Revive retains A's life/score/run", a!.observation!.frame!.local.life === life && a!.observation!.frame!.local.score === score && !c.latest!.lives.some(v => v.record.runId === run && v.record.result));
  await c.capture("revived"); await c.stoppedCheckpoint();
}
