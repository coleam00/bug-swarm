import type { Player } from "../../../shared/arena/types";
const COLOUR = "#bf96ff";
function glyph(c: CanvasRenderingContext2D, x: number, y: number, size: number) {
  c.beginPath(); c.moveTo(x, y - size); c.lineTo(x + size * 0.8, y - size * 0.6);
  c.lineTo(x + size * 0.7, y + size * 0.3); c.lineTo(x, y + size);
  c.lineTo(x - size * 0.7, y + size * 0.3); c.lineTo(x - size * 0.8, y - size * 0.6); c.lineTo(x, y - size);
  c.fillStyle = "#211137"; c.fill(); c.strokeStyle = COLOUR; c.lineWidth = 2; c.stroke();
}
export function createShieldDraw() {
  const glow = document.createElement("canvas"); glow.width = glow.height = 96;
  const c = glow.getContext("2d")!, g = c.createRadialGradient(48, 48, 3, 48, 48, 48);
  g.addColorStop(0, "#bf96ff88"); g.addColorStop(1, "#bf96ff00"); c.fillStyle = g; c.fillRect(0, 0, 96, 96);
  return {
    extent: 48,
    floor(c: CanvasRenderingContext2D, x: number, y: number) { c.drawImage(glow, x - 48, y - 48); glyph(c, x, y, 14); },
    robot(c: CanvasRenderingContext2D, player: Player) {
      const { x, y } = player;
      c.fillStyle = "#bf96ff12"; c.strokeStyle = COLOUR; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, 32, 0, Math.PI * 2); c.fill(); c.stroke();
      c.strokeStyle = "#eadbff"; c.beginPath(); c.arc(x - 2, y - 2, 26, Math.PI * 1.05, Math.PI * 1.45); c.stroke();
    },
    hud(c: CanvasRenderingContext2D, x: number, y: number, remaining: number) {
      c.fillStyle = "#060b12dd"; c.beginPath(); c.arc(x, y, 21, 0, Math.PI * 2); c.fill();
      glyph(c, x, y, 10); c.strokeStyle = "#bf96ff44"; c.lineWidth = 3;
      c.beginPath(); c.arc(x, y, 18, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = COLOUR; c.beginPath(); c.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining); c.stroke();
    },
  };
}
