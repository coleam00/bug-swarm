import type { Snapshot } from "../../src/shared/arena/protocol";
import type { CombatPlayer } from "../../src/shared/arena/types";
import type { LifeRecord } from "../../src/server/arena/lives";
import type { ArenaFrame } from "../../src/web/arena/observation";
import type { RoomManager } from "../../src/server/arena/rooms";
export type LifeObservation = { record: LifeRecord; arenaId: string; player: CombatPlayer; clearance: number | null };
export interface ServerObservation {
  generation: number; snapshots: (Snapshot & { observedAt: number })[]; lives: LifeObservation[];
  stats: ReturnType<RoomManager["stats"]>; warmup?: { seconds: number; steps: number; elapsedMs: number };
}
export interface PageObservation {
  now: number; frame: ArenaFrame | null; text: string; fps: number; frameMs: number;
  result: { score: number; best: number | null; standing: string; save: string } | null;
}
export interface Check { name: string; pass: boolean; detail?: unknown }
export interface ScenarioReport {
  name: string; status: "running" | "pass" | "fail" | "skip"; seed: number; elapsedMs: number;
  checks: Check[]; screenshots: { player: string; file: string; frame?: number; tick?: number }[];
  pages: Record<string, { samples: number; fps: number[]; frameMs: number[] }>;
  tick?: ServerObservation["stats"]["tick"]; warmup?: ServerObservation["warmup"];
  error?: string; skip?: string; cleanupErrors: string[];
}
