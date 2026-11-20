import { SQUARE_ARENA, type Arena } from "./arena";
import { IDLE, type Input, type Point } from "./simulation";

export const TOUCH_DEAD_ZONE = 6;
export const TOUCH_RADIUS = 60;
/** Canvas-local CSS pixels; independent of arena scaling, DPR and world shake. */
export interface Joystick { x: number; y: number; dx: number; dy: number }
export function touchInput(dx: number, dy: number): Input {
  const length = Math.hypot(dx, dy);
  if (length <= TOUCH_DEAD_ZONE) return IDLE;
  return { x: dx / length, y: dy / length, speed: Math.min(1, (length - TOUCH_DEAD_ZONE) / (TOUCH_RADIUS - TOUCH_DEAD_ZONE)), target: null };
}

/** Event-driven ownership. Only a fresh down can acquire an unowned pointer. */
export class PointerControl {
  id: number | null = null;
  type: string | null = null;
  joystick: Joystick | null = null;
  input: Input = IDLE;
  down(id: number, type: string, x: number, y: number): boolean {
    if (this.id !== null) return false;
    this.id = id; this.type = type;
    if (type === "touch") { this.joystick = { x, y, dx: 0, dy: 0 }; this.input = IDLE; }
    return true;
  }
  move(id: number, x: number, y: number): void {
    if (id !== this.id || !this.joystick) return;
    const stick = this.joystick, dx = x - stick.x, dy = y - stick.y;
    this.input = touchInput(dx, dy);
    const scale = Math.min(1, TOUCH_RADIUS / (Math.hypot(dx, dy) || 1));
    stick.dx = dx * scale; stick.dy = dy * scale;
  }
  release(id: number): boolean {
    if (id !== this.id) return false;
    this.reset(); return true;
  }
  reset(): void { this.id = null; this.type = null; this.joystick = null; this.input = IDLE; }
}

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
