import type { Player } from "../../../shared/arena/types";
/** Each kind owns its glyph and robot effect; cache only the common floor glow. */
export function weaponDraw(colour: string, glyph: (c: CanvasRenderingContext2D, x: number, y: number, size: number) => void,
  robot: (c: CanvasRenderingContext2D, player: Player) => void) {
  const glow = document.createElement("canvas"); glow.width = glow.height = 96;
  const c = glow.getContext("2d")!, g = c.createRadialGradient(48, 48, 3, 48, 48, 48);
  g.addColorStop(0, colour + "88"); g.addColorStop(1, colour + "00"); c.fillStyle = g; c.fillRect(0, 0, 96, 96);
  return {
    extent: 48, robot,
    floor(c: CanvasRenderingContext2D, x: number, y: number) { c.drawImage(glow, x - 48, y - 48); glyph(c, x, y, 14); },
    hud(c: CanvasRenderingContext2D, x: number, y: number, remaining: number) {
      c.fillStyle = "#060b12dd"; c.beginPath(); c.arc(x, y, 21, 0, Math.PI * 2); c.fill();
      glyph(c, x, y, 10); c.strokeStyle = colour + "44"; c.lineWidth = 3;
      c.beginPath(); c.arc(x, y, 18, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = colour; c.beginPath(); c.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remaining); c.stroke();
    },
  };
}
