import { Pool } from "./pool";

export class FloatingText extends Pool {
  constructor(capacity = 256) { super(capacity); }
  pop(x: number, y: number): void { this.emit(x, y, 0, -30, 0.65); }
}
