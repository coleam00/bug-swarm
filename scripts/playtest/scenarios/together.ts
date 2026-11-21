import type { Context } from "../context";
import { visiblePlayers } from "../agreement";
export default async function together(c: Context) {
  await c.startServer(); await c.join(); await c.capture("joined");
  c.startBots();
  await c.wait("13 participants", () => c.players.every(p => p.observation?.frame?.snapshot.players.length === 13));
  visiblePlayers(c.players.map(p => p.observation!.frame!), c.players.map(p => p.observation!.frame!.playerId));
  c.check("Every browser paints every other browser's name and team", true);
  c.players.forEach(p => { p.plan = "fight"; });
  await c.run(12000); await c.capture("shared-movement");
  await c.stopBots(); await c.stoppedCheckpoint(); await c.board();
}
