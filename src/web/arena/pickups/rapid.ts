import { weaponDraw } from "./weapon";
const COLOUR = "#ff738a";
export function createRapidDraw() {
  return weaponDraw(COLOUR, (c, x, y, size) => {
    c.fillStyle = COLOUR; c.beginPath(); c.moveTo(x + size * 0.25, y - size);
    c.lineTo(x - size * 0.7, y + size * 0.15); c.lineTo(x - size * 0.1, y + size * 0.15);
    c.lineTo(x - size * 0.25, y + size); c.lineTo(x + size * 0.7, y - size * 0.15);
    c.lineTo(x + size * 0.1, y - size * 0.15); c.lineTo(x + size * 0.25, y - size); c.fill();
  }, (c, p) => {
    c.save(); c.translate(p.x, p.y); c.rotate(p.facing); c.strokeStyle = COLOUR; c.lineWidth = 2;
    c.beginPath(); c.roundRect(8, -6, 23, 12, 3); c.stroke();
    c.strokeStyle = "#fff0c2"; c.beginPath();
    for (let x = 17; x <= 27; x += 5) { c.moveTo(x, -5); c.lineTo(x, 5); } c.stroke(); c.restore();
  });
}
