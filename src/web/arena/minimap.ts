import { TEAM_COLOURS } from "../../shared/teams";
import type { Player, CombatPlayer, Bug } from "../../shared/arena/types";

export interface MapBounds { x: number; y: number; width: number; height: number }
export function minimapBounds(viewWidth: number, viewHeight: number, worldWidth: number, worldHeight: number): MapBounds {
  const size = Math.min(viewWidth, viewHeight) < 600 ? 96 : 144;
  const scale = size / Math.max(worldWidth, worldHeight);
  return { x: viewWidth - 12 - worldWidth * scale, y: 52, width: worldWidth * scale, height: worldHeight * scale };
}
export function projectMarker(value: number, worldSize: number, mapStart: number, mapSize: number, radius: number): number {
  return mapStart + Math.max(radius, Math.min(mapSize - radius, value / worldSize * mapSize));
}
/** CSS-pixel overlay. All map markers belong here, including future bug kinds. */
export function drawMinimap(c: CanvasRenderingContext2D, map: MapBounds, worldWidth: number, worldHeight: number,
  players: readonly Player[], local: Player | null, bugs: readonly Bug[]): void {
  c.save();
  c.fillStyle = "#060b12cc"; c.fillRect(map.x, map.y, map.width, map.height);
  c.strokeStyle = "#66849baa"; c.lineWidth = 1; c.strokeRect(map.x, map.y, map.width, map.height);
  const dot = (x: number, y: number, radius: number) => {
    c.beginPath(); c.arc(projectMarker(x, worldWidth, map.x, map.width, radius), projectMarker(y, worldHeight, map.y, map.height, radius), radius, 0, Math.PI * 2); c.fill();
  };
  c.fillStyle = "#e3928140";
  for (const bug of bugs) dot(bug.x, bug.y, 1);
  for (const p of players) if (p.id !== local?.id && (p as CombatPlayer).hits !== 0) {
    c.fillStyle = TEAM_COLOURS[p.team]; dot(p.x, p.y, 2.5);
  }
  if (local && (local as CombatPlayer).hits !== 0) {
    c.fillStyle = TEAM_COLOURS[local.team]; dot(local.x, local.y, 4.5);
    c.strokeStyle = "#fff5d8"; c.lineWidth = 2; c.stroke();
  }
  c.restore();
}
