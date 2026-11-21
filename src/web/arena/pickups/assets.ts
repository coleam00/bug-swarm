import type { Player } from "../../../shared/arena/types";

function sprite(size: number, paint: (c: CanvasRenderingContext2D, centre: number) => void) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = size;
  paint(canvas.getContext("2d")!, size / 2); return canvas;
}

/** Bake kind-owned artwork once per renderer. Only the draining HUD arc changes per frame. */
export function createPickupDraw(colour: string, glyph: (c: CanvasRenderingContext2D, x: number, y: number, size: number) => void,
  robot: (c: CanvasRenderingContext2D) => void, rotates = true) {
  const floor = sprite(96, (c, centre) => {
    const glow = c.createRadialGradient(centre, centre, 3, centre, centre, centre);
    glow.addColorStop(0, colour + "88"); glow.addColorStop(1, "#00000000");
    c.fillStyle = glow; c.fillRect(0, 0, 96, 96); glyph(c, centre, centre, 14);
  });
  const overlay = sprite(72, (c, centre) => { c.translate(centre, centre); robot(c); });
  const hud = sprite(44, (c, centre) => {
    c.fillStyle = "#060b12dd"; c.beginPath(); c.arc(centre, centre, 21, 0, Math.PI * 2); c.fill();
    glyph(c, centre, centre, 10); c.strokeStyle = colour + "44"; c.lineWidth = 3;
    c.beginPath(); c.arc(centre, centre, 18, 0, Math.PI * 2); c.stroke();
  });
  return {
    extent: 48,
    floor(c: CanvasRenderingContext2D, x: number, y: number) { c.drawImage(floor, x - 48, y - 48); },
    robot(c: CanvasRenderingContext2D, p: Player) {
      c.save(); c.translate(p.x, p.y); if (rotates) c.rotate(p.facing);
      c.drawImage(overlay, -36, -36); c.restore();
    },
    hud(c: CanvasRenderingContext2D, x: number, y: number, remaining: number) {
      c.drawImage(hud, x - 22, y - 22); c.strokeStyle = colour; c.lineWidth = 3;
      c.beginPath(); c.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining); c.stroke();
    },
  };
}
