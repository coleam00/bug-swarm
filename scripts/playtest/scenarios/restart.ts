import { Database } from "bun:sqlite";
import { join } from "node:path";
import type { Context } from "../context";
export default async function restart(c: Context) {
  await c.startServer(); await c.join(); c.startBots(); c.players.forEach(p => { p.plan = "fight"; });
  await c.wait("browsers earn in-progress scores", () => c.players.every(p => p.observation!.frame!.local.score > 0), 30000);
  await c.capture("before-restart"); await c.stopBots(); await c.release(); await c.run(600);
  const before = c.players.map(p => p.observation!.frame!), active = (await c.server.observe()).lives.filter(v => !v.record.result && before.some(f => f.playerId === v.player.id && f.local.life === v.player.life));
  c.check("Every browser owns an in-progress server run", active.length === c.players.length);
  await c.server.stop();
  await Bun.sleep(600);
  await Promise.all(c.players.map(p => p.read()));
  c.check("Every page visibly reports reconnecting with truthful save status", c.players.every(p => /(?:Reconnecting|Rejoining)\.\.\./.test(p.observation!.text)), c.players.map(p => p.observation!.text));
  await c.capture("reconnecting");
  const db = new Database(join(c.root, "data", "app.db"), { readonly: true });
  try {
    for (const v of active) {
      const row = db.query("SELECT score,end_reason,(SELECT COUNT(*) FROM events WHERE run_id=runs.id AND type='run_ended') AS finishes FROM runs WHERE id=?").get(v.record.runId) as { score: number; end_reason: string; finishes: number };
      const frozen = c.server.shutdownLives.find(vv => vv.record.runId === v.record.runId && vv.record.result)!.record.result!;
      c.check(`Restart saves ${v.player.name}'s life exactly once`, row.end_reason === "restart" && row.finishes === 1 && row.score === frozen.score, { row, expected: frozen.score, run: v.record.runId });
    }
  } finally { db.close(); }
  await c.server.start();
  await c.wait("automatic rejoin with same identities and new runs", () => c.players.every((p, i) => { const f = p.observation?.frame; return f && f.generation === 2 && f.playerId === before[i]!.playerId && f.local.status === "active"; }), 15000, false);
  c.players.forEach(p => { p.plan = "fight"; });
  await c.run(3000); await c.capture("rejoined");
  c.check("Rejoined identities receive new server runs", c.players.every(p => c.latest!.lives.some(v => v.player.id === p.observation!.frame!.playerId && !active.some(old => old.record.runId === v.record.runId))));
  c.check("Rejoined browsers advance frames and accept input", c.players.every((p, i) => { const f = p.observation!.frame!; return f.generation === 2 && f.frame > before[i]!.frame && Math.hypot(f.local.x - before[i]!.local.x, f.local.y - before[i]!.local.y) > 10; }));
}
