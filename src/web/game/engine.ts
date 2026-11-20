import { Renderer } from "./draw";
import { Effects } from "./fx";
import { Feedback } from "./fx/feedback";
import { keyboardInput, mapPointer, MOVEMENT_KEYS, PointerControl, viewport } from "./input";
import { FixedStepper } from "./loop";
import type { Point } from "./simulation";
import type { Session } from "./session";

export interface Hud { score: number; hits: number; seconds: number }
export interface MovementObserver { pending(token: number): boolean; moved(token: number): void }
export function mountGame(canvas: HTMLCanvasElement, session: Session, hud: (value: Hud) => void, debug: (text: string) => void,
  movement?: MovementObserver): () => void {
  const ctx = canvas.getContext("2d")!;
  const keys = new Set<string>();
  const heldAtDeath = new Set<string>();
  const heldChoices = new Set<string>();
  let target: Point | null = null, frame = 0;
  const pointer = new PointerControl();
  let width = 1, height = 1, ratio = 1, lastHud = "", showDebug = false;
  let sampleStart: number | null = null;
  let frames = 0, updateCost = 0, drawCost = 0, token = session.view.token;
  const fx = new Effects(), feedback = new Feedback(fx);
  const renderer = new Renderer(ctx);
  const loop = new FixedStepper(feedback);
  const clearPointer = () => {
    const captured = pointer.id;
    if (captured !== null) pointer.release(captured);
    target = null;
    if (captured !== null && canvas.hasPointerCapture(captured)) canvas.releasePointerCapture(captured);
  };
  const clearSteering = () => {
    clearPointer();
    keys.clear(); heldAtDeath.clear(); loop.reset(); fx.resetClock();
    sampleStart = null; frames = 0; updateCost = 0; drawCost = 0;
  };
  const clear = () => { clearSteering(); heldChoices.clear(); fx.reset(); feedback.reset(); };
  let choosing = Boolean(session.view.choice);
  const unsubscribe = session.subscribe(() => {
    if (token !== session.view.token) { clear(); token = session.view.token; }
    const next = Boolean(session.view.choice);
    if (next !== choosing) { choosing = next; clearSteering(); }
  });
  const resize = () => {
    if (pointer.type === "touch") clearPointer();
    const box = canvas.getBoundingClientRect(); width = box.width; height = box.height;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); loop.reset(); fx.resetClock();
    renderer.resize(width, height, ratio, session.current?.simulation.arena);
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const restart = (touch: boolean) => session.restart(session.view.token, touch);
  const locate = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    target = mapPointer(event.clientX - box.left, event.clientY - box.top, viewport(width, height, session.current?.simulation.arena));
  };
  const down = (event: PointerEvent) => {
    if (session.view.choice) return;
    if (event.button !== 0) return;
    if (pointer.id !== null) return;
    if (session.view.over && !restart(event.pointerType === "touch")) { event.preventDefault(); return; }
    const box = canvas.getBoundingClientRect();
    pointer.down(event.pointerId, event.pointerType, event.clientX - box.left, event.clientY - box.top);
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") { target = null; session.touch(); }
    else locate(event);
    event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    if (session.view.over || session.view.choice) return;
    if (pointer.type === "touch") {
      if (event.pointerId !== pointer.id) return;
      const box = canvas.getBoundingClientRect();
      pointer.move(event.pointerId, event.clientX - box.left, event.clientY - box.top);
    } else if (event.pointerType === "mouse" || event.pointerId === pointer.id) locate(event);
  };
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointer.id) return;
    clearPointer();
  };
  const keydown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (["1", "2", "3"].includes(key)) {
      const held = heldChoices.has(key); heldChoices.add(key);
      const choice = session.view.choice;
      if (choice) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat && !held) session.choose(session.view.token, choice.number, choice.offer[Number(key) - 1]!);
        return;
      }
    }
    if (session.view.choice) {
      if (MOVEMENT_KEYS.has(key)) event.preventDefault();
      return;
    }
    if (key === "f" && !event.repeat) { showDebug = !showDebug; if (!showDebug) debug(""); return; }
    if (MOVEMENT_KEYS.has(key) || key === " ") event.preventDefault();
    if (session.view.over) {
      if (key === "enter") event.preventDefault();
      if (!event.repeat && !heldAtDeath.has(key) && !["shift", "control", "alt", "meta", "tab", "escape"].includes(key)) {
        event.preventDefault();
        if (restart(false)) keys.add(key);
        else heldAtDeath.add(key);
      }
      return;
    }
    // After a choice clears steering, OS repeats must not resurrect a held key.
    if (!event.repeat) keys.add(key);
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.key.toLowerCase()); heldAtDeath.delete(event.key.toLowerCase()); heldChoices.delete(event.key.toLowerCase()); };
  const visibility = () => { clear(); };
  const tick = (timestamp: number) => {
    const run = session.current;
    if (run && !document.hidden) {
      if (token !== run.token) { clear(); token = run.token; }
      const hasInterval = sampleStart !== null;
      if (sampleStart === null) sampleStart = timestamp;
      const begin = performance.now();
      if (!session.view.choice) fx.advance(timestamp);
      if (!session.view.over) {
        const keyboard = keyboardInput(keys, target);
        if (movement && !movement.pending(run.token)) movement = undefined;
        const x = movement ? run.simulation.robot.x : 0, y = movement ? run.simulation.robot.y : 0;
        loop.advance(timestamp, run.simulation, keyboard.x || keyboard.y ? keyboard : pointer.joystick ? pointer.input : keyboard);
        if (movement && (x !== run.simulation.robot.x || y !== run.simulation.robot.y)) {
          const observer = movement; movement = undefined; observer.moved(run.token);
        }
        session.publishChoice();
        if (run.simulation.dead) {
          for (const key of keys) heldAtDeath.add(key);
          keys.clear(); clearPointer(); session.end();
        }
      }
      const updated = performance.now();
      renderer.draw(run.simulation, fx, pointer.joystick);
      const rendered = performance.now();
      const s = run.simulation, hudKey = `${s.score}/${s.hits}/${s.seconds}`;
      if (hudKey !== lastHud) { lastHud = hudKey; hud({ score: s.score, hits: s.hits, seconds: s.seconds }); }
      if (hasInterval) { frames++; updateCost += updated - begin; drawCost += rendered - updated; }
      if (timestamp - sampleStart >= 1000) {
        if (showDebug) debug(`${(frames * 1000 / (timestamp - sampleStart)).toFixed(0)} FPS · ${s.bugs.length} bugs · ${fx.liveCount} effects · update ${(updateCost / frames).toFixed(2)} ms · draw ${(drawCost / frames).toFixed(2)} ms`);
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
    movement = undefined;
    cancelAnimationFrame(frame); observer.disconnect(); unsubscribe(); clear(); renderer.dispose();
    canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", release); canvas.removeEventListener("pointercancel", release);
    canvas.removeEventListener("lostpointercapture", release);
    window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup);
    window.removeEventListener("resize", resize);
    window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", visibility);
  };
}
