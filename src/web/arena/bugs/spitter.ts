import { SPITTER_SWELL_MS } from "../../../shared/arena/constants";
import type { Bug } from "../../../shared/arena/types";
import { acidGlow } from "../globs";
export function createSpitterDraw() {
  const glow = acidGlow(120);
  return (c: CanvasRenderingContext2D, b: Bug, time: number) => {
    const swell = b.phase === "swell" ? Math.max(0, Math.min(1, 1 - (b.phaseUntil! - time) / SPITTER_SWELL_MS)) : 0;
    c.save(); c.translate(b.x, b.y); c.rotate(b.facing);
    if (b.phase === "swell") { c.globalAlpha = 0.5 + swell * 0.5; c.drawImage(glow, -60, -60); c.globalAlpha = 1; }
    c.strokeStyle = "#b2d66e"; c.lineWidth = 2.5; c.beginPath();
    for (let i = -1; i <= 1; i++) {
      const stride = b.phase === "swell" ? 0 : Math.sin(time / 160 + b.id + i) * 4;
      c.moveTo(i * 9, -8); c.lineTo(i * 12 - 5 + stride, -25);
      c.moveTo(i * 9, 8); c.lineTo(i * 12 - 5 - stride, 25);
    } c.stroke();
    c.fillStyle = b.phase === "swell" ? "#aaff38" : "#638d32"; c.strokeStyle = "#d8ff80"; c.lineWidth = 2;
    c.beginPath(); c.ellipse(-5, 0, 18 + swell * 10, 16 + swell * 9, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.fillStyle = "#30451c"; c.beginPath(); c.ellipse(13, 0, 10, 10, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#efffc2"; c.fillRect(15, -7, 5, 3); c.fillRect(15, 4, 5, 3);
    c.restore();
  };
}
