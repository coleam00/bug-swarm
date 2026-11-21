import type { PickupKind, Player } from "../../../shared/arena/types";
import { PICKUP_BLINK_MS } from "../../../shared/arena/constants";
import { createShieldDraw } from "./shield";
export interface PickupDraw {
  extent: number;
  floor(c: CanvasRenderingContext2D, x: number, y: number): void;
  robot(c: CanvasRenderingContext2D, player: Player): void;
  hud(c: CanvasRenderingContext2D, x: number, y: number, remaining: number): void;
}
export const createPickupDraws = (): Record<PickupKind, PickupDraw> => ({ shield: createShieldDraw() });
export function pickupAlpha(remaining: number) { return remaining <= 0 ? 0 : remaining <= PICKUP_BLINK_MS && Math.floor(remaining / 250) % 2 === 0 ? 0.25 : 1; }
export function effectRemaining(until: number, time: number, duration: number) { return Math.max(0, Math.min(1, (until - time) / duration)); }
