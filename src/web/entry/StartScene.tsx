import { useEffect, useRef } from "react";
import { createGlow } from "../drawing/glow";
import { drawBeetle, drawRobot } from "../drawing/characters";
import { BUG_STYLES } from "../drawing/styles";

/** Decorative only: no input, game state, or network lifecycle. */
export function mountStartScene(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  const ctx = context;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const core = createGlow("#5bffe0", 2);
  const bugs = [{ x: 96, y: 70, phase: 0 }, { x: 295, y: 68, phase: 2 }, { x: 285, y: 170, phase: 4 }];
  let frame = 0, disposed = false, time = 0, last = 0;
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / 400, canvas.height / 240);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - 400 * scale) / 2, (canvas.height - 240 * scale) / 2);
    ctx.strokeStyle = "#24434b"; ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let x = 0; x <= 400; x += 32) { ctx.moveTo(x, 0); ctx.lineTo(x, 240); }
    for (let y = 0; y <= 240; y += 32) { ctx.moveTo(0, y); ctx.lineTo(400, y); }
    ctx.stroke();
    for (const bug of bugs) {
      const x = bug.x + Math.sin(time * 0.45 + bug.phase) * 14;
      const y = bug.y + Math.cos(time * 0.55 + bug.phase) * 10;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(120 - y, 190 - x));
      drawBeetle(ctx, bug.phase === 2 ? BUG_STYLES.fast : BUG_STYLES.base, Math.sin(time * 9 + bug.phase)); ctx.restore();
    }
    ctx.save(); ctx.translate(190, 120); ctx.scale(1.5, 1.5);
    drawRobot(ctx, core);
    ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.strokeStyle = "#b5fff0"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }
  function tick(now: number) {
    frame = 0;
    if (disposed || document.hidden || motion.matches) return;
    if (last) time += Math.min((now - last) / 1000, 0.05);
    last = now; draw(); frame = requestAnimationFrame(tick);
  }
  function resume() {
    cancelAnimationFrame(frame); frame = 0; last = 0;
    if (document.hidden || disposed) return;
    draw();
    if (!motion.matches) frame = requestAnimationFrame(tick);
  }
  function resize() {
    if (disposed) return;
    const bounds = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    if (!document.hidden) draw();
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", resume); motion.addEventListener("change", resume);
  resize(); resume();
  return () => {
    disposed = true; cancelAnimationFrame(frame); observer.disconnect();
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", resume); motion.removeEventListener("change", resume);
    core.width = core.height = canvas.width = canvas.height = 0;
  };
}

export function StartScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => mountStartScene(canvas.current!), []);
  return <canvas ref={canvas} className="entry-scene" aria-hidden="true" />;
}
