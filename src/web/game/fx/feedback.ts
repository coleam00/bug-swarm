import type { StepObserver } from "../loop";
import type { Bug, Simulation } from "../simulation";
import type { Effects } from "./index";

export class Feedback implements StepObserver {
  // Shot removal preserves survivor order. Track a bounded prefix; overflow
  // omits cosmetic bursts only, never gameplay. No copying, maps or sorting.
  private readonly snapshot: (Readonly<Bug> | undefined)[];
  private count = 0;
  private squashes = 0;
  private hits = 0;
  private x = 0;
  private y = 0;
  constructor(private readonly fx: Effects, readonly capacity = 1024) {
    this.snapshot = new Array<Readonly<Bug> | undefined>(capacity).fill(undefined);
  }
  beforeShots(bugs: readonly Readonly<Bug>[], squashes: number): void {
    this.count = Math.min(bugs.length, this.capacity); this.squashes = squashes;
    for (let i = 0; i < this.count; i++) this.snapshot[i] = bugs[i];
  }
  afterShots(bugs: readonly Readonly<Bug>[], squashes: number): void {
    let survivor = 0, remaining = squashes - this.squashes;
    for (let i = 0; i < this.count; i++) {
      const bug = this.snapshot[i]!;
      if (bug === bugs[survivor]) survivor++;
      else if (remaining > 0) { this.fx.squash(bug.x, bug.y); remaining--; }
      this.snapshot[i] = undefined;
    }
    this.count = 0;
  }
  beforeStep(state: Readonly<Simulation>): void {
    this.hits = state.hits; this.x = state.robot.x; this.y = state.robot.y;
  }
  afterStep(state: Readonly<Simulation>, dt: number): void {
    if (state.hits > this.hits) this.fx.hit();
    this.fx.trails.movement(this.x, this.y, !state.dead && (this.x !== state.robot.x || this.y !== state.robot.y), dt);
  }
  reset(): void { this.snapshot.fill(undefined); this.count = 0; this.squashes = 0; this.hits = 0; }
}
