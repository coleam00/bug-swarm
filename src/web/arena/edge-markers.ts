import { MAX_PLAYERS } from "../../shared/arena/constants";
import { helpArrow } from "./help-arrow";

const CAPACITY = MAX_PLAYERS + 1, INSET = 8, GAP = 8;
export const MARKER_FONT = "bold 16px system-ui";
interface Marker {
  id: string; hive: boolean; targetX: number; targetY: number;
  edge: number; tangent: number;
  x: number; y: number; angle: number;
}
interface Slot { x: number; y: number; column: number; row: number; used: boolean }

/** A shared CSS-pixel grid keeps complete arrows and labels apart, including corners.
 * Only viewport changes rebuild slots; frame collection and insertion sort reuse storage. */
export class EdgeMarkers {
  readonly markers: Marker[] = Array.from({ length: CAPACITY }, () => ({
    id: "", hive: false, targetX: 0, targetY: 0,
    edge: 0, tangent: 0, x: 0, y: 0, angle: 0,
  }));
  private readonly slots: Slot[] = Array.from({ length: CAPACITY * CAPACITY }, () => ({ x: 0, y: 0, column: 0, row: 0, used: false }));
  private slotCount = 0; private columns = 0; private rows = 0;
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
  reset() { this.count = 0; this.width = -1; this.slotCount = 0; }
  begin(width: number, height: number, top: number) {
    this.count = 0;
    if (this.width !== width || this.height !== height || this.top !== top) {
      this.width = width; this.height = height; this.top = top;
      const cellWidth = this.halfWidth * 2, cellHeight = 15 + this.bottom;
      this.columns = Math.max(0, Math.min(CAPACITY, Math.floor((width - INSET * 2 + GAP) / (cellWidth + GAP))));
      this.rows = Math.max(0, Math.min(CAPACITY, Math.floor((height - INSET - top + GAP) / (cellHeight + GAP))));
      this.slotCount = this.columns * this.rows;
      for (let row = 0; row < this.rows; row++) for (let column = 0; column < this.columns; column++) {
        const slot = this.slots[row * this.columns + column]!;
        slot.column = column; slot.row = row;
        slot.x = INSET + this.halfWidth + (this.columns < 2 ? 0 : column * (width - INSET * 2 - cellWidth) / (this.columns - 1));
        slot.y = top + 15 + (this.rows < 2 ? 0 : row * (height - INSET - top - cellHeight) / (this.rows - 1));
      }
    }
    for (let i = 0; i < this.slotCount; i++) this.slots[i]!.used = false;
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
        const lane = marker.edge === 0 ? slot.row : marker.edge === 1 ? this.columns - 1 - slot.column : marker.edge === 2 ? this.rows - 1 - slot.row : slot.column;
        const distance = Math.abs((marker.edge % 2 ? slot.y : slot.x) - marker.tangent);
        if (lane < bestLane || lane === bestLane && distance < bestDistance) { best = slot; bestLane = lane; bestDistance = distance; }
      }
      if (!best) throw new Error("Viewport has insufficient edge marker slots");
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
