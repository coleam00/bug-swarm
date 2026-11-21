import { MAX_PLAYERS } from "../../shared/arena/constants";
import { helpArrow } from "./help-arrow";

const CAPACITY = MAX_PLAYERS + 1, INSET = 8, GAP = 8;
export const MARKER_FONT = "bold 16px system-ui";
interface Marker {
  id: string; hive: boolean; targetX: number; targetY: number;
  edge: number; tangent: number;
  x: number; y: number; angle: number;
}
export interface MarkerObstacle { x: number; y: number; width: number; height: number }
interface Slot { x: number; y: number; used: boolean }

/** A shared CSS-pixel grid keeps complete arrows and labels apart, including corners.
 * Only viewport or overlay changes rebuild slots; frame collection and insertion sort reuse storage. */
export class EdgeMarkers {
  readonly markers: Marker[] = Array.from({ length: CAPACITY }, () => ({
    id: "", hive: false, targetX: 0, targetY: 0,
    edge: 0, tangent: 0, x: 0, y: 0, angle: 0,
  }));
  private readonly slots: Slot[] = Array.from({ length: CAPACITY * CAPACITY }, () => ({ x: 0, y: 0, used: false }));
  private slotCount = 0;
  private reservationKey = ""; private panel?: MarkerObstacle; private map?: MarkerObstacle; private panelY = 0; private celebration?: MarkerObstacle; private pickups?: MarkerObstacle;
  private width = -1; private height = -1; private top = -1;
  readonly halfWidth: number;
  readonly bottom: number;
  count = 0;
  constructor(c: CanvasRenderingContext2D) {
    c.save(); c.font = MARKER_FONT; c.textAlign = "center";
    const help = c.measureText("Help"), hive = c.measureText("Hive");
    this.halfWidth = Math.ceil(Math.max(15, help.width / 2, hive.width / 2,
      help.actualBoundingBoxLeft, help.actualBoundingBoxRight, hive.actualBoundingBoxLeft, hive.actualBoundingBoxRight));
    this.bottom = 28 + Math.ceil(Math.max(help.actualBoundingBoxDescent ?? 4, hive.actualBoundingBoxDescent ?? 4));
    c.restore();
  }
  reset() { this.count = 0; this.width = -1; this.reservationKey = ""; this.slotCount = 0; }
  begin(width: number, height: number, top: number, map?: MarkerObstacle, panel?: MarkerObstacle, celebration?: MarkerObstacle, pickups?: MarkerObstacle) {
    this.count = 0; this.width = width; this.height = height; this.top = top;
    this.map = map; this.panel = panel; this.celebration = celebration; this.pickups = pickups;
    const key = `${width}/${height}/${top}/${map?.x}/${map?.y}/${map?.width}/${map?.height}/${panel?.x}/${panel?.y}/${panel?.width}/${panel?.height}/${celebration?.x}/${celebration?.y}/${celebration?.width}/${celebration?.height}/${pickups?.x}/${pickups?.y}/${pickups?.width}/${pickups?.height}`;
    if (key !== this.reservationKey) {
      this.reservationKey = key;
      this.panelY = panel?.y ?? 0; this.grid();
    } else if (panel) panel.y = this.panelY;
    for (let i = 0; i < this.slotCount; i++) this.slots[i]!.used = false;
  }
  private grid() {
    this.slotCount = 0;
    const cellWidth = this.halfWidth * 2, cellHeight = 15 + this.bottom;
    const rowStep = Math.max(cellHeight + GAP, (this.height - INSET - this.top - cellHeight) / (CAPACITY - 1));
    const columnStep = Math.max(cellWidth + GAP, (this.width - INSET * 2 - cellWidth) / (CAPACITY - 1));
    for (let row = 0; row < CAPACITY; row++) {
      const y = this.top + row * rowStep;
      if (y + cellHeight > this.height - INSET) break;
      let x = INSET;
      for (let column = 0; column < CAPACITY && x + cellWidth <= this.width - INSET; column++) {
        // Pack each row through its free horizontal bands. Fixed full-width
        // exclusions and fixed columns waste the short phone's usable area.
        for (let pass = 0; pass < 5; pass++) for (const obstacle of [this.map, this.panel, this.celebration, this.pickups]) {
          if (obstacle && x + cellWidth + GAP > obstacle.x && x - GAP < obstacle.x + obstacle.width &&
            y + cellHeight + GAP > obstacle.y && y - GAP < obstacle.y + obstacle.height) x = obstacle.x + obstacle.width + GAP;
        }
        if (x + cellWidth > this.width - INSET) break;
        const slot = this.slots[this.slotCount++]!;
        slot.x = x + this.halfWidth; slot.y = y + 15; slot.used = false;
        x += columnStep;
      }
    }
  }
  add(id: string, hive: boolean, x: number, y: number) {
    const arrow = helpArrow(x, y, this.width, this.height, this.top);
    if (!arrow || this.count === CAPACITY) return;
    const marker = this.markers[this.count++]!;
    // Clockwise: top, right, bottom, left.
    const edge = Math.abs(arrow.y - this.top) < 0.01 ? 0 : Math.abs(arrow.x - (this.width - 32)) < 0.01 ? 1 : Math.abs(arrow.y - (this.height - 40)) < 0.01 ? 2 : 3;
    marker.id = id; marker.hive = hive; marker.targetX = x; marker.targetY = y;
    marker.edge = edge; marker.tangent = edge % 2 ? arrow.y : arrow.x;
  }
  place() {
    if (this.slotCount < this.count && this.panel) {
      // Crowded short views can need the full bands above a downed message.
      // Keep the message visible and move it to the bottom only when needed.
      this.panel.y = Math.max(this.top, this.height - INSET - this.panel.height);
      this.panelY = this.panel.y; this.grid();
    }
    for (let i = 1; i < this.count; i++) {
      const marker = this.markers[i]!; let j = i - 1;
      while (j >= 0) {
        const prior = this.markers[j]!;
        if (prior.edge < marker.edge || prior.edge === marker.edge && (prior.tangent < marker.tangent || prior.tangent === marker.tangent && prior.id <= marker.id)) break;
        this.markers[j + 1] = prior; j--;
      }
      this.markers[j + 1] = marker;
    }
    for (let i = 0; i < this.count; i++) {
      const marker = this.markers[i]!;
      let best: Slot | undefined, bestLane = Infinity, bestDistance = Infinity;
      for (let j = 0; j < this.slotCount; j++) {
        const slot = this.slots[j]!; if (slot.used) continue;
        const lane = marker.edge === 0 ? slot.y : marker.edge === 1 ? -slot.x : marker.edge === 2 ? -slot.y : slot.x;
        const distance = Math.abs((marker.edge % 2 ? slot.y : slot.x) - marker.tangent);
        if (lane < bestLane || lane === bestLane && distance < bestDistance) { best = slot; bestLane = lane; bestDistance = distance; }
      }
      // During degenerate window resizes there may be less space than the glyphs
      // themselves require. Still paint every marker and keep the frame alive.
      best ??= this.slots[0]!;
      best.used = true; marker.x = best.x; marker.y = best.y;
      marker.angle = Math.atan2(marker.targetY - marker.y, marker.targetX - marker.x);
    }
  }
  draw(c: CanvasRenderingContext2D, now: number) {
    c.save(); c.font = MARKER_FONT; c.textAlign = "center";
    for (let i = 0; i < this.count; i++) {
      const marker = this.markers[i]!, size = marker.hive ? 15 : 12, back = marker.hive ? 10 : 8;
      c.save(); c.globalAlpha = marker.hive ? 1 : 0.75 + Math.sin(now / 180) * 0.25;
      c.fillStyle = marker.hive ? "#d9f278" : "#ffe09a";
      c.translate(marker.x, marker.y); c.rotate(marker.angle);
      c.beginPath(); c.moveTo(size, 0); c.lineTo(-back, -back); c.lineTo(-back, back); c.lineTo(size, 0); c.fill(); c.restore();
      c.fillStyle = marker.hive ? "#efffc2" : "#ffe09a";
      c.fillText(marker.hive ? "Hive" : "Help", marker.x, marker.y + (marker.hive ? 28 : 26));
    }
    c.restore();
  }
}
