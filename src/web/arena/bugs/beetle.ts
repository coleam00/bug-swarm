import { BEETLE_ARMOUR_HALF_ANGLE, BEETLE_HEALTH, BEETLE_RADIUS } from "../../../shared/arena/constants";
import type { Bug } from "../../../shared/arena/types";

export function createBeetleDraw() {
  const glow = document.createElement("canvas"); glow.width = glow.height = 96;
  const g = glow.getContext("2d")!, gradient = g.createRadialGradient(48, 48, 12, 48, 48, 48);
  gradient.addColorStop(0, "#ffc34c55"); gradient.addColorStop(1, "#ffc34c00");
  g.fillStyle = gradient; g.fillRect(0, 0, 96, 96);
  return (c: CanvasRenderingContext2D, b: Bug, time: number) => {
    c.save(); c.translate(b.x, b.y); c.rotate(b.facing); c.drawImage(glow, -48, -48);
    c.strokeStyle = "#b99a60"; c.lineWidth = 3; c.beginPath();
    for (let i = -1; i <= 1; i++) {
      const stride = Math.hypot(b.vx, b.vy) > 1 ? Math.sin(time / 120 + b.id + i) * 4 : 0;
      for (const side of [-1, 1]) { c.moveTo(i * 12, side * 10); c.lineTo(i * 15 - 6 + stride * side, side * 30); c.lineTo(i * 15 - 12 + stride * side, side * 33); }
    }
    c.stroke(); c.fillStyle = "#58432b"; c.strokeStyle = "#bf9250"; c.lineWidth = 2;
    c.beginPath(); c.ellipse(0, 0, 24, 20, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    c.strokeStyle = "#e3ac43"; c.beginPath(); c.moveTo(-22, 0); c.lineTo(10, 0); c.stroke();
    // The bright rim is the exact guarded +/-60 degree contact sector.
    c.fillStyle = "#e8b745"; c.strokeStyle = "#fff0a5"; c.lineWidth = 4;
    c.beginPath(); c.arc(0, 0, BEETLE_RADIUS, -BEETLE_ARMOUR_HALF_ANGLE, BEETLE_ARMOUR_HALF_ANGLE);
    c.lineTo(7, 0); c.closePath(); c.fill(); c.stroke();
    c.strokeStyle = "#38291f"; c.lineWidth = 2;
    for (let i = 0; i < BEETLE_HEALTH - b.hp; i++) {
      const angle = -0.78 + i * 0.5, x = Math.cos(angle), y = Math.sin(angle);
      c.beginPath(); c.moveTo(x * 23, y * 23); c.lineTo(x * 16 - 2, y * 16 + 2); c.lineTo(x * 11, y * 11 - 2); c.stroke();
    }
    c.restore();
  };
}
