import type { AcquiredUpgrade } from "./upgrades";
export interface Identity { playerId: string; name: string }
export interface Finish { playerId: string; score: number; squashes: number; seconds: number; touch: boolean; upgrades?: readonly AcquiredUpgrade[] }
export interface Leader { playerId: string; name: string; score: number }
export interface RunStarted { runId: string }
export interface Saved { saved: true }
export interface Best { best: number | null }
