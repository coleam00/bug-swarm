import { STEP } from "./config";
import { step, type Input, type Simulation } from "./simulation";

export class FixedStepper {
  private previous: number | null = null;
  private accumulated = 0;
  reset() { this.previous = null; this.accumulated = 0; }
  advance(timestamp: number, state: Simulation, input: Input): void {
    if (this.previous === null) { this.previous = timestamp; return; }
    this.accumulated += Math.max(0, Math.min((timestamp - this.previous) / 1000, STEP * 5));
    this.previous = timestamp;
    let steps = 0;
    while (this.accumulated + 1e-9 >= STEP && steps < 5) {
      step(state, input, STEP); this.accumulated -= STEP; steps++;
    }
    if (steps === 5) this.accumulated = 0;
  }
}
