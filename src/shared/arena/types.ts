import type { Team } from "../teams";
import { STEP_MS, PLAYER_HITS, SPAWN_PROTECTION_MS } from "./constants";
export interface Input { move: { x: number; y: number }; aim: number; fire: boolean }
export interface Player {
  id: string; name: string; team: Team;
  x: number; y: number; vx: number; vy: number; facing: number;
}
export interface Life {
  status: "active" | "downed" | "out"; downedUntil: number; reviveMs: number; reviving: boolean;
  life: number; hits: number; heat: number; overheatUntil: number; nextShotAt: number;
  immuneUntil: number; spawnProtectedUntil: number; streak: number; points: number; score: number; kills: number; startedTick: number; touch: boolean;
}
export type CombatPlayer = Player & Life;
export const lifeDefaults = (tick = 0, life = 1): Life => ({ status: "active", downedUntil: 0, reviveMs: 0, reviving: false, life, hits: PLAYER_HITS, heat: 0, overheatUntil: 0, nextShotAt: tick * STEP_MS,
  immuneUntil: 0, spawnProtectedUntil: tick * STEP_MS + SPAWN_PROTECTION_MS, streak: 0, points: 0, score: 0, kills: 0, startedTick: tick, touch: false });
export type BugKind = keyof typeof import("./bugs/registry").BUGS;
export interface Bug { id: number; kind: BugKind; x: number; y: number; vx: number; vy: number; hp: number; facing: number; phase?: string; phaseUntil?: number }
export interface Shot { id: number; owner: string; life: number; x: number; y: number; vx: number; vy: number; born: number }
export interface Glob { id: number; x: number; y: number; vx: number; vy: number; born: number }
export type CombatEvent = { id: number; tick: number; x: number; y: number } &
  ({ type: "hit"; kind: BugKind; points: 0 } | { type: "kill"; kind: BugKind; points: number } | { type: "glob-pop"; points: 5; kind?: never });
export interface LifeResult { playerId: string; life: number; score: number; kills: number; seconds: number; touch: boolean }
export interface ArenaState { tick: number; random: number; players: Map<string, CombatPlayer>; slots: Map<string, number>;
  wave: number; bugs: Bug[]; shots: Shot[]; globs: Glob[]; events: CombatEvent[]; ended: LifeResult[]; nextId: number; spawnCredits: Map<string, number>; spawnCursor: number }
export const neutralInput = (): Input => ({ move: { x: 0, y: 0 }, aim: 0, fire: false });
