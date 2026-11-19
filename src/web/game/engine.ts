import { Renderer } from "./draw";
import { Effects } from "./fx";
import { Feedback } from "./fx/feedback";
import { keyboardInput, mapPointer, MOVEMENT_KEYS, viewport } from "./input";
import { FixedStepper } from "./loop";
import type { Point } from "./simulation";
import type { Session } from "./session";

export interface Hud { score: number; hits: number; seconds: number }
export function mountGame(canvas: HTMLCanvasElement, session: Session, hud: (value: Hud) => void, debug: (text: string) => void): () => void {
  const ctx = canvas.getContext("2d")!;
  const keys = new Set<string>();
  const heldAtDeath = new Set<string>();
  let target: Point | null = null, pointer: number | null = null, frame = 0;
  let width = 1, height = 1, ratio = 1, lastHud = "", showDebug = false;
  let sampleStart: number | null = null;
  let frames = 0, updateCost = 0, drawCost = 0, token = session.view.token;
  const fx = new Effects(), feedback = new Feedback(fx);
  const renderer = new Renderer(ctx);
  const loop = new FixedStepper(feedback);
  const clear = () => {
    const captured = pointer; pointer = null;
    if (captured !== null && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
    keys.clear(); heldAtDeath.clear(); target = null; loop.reset(); fx.reset(); feedback.reset();
    sampleStart = null; frames = 0; updateCost = 0; drawCost = 0;
  };
  const resize = () => {
    const box = canvas.getBoundingClientRect(); width = box.width; height = box.height;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); loop.reset(); fx.resetClock();
    renderer.resize(width, height, ratio, session.current?.simulation.arena);
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const restart = (touch: boolean) => { clear(); token = session.start(touch).token; };
  const locate = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    target = mapPointer(event.clientX - box.left, event.clientY - box.top, viewport(width, height, session.current?.simulation.arena));
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (session.view.over) restart(event.pointerType === "touch");
    if (pointer !== null) return;
    pointer = event.pointerId; canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") session.touch();
    locate(event); event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    if (session.view.over) return;
    if (event.pointerType === "touch") session.touch();
    if (event.pointerType === "mouse" || event.pointerId === pointer) locate(event);
  };
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    target = null;
  };
  const keydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === "f" && !event.repeat) { showDebug = !showDebug; if (!showDebug) debug(""); return; }
    if (MOVEMENT_KEYS.has(key) || key === " ") event.preventDefault();
    if (session.view.over) {
      if (!event.repeat && !heldAtDeath.has(key) && !["shift", "control", "alt", "meta", "tab", "escape"].includes(key)) {
        restart(false); keys.add(key);
      }
      return;
    }
    keys.add(key);
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.key.toLowerCase()); heldAtDeath.delete(event.key.toLowerCase()); };
  const visibility = () => { clear(); };
  const tick = (timestamp: number) => {
    const run = session.current;
    if (run && !document.hidden) {
      if (token !== run.token) { clear(); token = run.token; }
      const hasInterval = sampleStart !== null;
      if (sampleStart === null) sampleStart = timestamp;
      const begin = performance.now();
      fx.advance(timestamp);
      if (!session.view.over) {
        loop.advance(timestamp, run.simulation, keyboardInput(keys, target));
        if (run.simulation.dead) {
          for (const key of keys) heldAtDeath.add(key);
          keys.clear(); target = null; session.end();
        }
      }
      const updated = performance.now();
      renderer.draw(run.simulation, fx);
      const rendered = performance.now();
      const s = run.simulation, hudKey = `${s.score}/${s.hits}/${s.seconds}`;
      if (hudKey !== lastHud) { lastHud = hudKey; hud({ score: s.score, hits: s.hits, seconds: s.seconds }); }
      if (hasInterval) { frames++; updateCost += updated - begin; drawCost += rendered - updated; }
      if (timestamp - sampleStart >= 1000) {
        if (showDebug) debug(`${(frames * 1000 / (timestamp - sampleStart)).toFixed(0)} FPS · update ${(updateCost / frames).toFixed(2)} ms · draw ${(drawCost / frames).toFixed(2)} ms`);
        frames = 0; updateCost = 0; drawCost = 0; sampleStart = timestamp;
      }
    }
    frame = requestAnimationFrame(tick);
  };
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);
  window.addEventListener("keydown", keydown); window.addEventListener("keyup", keyup);
  window.addEventListener("resize", resize);
  window.addEventListener("blur", clear); document.addEventListener("visibilitychange", visibility);
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame); observer.disconnect(); clear(); renderer.dispose();
    canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", release); canvas.removeEventListener("pointercancel", release);
    canvas.removeEventListener("lostpointercapture", release);
    window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup);
    window.removeEventListener("resize", resize);
    window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", visibility);
  };
}
