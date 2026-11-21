import { weaponDraw } from "./weapon";
import { SPREAD_FAN_DEGREES } from "../../../shared/arena/constants";
const halfFan = SPREAD_FAN_DEGREES * Math.PI / 360;
const COLOUR = "#82b8ff", ANGLES = [-halfFan, 0, halfFan];
export function createSpreadDraw() {
  return weaponDraw(COLOUR, (c, x, y, size) => {
    c.strokeStyle = COLOUR; c.lineWidth = 3; c.beginPath();
    for (const offset of [-0.65, 0, 0.65]) { c.moveTo(x, y + size); c.lineTo(x + Math.sin(offset) * size, y - Math.cos(offset) * size); }
    c.stroke();
  }, (c, p) => {
    c.save(); c.translate(p.x, p.y); c.rotate(p.facing); c.fillStyle = "#172a46"; c.strokeStyle = COLOUR; c.lineWidth = 2;
    for (const angle of ANGLES) { c.save(); c.rotate(angle); c.beginPath(); c.roundRect(7, -4, 22, 8, 2); c.fill(); c.stroke(); c.restore(); }
    c.restore();
  });
}
