import { SQUARE_ARENA, type Arena } from "./arena";
import type { Input, Point } from "./simulation";

export interface Viewport { scale: number; left: number; top: number; arena: Arena }
export function viewport(width: number, height: number, arena: Arena = SQUARE_ARENA): Viewport {
  const scale = Math.min(width / arena.width, height / arena.height);
  return { scale, left: (width - arena.width * scale) / 2, top: (height - arena.height * scale) / 2, arena };
}
export function mapPointer(x: number, y: number, view: Viewport): Point {
  return { x: Math.max(0, Math.min(view.arena.width, (x - view.left) / view.scale)),
    y: Math.max(0, Math.min(view.arena.height, (y - view.top) / view.scale)) };
}
export const MOVEMENT_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
export function keyboardInput(keys: ReadonlySet<string>, target: Point | null): Input {
  return { x: Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft")),
    y: Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup")), target };
}
