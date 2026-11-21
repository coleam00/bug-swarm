import { DASHER_DASH_MS, DASHER_DASH_SPEED, DASHER_WINDUP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "../../../shared/arena/constants";
import type { Bug } from "../../../shared/arena/types";
const reach = DASHER_DASH_SPEED * DASHER_DASH_MS / 1000;
export const dasherExtent = (b: Bug) => b.phase === "windup" ? reach + 60 : 60;
export function createDasherDraw() {
  const glow = document.createElement("canvas"); glow.width = glow.height = 120;
  const g = glow.getContext("2d")!, gradient = g.createRadialGradient(60, 60, 4, 60, 60, 60);
  gradient.addColorStop(0, "#fff4bedd"); gradient.addColorStop(0.25, "#ff627eaa"); gradient.addColorStop(1, "#ff247600");
  g.fillStyle = gradient; g.fillRect(0, 0, 120, 120);
  return (c: CanvasRenderingContext2D, b: Bug, time: number) => {
    const windup = b.phase === "windup", recovery = b.phase === "recovery";
    const charge = windup ? Math.max(0, Math.min(1, 1 - (b.phaseUntil! - time) / DASHER_WINDUP_MS)) : 0;
    c.save(); c.translate(b.x, b.y); c.rotate(b.facing);
    if (windup) {
      const dx = Math.cos(b.facing), dy = Math.sin(b.facing);
      let length = reach;
      if (dx > 0) length = Math.min(length, (WORLD_WIDTH - b.x) / dx); else if (dx < 0) length = Math.min(length, -b.x / dx);
      if (dy > 0) length = Math.min(length, (WORLD_HEIGHT - b.y) / dy); else if (dy < 0) length = Math.min(length, -b.y / dy);
      c.strokeStyle = "#ff829c66"; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(length, 0); c.stroke();
      c.globalAlpha = 0.6 + charge * 0.4; c.drawImage(glow, -60, -60); c.globalAlpha = 1;
    }
    // Short, tucked legs and compressed shell make the stationary tell readable.
    c.strokeStyle = windup ? "#fff1bb" : "#f092d6"; c.lineWidth = 2.5; c.beginPath();
    for (let i = -1; i <= 1; i++) {
      const twitch = windup ? 0 : Math.sin(time / (recovery ? 180 : 65) + b.id + i) * 4;
      const span = windup ? 12 : recovery ? 25 : 22;
      c.moveTo(i * 8, -6); c.lineTo(i * 11 + twitch - 4, -span);
      c.moveTo(i * 8, 6); c.lineTo(i * 11 - twitch - 4, span);
    } c.stroke();
    c.scale(windup ? 0.72 : 1, windup ? 0.78 : 1);
    c.fillStyle = windup ? "#ff6b8e" : recovery ? "#814b8c" : "#be50b6";
    c.strokeStyle = windup ? "#fff6bb" : "#f3a0e2"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(19, 0); c.lineTo(5, -13); c.lineTo(-15, -9); c.lineTo(-19, 0); c.lineTo(-15, 9); c.lineTo(5, 13); c.lineTo(19, 0); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-14, 0); c.lineTo(14, 0); c.stroke();
    c.fillStyle = "#fff8c4"; c.fillRect(8, -7, 6, 3); c.fillRect(8, 4, 6, 3);
    c.restore();
  };
}
