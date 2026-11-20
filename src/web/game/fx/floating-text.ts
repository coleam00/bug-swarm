import { Pool } from "./pool";
import { POINTS_PER_SQUASH } from "../../../server/rules";

export class FloatingText extends Pool {
  readonly total: Float64Array;
  readonly anchorX: Float64Array;
  readonly anchorY: Float64Array;
  constructor(capacity = 12) {
    super(capacity);
    this.total = new Float64Array(capacity);
    this.anchorX = new Float64Array(capacity); this.anchorY = new Float64Array(capacity);
  }
  pop(x: number, y: number): void {
    // "40 px" means logical world units, independent of viewport scale/DPR.
    // First-emission anchors/window never follow the rising text or a merge.
    let nearest = -1, distance = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i]! <= 0 || this.duration[i]! - this.life[i]! > 0.25 + 1e-9) continue;
      const d = (x - this.anchorX[i]!) ** 2 + (y - this.anchorY[i]!) ** 2;
      if (d <= 40 ** 2 && d < distance) { nearest = i; distance = d; }
    }
    if (nearest >= 0) { this.total[nearest] = this.total[nearest]! + POINTS_PER_SQUASH; return; }
    const i = this.emit(x, y, 0, -30, 0.65);
    if (i < 0) return; // Only the cosmetic label is omitted at capacity.
    this.total[i] = POINTS_PER_SQUASH; this.anchorX[i] = x; this.anchorY[i] = y;
  }
  override reset(): void {
    super.reset();
    // Pool's constructor also calls reset, before these arrays exist.
    this.total?.fill(0); this.anchorX?.fill(0); this.anchorY?.fill(0);
  }
}
