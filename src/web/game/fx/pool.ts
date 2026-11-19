/** Fixed storage. Overflow drops new emissions; expired slots are reused LIFO. */
export class Pool {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly life: Float64Array;
  readonly duration: Float64Array;
  private readonly free: Int32Array;
  private available = 0;
  get count(): number { return this.capacity - this.available; }

  constructor(readonly capacity: number) {
    this.x = new Float64Array(capacity); this.y = new Float64Array(capacity);
    this.vx = new Float64Array(capacity); this.vy = new Float64Array(capacity);
    this.life = new Float64Array(capacity); this.duration = new Float64Array(capacity);
    this.free = new Int32Array(capacity); this.reset();
  }
  emit(x: number, y: number, vx: number, vy: number, duration: number): number {
    if (!this.available || duration <= 0) return -1;
    const i = this.free[--this.available]!;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.life[i] = duration; this.duration[i] = duration;
    return i;
  }
  update(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.capacity; i++) {
      const life = this.life[i]!;
      if (life <= 0) continue;
      if (dt >= life) { this.life[i] = 0; this.free[this.available++] = i; }
      else {
        this.life[i] = life - dt;
        this.x[i] = this.x[i]! + this.vx[i]! * dt;
        this.y[i] = this.y[i]! + this.vy[i]! * dt;
      }
    }
  }
  reset(): void {
    this.life.fill(0); this.available = this.capacity;
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - i - 1;
  }
}
