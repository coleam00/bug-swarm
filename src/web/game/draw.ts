import { ROBOT_RADIUS, BUG_DEFINITIONS } from "./config";
import { viewport } from "./input";
import type { Simulation } from "./simulation";

export function draw(ctx: CanvasRenderingContext2D, state: Simulation, width: number, height: number): void {
  ctx.fillStyle = "#0b1018"; ctx.fillRect(0, 0, width, height);
  const view = viewport(width, height, state.arena);
  ctx.save(); ctx.translate(view.left, view.top); ctx.scale(view.scale, view.scale);
  ctx.fillStyle = "#141e2b"; ctx.fillRect(0, 0, state.arena.width, state.arena.height);
  for (const bug of state.bugs) {
    const kind = BUG_DEFINITIONS[bug.kind];
    ctx.fillStyle = kind.color;
    ctx.beginPath(); ctx.arc(bug.x, bug.y, kind.radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "#f8e8ab";
  for (const shot of state.shots) { ctx.beginPath(); ctx.arc(shot.x, shot.y, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = state.time < state.invulnerableUntil ? "#ffffff" : "#86ded1";
  ctx.beginPath(); ctx.arc(state.robot.x, state.robot.y, ROBOT_RADIUS, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
