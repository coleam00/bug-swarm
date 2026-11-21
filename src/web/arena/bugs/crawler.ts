import type { Bug } from "../../../shared/arena/types";
export function drawCrawler(c: CanvasRenderingContext2D, b: Bug, time: number) {
  c.save(); c.translate(b.x, b.y); c.rotate(b.facing);
  c.strokeStyle = "#e39281"; c.lineWidth = 2; c.beginPath();
  for (let i = -1; i <= 1; i++) { const leg = Math.sin(time / 80 + b.id + i) * 4; c.moveTo(i * 7, -6); c.lineTo(i * 9 + leg, -19); c.moveTo(i * 7, 6); c.lineTo(i * 9 - leg, 19); } c.stroke();
  c.fillStyle = "#a74951"; c.beginPath(); c.ellipse(0, 0, 13, 10, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#f5af88"; c.beginPath(); c.moveTo(-10, 0); c.lineTo(10, 0); c.stroke(); c.fillStyle = "#ffe1a6"; c.fillRect(6, -6, 3, 3); c.fillRect(6, 3, 3, 3); c.restore();
}
