import type { SessionTiming } from "./session";

/** Monotonic wall clock, independent of paused gameplay and animation frames. */
export class FakeTiming implements SessionTiming {
  time = 0;
  private sequence = 0;
  pending = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  schedule = (callback: () => void, delay: number) => {
    const id = ++this.sequence;
    this.pending.set(id, { at: this.time + delay, callback }); return id;
  };
  cancel = (handle: unknown) => { this.pending.delete(handle as number); };
  advance(ms: number) {
    const until = this.time + ms;
    for (;;) {
      const next = [...this.pending].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      this.time = next[1].at; this.pending.delete(next[0]); next[1].callback();
    }
    this.time = until;
  }
}
