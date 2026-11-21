import type { Context } from "../context";
export default async function phoneDesktop(c: Context) {
  await c.startServer(); await c.join(4, true); c.startBots();
  const starts = c.players.map(p => p.observation!.frame!.local), moved = new Set<string>(), aimed = new Set<string>(), fired = new Set<string>(), twin = new Set<string>(), peerShots = new Set<string>();
  let simultaneous = false;
  c.players.forEach(p => { p.plan = "fight"; });
  await c.run(20000, async () => {
    for (let i = 0; i < c.players.length; i++) {
      const p = c.players[i]!, f = p.observation!.frame!, start = starts[i]!;
      if (Math.hypot(f.local.x - start.x, f.local.y - start.y) > 30) moved.add(p.name);
      if (Math.abs(Math.atan2(Math.sin(f.local.facing - start.facing), Math.cos(f.local.facing - start.facing))) > .05) aimed.add(p.name);
      if (f.input.fire && f.snapshot.shots.some(s => s.owner === f.playerId)) fired.add(p.name);
      if (f.input.left && f.input.right && f.input.fire) twin.add(p.name);
      if (c.players.some(q => q !== p && q.observation!.frame!.paint.shots.some(s => s.owner === f.playerId))) peerShots.add(p.name);
    }
    if (!simultaneous && c.players.filter(p => p.page.touch).every(p => { const i = p.observation!.frame!.input; return i.left && i.right && i.fire; }) && c.players.some(p => !p.page.touch && p.observation!.frame!.input.fire)) {
      simultaneous = true; await c.capture("twin-sticks");
    }
  });
  c.check("Requested room load present on every screen", c.players.every(p => p.observation!.frame!.snapshot.players.length === c.players.length + c.bots));
  c.check("Both phone twin sticks run simultaneously alongside desktop firing", simultaneous);
  for (const p of c.players) {
    c.check(`${p.name} moves, changes aim and emits shots seen by a peer`, moved.has(p.name) && aimed.has(p.name) && fired.has(p.name) && peerShots.has(p.name));
    if (p.page.touch) { c.check(`${p.name} owns two simultaneous touch sticks`, twin.has(p.name)); c.check(`${p.name} authoritative touch attribution`, c.latest!.snapshots.at(-1)!.players.find(q => q.id === p.observation!.frame!.playerId)?.touch); }
  }
  await c.capture("simultaneous-input");
}
