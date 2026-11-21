import { clampMove } from "../../shared/arena/movement";
import type { Input } from "../../shared/arena/types";
export const STICK_RADIUS = 60;
export const STICK_DEAD_ZONE = 6;
export class ArenaInput {
  readonly keys = new Set<string>();
  stick: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
  aim = 0; fire = false;
  down(id: number, x: number, y: number, width: number): boolean {
    if (this.stick || x >= width / 2) return false;
    this.stick = { id, x, y, dx: 0, dy: 0 }; return true;
  }
  move(id: number, x: number, y: number) { if (this.stick?.id === id) { this.stick.dx = x - this.stick.x; this.stick.dy = y - this.stick.y; } }
  up(id: number) { if (this.stick?.id === id) this.stick = null; }
  clear() { this.keys.clear(); this.stick = null; this.fire = false; }
  sample(): Input {
    let x = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    let y = Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) - Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    if (this.stick) {
      const { dx, dy } = this.stick, length = Math.hypot(dx, dy);
      const strength = Math.min(1, Math.max(0, (length - STICK_DEAD_ZONE) / (STICK_RADIUS - STICK_DEAD_ZONE)));
      x = length ? dx / length * strength : 0; y = length ? dy / length * strength : 0;
    }
    return { move: clampMove(x, y), aim: this.aim, fire: this.fire || this.keys.has("Space") };
  }
}
const controlKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
export function bindInput(canvas: HTMLCanvasElement, input: ArenaInput, aim: (x: number, y: number) => number, toggle: () => void, reset: () => void) {
  const controller = new AbortController(), options = { signal: controller.signal };
  const clear = () => {
    const id = input.stick?.id; input.clear();
    if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    reset();
  };
  window.addEventListener("keydown", event => {
    if (controlKeys.has(event.code)) { event.preventDefault(); input.keys.add(event.code); }
    if (event.code === "KeyF" && !event.repeat) toggle();
  }, options);
  window.addEventListener("keyup", event => { input.keys.delete(event.code); }, options);
  canvas.addEventListener("pointerdown", event => {
    if (event.pointerType === "touch") {
      if (input.down(event.pointerId, event.clientX, event.clientY, canvas.clientWidth)) canvas.setPointerCapture(event.pointerId);
    } else { input.fire = event.button === 0; input.aim = aim(event.clientX, event.clientY); }
  }, options);
  canvas.addEventListener("pointermove", event => {
    if (event.pointerType === "touch") input.move(event.pointerId, event.clientX, event.clientY);
    else input.aim = aim(event.clientX, event.clientY);
  }, options);
  const release = (event: PointerEvent) => { input.up(event.pointerId); if (event.pointerType !== "touch") input.fire = false; };
  window.addEventListener("pointerup", release, options);
  canvas.addEventListener("pointercancel", release, options);
  canvas.addEventListener("lostpointercapture", release, options);
  window.addEventListener("blur", clear, options);
  document.addEventListener("visibilitychange", clear, options);
  window.addEventListener("resize", clear, options);
  window.addEventListener("orientationchange", clear, options);
  return () => { clear(); controller.abort(); };
}
