import { STEP_MS } from "./constants";
import { createArena, endLife, joinPlayer, respawnPlayer, stepArena } from "./simulation";
import { createPolicy, policyInput, type Policy } from "./policies";
import type { Input, LifeResult } from "./types";
export const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), n = sorted.length; return n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : 0; };
export function skillSeed(seed: number, policy: Policy, steps = 180000 / STEP_MS) {
  const arena = createArena(seed), states = Array.from({ length: 8 }, (_, i) => createPolicy(seed * 101 + i + 1));
  const lives: (LifeResult & { cutoff: boolean })[] = [];
  for (let i = 0; i < 8; i++) joinPlayer(arena, { id: String(i), name: `bot-${i}`, team: i % 2 ? "tabs" : "spaces" });
  const inputs = new Map<string, Input>();
  for (let tick = 0; tick < steps; tick++) {
    for (const p of arena.players.values()) if (!p.hits) respawnPlayer(arena, p.id, p.life);
    const observation = { players: [...arena.players.values()], bugs: arena.bugs };
    for (const p of arena.players.values()) inputs.set(p.id, policyInput(policy, observation, p, states[Number(p.id)]!));
    stepArena(arena, inputs); for (const life of arena.ended) lives.push({ ...life, cutoff: false });
  }
  for (const p of arena.players.values()) if (p.hits) { const life = endLife(arena, p.id)!; if (life.seconds) lives.push({ ...life, cutoff: true }); }
  return { seed, policy, lives };
}
export function skillMatrix() {
  return (["mover", "aimer"] as const).map(policy => {
    const seeds = Array.from({ length: 20 }, (_, seed) => skillSeed(seed, policy)), lives = seeds.flatMap(s => s.lives);
    return { policy, medianScore: median(lives.map(l => l.score)), medianSeconds: median(lives.map(l => l.seconds)), lives: lives.length,
      deaths: lives.filter(l => !l.cutoff).length, cutoffs: lives.filter(l => l.cutoff).length,
      seeds: seeds.map(s => ({ seed: s.seed, lives: s.lives.length, players: new Set(s.lives.map(l => l.playerId)).size,
        playerSeconds: s.lives.reduce((sum, l) => sum + l.seconds, 0),
        medianScore: median(s.lives.map(l => l.score)), medianSeconds: median(s.lives.map(l => l.seconds)) })) };
  });
}
