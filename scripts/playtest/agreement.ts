import type { ArenaFrame } from "../../src/web/arena/observation";
import type { ServerObservation, PageObservation } from "./types";
import { TEAM_COLOURS } from "../../src/shared/teams";
import type { Snapshot } from "../../src/shared/arena/protocol";
import { STEP_MS, INTERPOLATION_MS } from "../../src/shared/arena/constants";
export function requireAgreement(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message); }
export function same(actual: unknown, expected: unknown, label: string) {
  requireAgreement(JSON.stringify(actual) === JSON.stringify(expected), `${label}: expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`);
}
function history(frame: ArenaFrame, server: ServerObservation, tick: number): Snapshot {
  const candidates = server.snapshots.filter(s => s.arenaId === frame.snapshot.arenaId && s.tick === tick);
  const key = (s: Snapshot) => JSON.stringify(s.players.map(p => [p.id, p.life, p.ackSeq]));
  const snapshot = candidates.find(s => key(s) === key(frame.snapshot)) ?? (tick === frame.snapshot.tick ? undefined : candidates.at(-1));
  requireAgreement(snapshot, `Missing authoritative history ${frame.snapshot.arenaId}/${tick}`); return snapshot;
}
export function comparePage(page: PageObservation, server: ServerObservation, previous?: ArenaFrame, stopped = false) {
  const f = page.frame; requireAgreement(f, "Missing rendered observation hook/frame");
  requireAgreement(f.generation === server.generation, "Wrong server generation");
  requireAgreement(page.now - f.at >= 0 && page.now - f.at <= 500 && f.at - f.receivedAt <= 500, "Stale rendered frame or snapshot");
  if (previous) requireAgreement(f.frame > previous.frame && (f.snapshot.tick >= previous.snapshot.tick || f.generation > previous.generation), "Frozen frame or regressing snapshot");
  const s = history(f, server, f.snapshot.tick), newest = server.snapshots.filter(s => s.arenaId === f.snapshot.arenaId).at(-1);
  requireAgreement(newest && newest.tick - s.tick <= 10, "Server is more than 500 ms ahead");
  same(f.players.map(p => p.id).sort(), s.players.map(p => p.id).sort(), "Membership");
  same(f.paint.minimap.map(p => p.id).sort(), s.players.filter(p => p.hits !== 0).map(p => p.id).sort(), "Painted minimap membership");
  for (const p of f.paint.minimap) same(p.colour, TEAM_COLOURS[s.players.find(q => q.id === p.id)!.team], "Minimap team colour");
  const a = history(f, server, f.interpolation.a), b = history(f, server, f.interpolation.b);
  const targetTick = s.tick + (f.at - f.receivedAt - INTERPOLATION_MS) / STEP_MS;
  const fraction = a.tick === b.tick ? 0 : Math.max(0, Math.min(1, (targetTick - a.tick) / (b.tick - a.tick)));
  requireAgreement(Math.abs(fraction - f.interpolation.fraction) <= 1e-6, "Interpolation fraction disagrees with frame/snapshot timing");
  for (const p of f.players) {
    const q = s.players.find(q => q.id === p.id)!;
    for (const k of ["name", "team", "life", "status", "score", "kills", "hits", "reviveMs", "reviving"] as const) same(p[k], q[k], `${p.id}/${k}`);
    const painted = f.paint.players.find(v => v.id === p.id);
    if (painted) {
      same(painted.colour, TEAM_COLOURS[q.team], "Painted team colour"); same(painted.status, q.status, "Painted life state"); same(painted.life, q.life, "Painted life"); same(painted.name, q.name, "Painted name");
      const position = p.id === f.playerId ? f.local : p;
      requireAgreement(Math.hypot(painted.x - position.x, painted.y - position.y) <= 2, "Painted robot position");
    }
    if (p.id === f.playerId) continue;
    const x = a.players.find(v => v.id === p.id), y = b.players.find(v => v.id === p.id);
    let transition = -Infinity, previousPlayer: Snapshot["players"][number] | undefined;
    for (const sample of server.snapshots) if (sample.arenaId === s.arenaId && sample.tick <= s.tick) {
      const current = sample.players.find(v => v.id === p.id);
      if (current && (!previousPlayer || current.life !== previousPlayer.life || current.status !== previousPlayer.status)) transition = sample.tick;
      previousPlayer = current;
    }
    const blend = x && y && x.life === y.life && q.life === x.life && q.status === "active" && x.status === q.status && y.status === q.status && a.tick >= transition;
    const ex = blend ? x.x + (y.x - x.x) * fraction : q.x, ey = blend ? x.y + (y.y - x.y) * fraction : q.y;
    requireAgreement(Math.hypot(p.x - ex, p.y - ey) <= 2, `Remote position ${p.id}`);
  }
  const own = s.players.find(p => p.id === f.playerId); requireAgreement(own && own.life === f.local.life, "Local life mismatch");
  const aligned = server.snapshots.filter(s => s.arenaId === f.snapshot.arenaId && s.players.some(p => p.id === f.playerId && p.life === f.local.life))
    .sort((a, b) => Math.abs(a.observedAt - f.epoch) - Math.abs(b.observedAt - f.epoch))[0];
  requireAgreement(aligned && Math.abs(aligned.observedAt - f.epoch) <= 100, "Missing time-aligned local history");
  const position = aligned.players.find(p => p.id === f.playerId)!;
  requireAgreement(Math.hypot(f.local.x - position.x, f.local.y - position.y) <= (stopped ? 2 : 40), `Local prediction position: rendered (${f.local.x}, ${f.local.y}), server (${position.x}, ${position.y}) at tick ${aligned.tick}`);
  same(f.local.score, own.score, "HUD score");
  same(f.paint.hud, { score: own.score, hits: own.hits, population: s.players.length, wave: s.wave }, "Painted HUD");
  return f;
}
export function visiblePlayers(frames: ArenaFrame[], ids: string[]) {
  for (const f of frames) for (const id of ids) requireAgreement(f.paint.players.some(p => p.id === id), `${f.playerId} did not paint ${id}'s robot/name`);
}
export function visibleEffect(frame: ArenaFrame, id: number, tick: number, serverAt?: number) {
  const effect = frame.paint.effects.find(e => e.id === id && e.tick === tick);
  requireAgreement(effect, `Missing visible effect ${id}/${tick}`);
  if (serverAt !== undefined) {
    const latency = frame.epoch - frame.at + effect.at - serverAt;
    requireAgreement(latency >= -50 && latency <= 1000, `Visible effect exceeded one-second deadline: ${latency} ms`);
  }
}
export function compareBoard(actual: { rank: number; name: string; score: number }[], expected: { name: string; score: number }[]) {
  same(actual, expected.slice(0, 10).map((row, i) => ({ rank: i + 1, name: row.name, score: row.score })), "Ordered board top 10");
}
export function compareResult(actual: NonNullable<PageObservation["result"]>, expected: { score: number; best: number; standing: string }) {
  same(actual.score, expected.score, "Life-over score"); same(actual.best, expected.best, "Life-over best"); same(actual.standing, expected.standing, "Life-over standing");
  requireAgreement(actual.save.includes("Score saved"), "Life-over score not saved");
}
