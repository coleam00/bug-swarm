import { HIVE_RADIUS, HIVE_RING_COUNT, HIVE_RING_TELL_MS } from "../../../shared/arena/constants";
import type { Bug } from "../../../shared/arena/types";
import { acidGlow } from "../globs";

export function createHiveDraw() {
  const glow = acidGlow(200);
  const shell = document.createElement("canvas"); shell.width = shell.height = 120;
  const s = shell.getContext("2d")!;
  s.translate(60, 60); s.fillStyle = "#59652d"; s.strokeStyle = "#eaff8c"; s.lineWidth = 3;
  s.beginPath(); s.ellipse(0, 0, HIVE_RADIUS, 39, 0, 0, Math.PI * 2); s.fill(); s.stroke();
  s.strokeStyle = "#c1d769"; s.lineWidth = 2;
  for (let x = -24; x <= 24; x += 24) for (let y = -18; y <= 18; y += 18) {
    s.beginPath(); for (let i = 0; i <= 6; i++) { const a = i * Math.PI / 3; const px = x + Math.cos(a) * 10, py = y + Math.sin(a) * 10; if (i) s.lineTo(px, py); else s.moveTo(px, py); } s.stroke();
  }
  return (c: CanvasRenderingContext2D, b: Bug, time: number) => {
    const pulse = 1 + Math.sin(time / 180) * 0.045;
    c.save(); c.translate(b.x, b.y);
    c.globalAlpha = 0.55 + Math.sin(time / 180) * 0.15; c.drawImage(glow, -100 * pulse, -100 * pulse, 200 * pulse, 200 * pulse); c.globalAlpha = 1;
    if (b.phase === "arrival") {
      c.strokeStyle = "#eaff8c"; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, 58 * pulse, 0, Math.PI * 2); c.stroke();
      c.textAlign = "center"; c.font = "bold 18px system-ui"; c.fillStyle = "#eaff8c"; c.fillText("HIVE INCOMING", 0, -78); c.restore(); return;
    }
    const remaining = b.ringAt! - time;
    if (remaining > 0 && remaining <= HIVE_RING_TELL_MS) {
      const charge = 1 - remaining / HIVE_RING_TELL_MS;
      // A contracting amber ring and twelve radial marks forecast the actual glob lanes.
      // Use the delayed combat clock and server deadline, never the decorative pulse.
      c.strokeStyle = "#ffd05a"; c.lineWidth = 4 + charge * 3;
      c.beginPath(); c.arc(0, 0, 92 - charge * 30, 0, Math.PI * 2); c.stroke();
      c.beginPath();
      for (let i = 0; i < HIVE_RING_COUNT; i++) {
        const a = i * Math.PI * 2 / HIVE_RING_COUNT, x = Math.cos(a), y = Math.sin(a);
        c.moveTo(x * 54, y * 54); c.lineTo(x * (70 + charge * 28), y * (70 + charge * 28));
      }
      c.stroke(); c.font = "bold 16px system-ui"; c.textAlign = "center"; c.fillStyle = "#ffd05a"; c.fillText("RING INCOMING", 0, -96);
    }
    c.rotate(b.facing); c.strokeStyle = "#d3df86"; c.lineWidth = 4; c.beginPath();
    for (let i = -1; i <= 1; i++) { const stride = Math.sin(time / 190 + i) * 7; c.moveTo(i * 23, -24); c.lineTo(i * 28 - 12 + stride, -58); c.moveTo(i * 23, 24); c.lineTo(i * 28 - 12 - stride, 58); } c.stroke();
    c.drawImage(shell, -60, -60);
    c.fillStyle = "#edff9c"; c.beginPath(); c.ellipse(3, 0, 12 * pulse, 17 * pulse, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#ffffff"; c.fillRect(36, -15, 9, 5); c.fillRect(36, 10, 9, 5); c.restore();
  };
}
