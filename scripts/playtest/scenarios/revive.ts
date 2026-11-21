import type { Context } from "../context";
export default async function revive(c: Context) {
  await c.startServer(); await c.join();
  const [a, b, observer] = c.players, af = a!.observation!.frame!, id = af.playerId, life = af.local.life;
  const position = { x: af.local.x, y: af.local.y }, run = c.latest!.lives.find(v => v.player.id === id)!.record.runId;
  a!.plan = "still"; b!.plan = { x: position.x + 180, y: position.y, guard: true }; observer!.plan = { x: position.x - 350, y: position.y, guard: true };
  await c.run(1800);
  await c.wait("A naturally downed on every screen", () => c.players.every(p => p.observation!.frame!.paint.players.some(q => q.id === id && q.status === "downed")), 35000);
  c.check("B waits outside revive radius", Math.hypot(b!.observation!.frame!.local.x - position.x, b!.observation!.frame!.local.y - position.y) > 90);
  await c.capture("downed"); const score = af.local.score;
  observer!.plan = "still"; await observer!.clear(); await c.run(1000);
  const rewardBefore = b!.observation!.frame!.local.points, rewardTick = b!.observation!.frame!.snapshot.tick;
  b!.plan = { ...position, radius: 45, fire: true };
  await c.wait("every screen paints a positive revive meter", () => c.players.every(p => p.observation!.frame!.paint.players.some(q => q.id === id && q.reviveRing)), 8000);
  await c.capture("revive-meter");
  b!.plan = { ...position, radius: 45, fire: false };
  await b!.clear();
  await c.wait("A active again on every screen", () => c.players.every(p => p.observation!.frame!.paint.players.some(q => q.id === id && q.status === "active")), 5000);
  c.check("Revive retains A's life/score/run", a!.observation!.frame!.local.life === life && a!.observation!.frame!.local.score === score && !c.latest!.lives.some(v => v.record.runId === run && v.record.result));
  const after = b!.observation!.frame!, killPoints = [...c.events.values()].filter(e => e.tick > rewardTick && e.tick <= after.snapshot.tick).reduce((sum, e) => sum + Math.round(e.points * 10), 0);
  c.check("Browser B receives exactly 50 points in addition to its kills", after.local.points - rewardBefore - killPoints === 500, { before: rewardBefore, after: after.local.points, killPoints });
  await c.capture("revived"); await c.stoppedCheckpoint();
}
