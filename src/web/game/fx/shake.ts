export class Shake {
  remaining = 0;
  x = 0;
  y = 0;
  hit(): void { this.remaining = 0.16; this.offset(); }
  update(dt: number): void { this.remaining = Math.max(0, this.remaining - dt); this.offset(); }
  private offset(): void {
    const amplitude = 4 * this.remaining / 0.16;
    this.x = Math.cos(this.remaining * 170) * amplitude;
    this.y = Math.sin(this.remaining * 170) * amplitude;
  }
  reset(): void { this.remaining = 0; this.x = 0; this.y = 0; }
}
