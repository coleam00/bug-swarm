import type { BugStyle } from "./styles";
const ROBOT_RADIUS = 14;

/** Draw at the caller's origin and rotation; no simulation or resource ownership. */
export function drawBeetle(ctx: CanvasRenderingContext2D, style: BugStyle, gait: number): void {
  const size = style.length / 12;
  ctx.beginPath();
  for (let side = -1; side <= 1; side += 2) {
    for (let leg = -1; leg <= 1; leg++) {
      const stride = gait * (leg === 0 ? -3 : 3) * side * size;
      ctx.moveTo(leg * 6 * size, side * 5 * size);
      ctx.lineTo(leg * 8 * size + stride, side * 12 * size);
      ctx.lineTo((leg * 10 - 3) * size + stride, side * style.leg);
    }
  }
  ctx.strokeStyle = style.legs; ctx.lineWidth = 2 * size; ctx.stroke();
  ctx.fillStyle = "#502f43"; ctx.beginPath(); ctx.ellipse(9 * size, 0, 5 * size, 6 * size, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = style.body; ctx.beginPath(); ctx.ellipse(-1, 0, style.length, style.width, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-11 * size, 0); ctx.lineTo(7 * size, 0); ctx.strokeStyle = "#663b50"; ctx.lineWidth = 1.5 * size; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-2 * size, -3 * size, 6 * size, 2 * size, -0.15, 0, Math.PI * 2); ctx.fillStyle = style.highlight; ctx.fill();
  ctx.fillStyle = "#ffe6c5"; ctx.fillRect(10 * size, -4 * size, 2 * size, 2 * size); ctx.fillRect(10 * size, 2 * size, 2 * size, 2 * size);
}

export function drawRobot(ctx: CanvasRenderingContext2D, core: HTMLCanvasElement): void {
  ctx.fillStyle = "#314757"; ctx.strokeStyle = "#84b6bd"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(-ROBOT_RADIUS, -ROBOT_RADIUS, ROBOT_RADIUS * 2, ROBOT_RADIUS * 2, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#152532"; ctx.fillRect(-18, -8, 5, 16); ctx.fillRect(13, -8, 5, 16);
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(core, -30, -30, 60, 60);
  ctx.fillStyle = "#b5fff0"; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}
