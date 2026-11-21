import type { Context } from "../context";
export default async function revive(c: Context) {
  await c.startServer(); await c.join();
  const [a, b, observer] = c.players, af = a!.observation!.frame!;
  const initial = { x: af.local.x, y: af.local.y };
  a!.plan = "still"; b!.plan = { x: initial.x + 160, y: initial.y, guard: true }; observer!.plan = { x: initial.x - 220, y: initial.y, guard: true };
  await c.run(1800);
  // Pickups and real input timing can let A outlast a guard. Rescue the first
  // casualty everyone actually sees, rather than waiting for another player to fall.
  let casualty: typeof a;
  await c.wait("A browser naturally downed on every screen", () => {
    casualty = c.players.find(p => p.observation!.frame!.local.status === "downed" &&
      c.players.every(view => view.observation!.frame!.paint.players.some(q => q.id === p.observation!.frame!.playerId && q.status === "downed")));
    return !!casualty;
  }, 35000);
  const downed = casualty!.observation!.frame!.local, id = downed.id, life = downed.life, score = downed.score;
  const position = { x: downed.x, y: downed.y }, run = c.latest!.lives.find(v => v.player.id === id && v.player.life === life)!.record.runId;
  const helpers = c.players.filter(p => p !== casualty && p.observation!.frame!.local.status === "active")
    .sort((p, q) => Math.hypot(p.observation!.frame!.local.x - position.x, p.observation!.frame!.local.y - position.y) - Math.hypot(q.observation!.frame!.local.x - position.x, q.observation!.frame!.local.y - position.y));
  const rescuer = helpers[0]; c.check("An active browser can rescue the casualty", rescuer);
  c.check("Rescuer waits outside revive radius", Math.hypot(rescuer!.observation!.frame!.local.x - position.x, rescuer!.observation!.frame!.local.y - position.y) > 90);
  casualty!.plan = "still";
  for (const cover of helpers.slice(1)) cover.plan = { x: position.x + (cover.observation!.frame!.local.x < position.x ? -220 : 220), y: position.y, fire: true };
  await c.capture("downed");
  // Do not walk into the swarm during the cooling half of a burst. The other
  // browser covers the casualty while the rescuer waits outside contact with a ready gun.
  await c.wait("Rescuer cools its gun before closing", () => rescuer!.observation!.frame!.local.heat <= 3, 2500);
  c.check("Rescuer remains active before approaching", rescuer!.observation!.frame!.local.status === "active");
  rescuer!.plan = { ...position, radius: 75, fire: true };
  await c.wait("every screen paints a positive revive meter", () => c.players.every(p => p.observation!.frame!.paint.players.some(q => q.id === id && q.reviveRing)), 8000);
  await c.capture("revive-meter");
  // Keep defending while holding contact; stopping fire here exposes the helper
  // to the same swarm that downed the casualty. Rescue credit comes from ordinary contact.
  await c.wait("Casualty active again on every screen", () => c.players.every(p => p.observation!.frame!.paint.players.some(q => q.id === id && q.status === "active")), 5000);
  c.check("Revive retains casualty's life/score/run", casualty!.observation!.frame!.local.life === life && casualty!.observation!.frame!.local.score === score && !c.latest!.lives.some(v => v.record.runId === run && v.record.result));
  await c.capture("revived"); await c.stoppedCheckpoint();
}
