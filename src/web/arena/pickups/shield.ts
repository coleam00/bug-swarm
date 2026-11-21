import { createPickupDraw } from "./assets";
const COLOUR = "#bf96ff";
function glyph(c: CanvasRenderingContext2D, x: number, y: number, size: number) {
  c.beginPath(); c.moveTo(x, y - size); c.lineTo(x + size * 0.8, y - size * 0.6);
  c.lineTo(x + size * 0.7, y + size * 0.3); c.lineTo(x, y + size);
  c.lineTo(x - size * 0.7, y + size * 0.3); c.lineTo(x - size * 0.8, y - size * 0.6); c.lineTo(x, y - size);
  c.fillStyle = "#211137"; c.fill(); c.strokeStyle = COLOUR; c.lineWidth = 2; c.stroke();
}
export function createShieldDraw() {
  return createPickupDraw(COLOUR, glyph, c => {
    c.fillStyle = "#bf96ff12"; c.strokeStyle = COLOUR; c.lineWidth = 2;
    c.beginPath(); c.arc(0, 0, 32, 0, Math.PI * 2); c.fill(); c.stroke();
    c.strokeStyle = "#eadbff"; c.beginPath(); c.arc(-2, -2, 26, Math.PI * 1.05, Math.PI * 1.45); c.stroke();
  }, false);
}
