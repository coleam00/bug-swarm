import { Pool } from "./pool";

export class Trails extends Pool {
  private cooldown = 0;
  constructor(capacity = 128) { super(capacity); }
  movement(x: number, y: number, moved: boolean, dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (moved && this.cooldown <= 1e-9) {
      this.emit(x, y, 0, 0, 0.18); this.cooldown = 1 / 40;
    }
  }
  override reset(): void { super.reset(); this.cooldown = 0; }
}
