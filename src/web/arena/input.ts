import { clampMove } from "../../shared/arena/movement";
import type { Input } from "../../shared/arena/types";
export const STICK_RADIUS = 60;
export const STICK_DEAD_ZONE = 6;
export class ArenaInput {
  readonly keys = new Set<string>();
  readonly blockedKeys = new Set<string>();
  blockHeld() { for (const code of this.keys) this.blockedKeys.add(code); }
  stick: { id: number; x: number; y: number; dx: number; dy: number } | null = null;
  right: ArenaInput["stick"] = null;
  mouse: { x: number; y: number } | null = null;
  resolveAim: ((x: number, y: number) => number) | null = null;
  touch = false;
  mouseId: number | null = null;
  releaseCapture: ((id: number) => void) | null = null;
  aim = 0; fire = false;
  down(id: number, x: number, y: number, width: number): boolean {
    const side = x < width / 2 ? "stick" : "right";
    if (this[side] || this.stick?.id === id || this.right?.id === id) return false;
    if (side === "right") this.mouse = null;
    this[side] = { id, x, y, dx: 0, dy: 0 }; this.touch = true; return true;
  }
  move(id: number, x: number, y: number) { const s = this.stick?.id === id ? this.stick : this.right?.id === id ? this.right : null; if (s) { s.dx = x - s.x; s.dy = y - s.y; } }
  up(id: number) { if (this.stick?.id === id) this.stick = null; if (this.right?.id === id) this.right = null; }
  clear() {
    const left = this.stick?.id, right = this.right?.id, mouse = this.mouseId;
    this.keys.clear(); this.stick = this.right = null; this.mouse = null; this.mouseId = null; this.fire = false; this.touch = false;
    for (const id of [left, right, mouse]) if (id !== undefined && id !== null) this.releaseCapture?.(id);
  }
  sample(): Input {
    let x = Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) - Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
    let y = Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")) - Number(this.keys.has("KeyW") || this.keys.has("ArrowUp"));
    if (this.stick) {
      const { dx, dy } = this.stick, length = Math.hypot(dx, dy);
      const strength = Math.min(1, Math.max(0, (length - STICK_DEAD_ZONE) / (STICK_RADIUS - STICK_DEAD_ZONE)));
      x = length ? dx / length * strength : 0; y = length ? dy / length * strength : 0;
    }
    let touchFire = false;
    if (this.right) { if (Math.hypot(this.right.dx, this.right.dy) > STICK_DEAD_ZONE) { this.aim = Math.atan2(this.right.dy, this.right.dx); touchFire = true; } }
    else if (this.mouse && this.resolveAim) this.aim = this.resolveAim(this.mouse.x, this.mouse.y);
    return { move: clampMove(x, y), aim: this.aim, fire: this.fire || this.keys.has("Space") || touchFire };
  }
}
const controlKeys = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);
export function bindInput(canvas: HTMLCanvasElement, input: ArenaInput, aim: (x: number, y: number) => number, toggle: () => void, reset: () => void, intercept: (touch: boolean) => boolean = () => false) {
  input.resolveAim = aim;
  input.releaseCapture = id => { if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); };
  const controller = new AbortController(), options = { signal: controller.signal };
  const clear = () => { input.clear(); reset(); };
  window.addEventListener("keydown", event => {
    if (controlKeys.has(event.code)) {
      event.preventDefault();
      if (input.blockedKeys.has(event.code)) return;
      if (!event.repeat && intercept(false)) { input.blockedKeys.add(event.code); return; }
      if (!event.repeat || input.keys.has(event.code)) input.keys.add(event.code);
    }
    if (event.code === "KeyF" && !event.repeat) toggle();
  }, options);
  window.addEventListener("keyup", event => { input.keys.delete(event.code); input.blockedKeys.delete(event.code); }, options);
  canvas.addEventListener("pointerdown", event => {
    if (intercept(event.pointerType === "touch")) return;
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (event.pointerType === "touch") {
      if (input.down(event.pointerId, x, y, canvas.clientWidth)) canvas.setPointerCapture(event.pointerId);
    } else { if (event.button === 0) { input.fire = true; input.mouseId = event.pointerId; canvas.setPointerCapture(event.pointerId); } input.mouse = { x, y }; }
  }, options);
  canvas.addEventListener("pointermove", event => {
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (event.pointerType === "touch") input.move(event.pointerId, x, y);
    else input.mouse = { x, y };
  }, options);
  const release = (event: PointerEvent) => {
    input.up(event.pointerId);
    if (event.pointerType !== "touch" && event.button !== 2) { input.fire = false; input.mouseId = null; }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  window.addEventListener("pointerup", release, options);
  const cancelled = (event: PointerEvent) => {
    if (input.stick?.id === event.pointerId || input.right?.id === event.pointerId || input.mouseId === event.pointerId) clear();
  };
  canvas.addEventListener("pointercancel", cancelled, options);
  canvas.addEventListener("lostpointercapture", cancelled, options);
  window.addEventListener("blur", clear, options);
  document.addEventListener("visibilitychange", clear, options);
  window.addEventListener("resize", clear, options);
  window.addEventListener("orientationchange", clear, options);
  return () => { clear(); controller.abort(); };
}
