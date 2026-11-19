import { ARENA_SIZE } from "./config";
import type { Input, Point } from "./simulation";

export interface Viewport { scale: number; left: number; top: number }
export function viewport(width: number, height: number): Viewport {
  const scale = Math.min(width, height) / ARENA_SIZE;
  return { scale, left: (width - ARENA_SIZE * scale) / 2, top: (height - ARENA_SIZE * scale) / 2 };
}
export function mapPointer(x: number, y: number, view: Viewport): Point {
  return { x: Math.max(0, Math.min(ARENA_SIZE, (x - view.left) / view.scale)),
    y: Math.max(0, Math.min(ARENA_SIZE, (y - view.top) / view.scale)) };
}
export const MOVEMENT_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
export function keyboardInput(keys: ReadonlySet<string>, target: Point | null): Input {
  return { x: Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft")),
    y: Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup")), target };
}
