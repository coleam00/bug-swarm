import type { Snapshot } from "../../shared/arena/protocol";
import type { CombatPlayer, Bug, CombatEvent } from "../../shared/arena/types";

/** Filled at actual paint sites after culling, never inferred from receipt. */
export interface PaintTrace {
  players: (CombatPlayer & { colour: string; reviveRing: boolean })[];
  bugs: Bug[];
  effects: (CombatEvent & { at: number })[];
  shots: { owner: string; id: number }[];
  minimap: { id: string; colour: string }[];
  hud?: { score: number; hits: number; population: number; wave: number };
}
export interface ArenaFrame {
  frame: number; at: number; epoch: number; receivedAt: number; generation: number;
  playerId: string; snapshot: Snapshot; local: CombatPlayer;
  camera: { x: number; y: number }; scale: number; width: number; height: number;
  interpolation: { a: number; b: number; fraction: number; transitions: [string, number][] };
  players: CombatPlayer[]; paint: PaintTrace;
  input: { left: boolean; right: boolean; fire: boolean };
}
export class ArenaObservation {
  readonly paint: PaintTrace = { players: [], bugs: [], effects: [], shots: [], minimap: [] };
  private frame?: ArenaFrame;
  private effects: PaintTrace["effects"] = [];
  private sequence = 0;
  constructor(private target: object) {
    Object.defineProperty(target, "__arenaDebug", { configurable: true, get: () => this.read() });
  }
  publish(value: Omit<ArenaFrame, "frame" | "paint">) {
    if (this.frame?.generation !== value.generation) this.effects = [];
    for (const effect of this.paint.effects) if (!this.effects.some(e => e.id === effect.id)) this.effects.push(effect);
    this.effects = this.effects.filter(e => value.at - e.at < 2000).slice(-280);
    this.frame = { ...value, frame: ++this.sequence, paint: { ...this.paint, effects: this.effects } };
  }
  read() { return this.frame ? structuredClone(this.frame) : null; }
  dispose() { Reflect.deleteProperty(this.target, "__arenaDebug"); }
}
