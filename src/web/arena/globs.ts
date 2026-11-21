import { GLOB_RADIUS } from "../../shared/arena/constants";
import type { Glob } from "../../shared/arena/types";
export const GLOB_EXTENT = 40;
export function acidGlow(size: number) {
  const glow = document.createElement("canvas"); glow.width = glow.height = size;
  const c = glow.getContext("2d")!, r = size / 2, gradient = c.createRadialGradient(r, r, 2, r, r, r);
  gradient.addColorStop(0, "#d8ff80dd"); gradient.addColorStop(0.3, "#8dff3899"); gradient.addColorStop(1, "#65ff1800");
  c.fillStyle = gradient; c.fillRect(0, 0, size, size); return glow;
}
export function createGlobDraw() {
  const glow = acidGlow(64);
  return (c: CanvasRenderingContext2D, g: Glob) => {
    const speed = Math.hypot(g.vx, g.vy) || 1, dx = g.vx / speed * 28, dy = g.vy / speed * 28;
    c.drawImage(glow, g.x - 32, g.y - 32);
    c.strokeStyle = "#8dff3866"; c.lineWidth = 12; c.beginPath(); c.moveTo(g.x - dx, g.y - dy); c.lineTo(g.x, g.y); c.stroke();
    c.fillStyle = "#aaff38"; c.beginPath(); c.arc(g.x, g.y, GLOB_RADIUS, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#efffc2"; c.beginPath(); c.arc(g.x + 2, g.y - 2, 4, 0, Math.PI * 2); c.fill();
  };
}
