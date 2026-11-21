import { PLAYER_RADIUS, PLAYER_SPEED, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import type { Input, Player } from "./types";
export function clampMove(x: number, y: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
  const scale = Math.max(Math.abs(x), Math.abs(y), 1);
  const length = Math.hypot(x / scale, y / scale);
  return scale * length > 1 ? { x: x / scale / length, y: y / scale / length } : { x, y };
}
export function movePlayer(player: Player, input: Input, ms = STEP_MS): void {
  const move = clampMove(input.move.x, input.move.y), seconds = ms / 1000;
  const x = player.x, y = player.y;
  player.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, x + move.x * PLAYER_SPEED * seconds));
  player.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, y + move.y * PLAYER_SPEED * seconds));
  player.vx = seconds > 0 ? (player.x - x) / seconds : 0;
  player.vy = seconds > 0 ? (player.y - y) / seconds : 0;
  if (Number.isFinite(input.aim)) player.facing = Math.atan2(Math.sin(input.aim), Math.cos(input.aim));
}
