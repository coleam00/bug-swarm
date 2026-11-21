import { STEP_MS } from "./constants";
import { createArena, endLife, joinPlayer, respawnPlayer, stepArena } from "./simulation";
import { createPolicy, policyInput, type Policy } from "./policies";
import { neutralInput, type Input, type LifeResult } from "./types";
export const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), n = sorted.length; return n ? (sorted[Math.floor((n - 1) / 2)]! + sorted[Math.floor(n / 2)]!) / 2 : 0; };
export function lifeMedians(lives: readonly Pick<LifeResult, "score" | "seconds">[]) {
  return { medianScore: median(lives.map(l => l.score)), medianSeconds: median(lives.map(l => l.seconds)) };
}
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
    return { policy, ...lifeMedians(lives), lives: lives.length,
      deaths: lives.filter(l => !l.cutoff).length, cutoffs: lives.filter(l => l.cutoff).length,
      seeds: seeds.map(s => ({ seed: s.seed, lives: s.lives.length, players: new Set(s.lives.map(l => l.playerId)).size,
        playerSeconds: s.lives.reduce((sum, l) => sum + l.seconds, 0),
        ...lifeMedians(s.lives) })) };
  });
}

export interface NewcomerLife {
  seed: number; policy: Policy | "idle"; joinSeconds: number; incumbents: number;
  seconds: number; score: number; cutoff: boolean;
}
/** Exactly one newcomer's first life. Incumbents continuously respawn but never enter the sample. */
export function newcomerTrial(seed: number, policy: Policy | "idle", joinSeconds: number, incumbents = 8, horizon = 600): NewcomerLife {
  const arena = createArena(seed), inputs = new Map<string, Input>();
  const states = Array.from({ length: incumbents }, (_, i) => createPolicy(seed * 101 + i + 1));
  const newcomerState = createPolicy(seed * 101 + 99);
  for (let i = 0; i < incumbents; i++) joinPlayer(arena, { id: String(i), name: `bot-${i}`, team: i % 2 ? "tabs" : "spaces" });
  const joinTick = joinSeconds * 1000 / STEP_MS, endTick = joinTick + horizon * 1000 / STEP_MS;
  for (; arena.tick < endTick;) {
    if (arena.tick === joinTick) joinPlayer(arena, { id: "newcomer", name: "Newcomer", team: "tabs" });
    for (const p of arena.players.values()) if (!p.hits && p.id !== "newcomer") respawnPlayer(arena, p.id, p.life);
    const observation = { players: [...arena.players.values()], bugs: arena.bugs };
    for (const p of arena.players.values()) {
      inputs.set(p.id, p.id === "newcomer" ? policy === "idle" ? neutralInput() : policyInput(policy, observation, p, newcomerState)
        : policyInput("aimer", observation, p, states[Number(p.id)]!));
    }
    stepArena(arena, inputs);
    const result = arena.ended.find(l => l.playerId === "newcomer");
    if (result) return { seed, policy, joinSeconds, incumbents, seconds: result.seconds, score: result.score, cutoff: false };
  }
  const p = arena.players.get("newcomer")!;
  return { seed, policy, joinSeconds, incumbents, seconds: (arena.tick - p.startedTick) * STEP_MS / 1000, score: p.score, cutoff: true };
}
export function survivalSummary(lives: readonly NewcomerLife[]) {
  const sorted = [...lives].sort((a, b) => a.seconds - b.seconds);
  const low = sorted[Math.floor((sorted.length - 1) / 2)], high = sorted[Math.floor(sorted.length / 2)];
  return { count: lives.length, deaths: lives.filter(l => !l.cutoff).length, cutoffs: lives.filter(l => l.cutoff).length,
    medianSeconds: median(lives.map(l => l.seconds)), exact: !!low && !!high && !low.cutoff && !high.cutoff };
}
export function newcomerComparison(early: readonly NewcomerLife[], late: readonly NewcomerLife[]): "pass" | "fail" | "inconclusive" {
  const a = survivalSummary(early), b = survivalSummary(late);
  if (!a.exact) return "inconclusive";
  if (b.medianSeconds >= a.medianSeconds * 0.8) return "pass";
  return b.exact ? "fail" : "inconclusive";
}
export function fairnessPassed(cohorts: readonly (readonly NewcomerLife[])[]): boolean {
  const definitions = [["aimer", 0, 8], ["aimer", 480, 8], ...[0, 120, 300, 480, 900].map(age => ["idle", age, 8]), ["idle", 0, 0], ["idle", 480, 0]];
  if (cohorts.length !== definitions.length || !cohorts.every((lives, i) => lives.length === 20 && lives.every((l, seed) =>
    l.seed === seed && l.policy === definitions[i]![0] && l.joinSeconds === definitions[i]![1] && l.incumbents === definitions[i]![2]))) return false;
  return newcomerComparison(cohorts[0]!, cohorts[1]!) === "pass" && cohorts.slice(2).every(lives => survivalSummary(lives).medianSeconds >= 10);
}
export function fairnessMatrix() {
  const cohort = (policy: Policy | "idle", age: number, incumbents: number, horizon: number) =>
    Array.from({ length: 20 }, (_, seed) => newcomerTrial(seed, policy, age, incumbents, horizon));
  let early: NewcomerLife[] = [], late: NewcomerLife[] = [], comparison: ReturnType<typeof newcomerComparison> = "inconclusive", horizon = 600;
  for (const window of [600, 1200, 1800]) {
    horizon = window; early = cohort("aimer", 0, 8, window); late = cohort("aimer", 480, 8, window);
    comparison = newcomerComparison(early, late); if (comparison !== "inconclusive") break;
  }
  const idle = [0, 120, 300, 480, 900].map(age => cohort("idle", age, 8, 600));
  idle.push(cohort("idle", 0, 0, 600), cohort("idle", 480, 0, 600));
  const cohorts = [early, late, ...idle];
  return { passed: fairnessPassed(cohorts),
    comparison, horizon, lateToEarly: survivalSummary(late).medianSeconds / survivalSummary(early).medianSeconds,
    cohorts: cohorts.map(lives => ({ policy: lives[0]!.policy, joinSeconds: lives[0]!.joinSeconds, incumbents: lives[0]!.incumbents,
      ...survivalSummary(lives), observations: lives })) };
}
