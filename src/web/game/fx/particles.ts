import { Pool } from "./pool";

export class Particles extends Pool {
  private seed = 1;
  constructor(capacity = 1024) { super(capacity); }
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
  burst(x: number, y: number): void {
    for (let n = 0; n < 8; n++) {
      const angle = this.random() * Math.PI * 2, speed = 35 + this.random() * 100;
      this.emit(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.25 + this.random() * 0.2);
    }
  }
  override reset(): void { super.reset(); this.seed = 1; }
}
