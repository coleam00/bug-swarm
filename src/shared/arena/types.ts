import type { Team } from "../teams";
export interface Input { move: { x: number; y: number }; aim: number; fire: boolean }
export interface Player {
  id: string; name: string; team: Team;
  x: number; y: number; vx: number; vy: number; facing: number;
}
export interface ArenaState { tick: number; random: number; players: Map<string, Player>; slots: Map<string, number> }
export const neutralInput = (): Input => ({ move: { x: 0, y: 0 }, aim: 0, fire: false });
