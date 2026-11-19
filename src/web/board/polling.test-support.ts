import type { Scheduler } from "./polling";

export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
export class FakeScheduler implements Scheduler {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  setTimeout = (callback: () => void, ms: number) => {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + ms, callback });
    return id;
  };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async tick(ms: number) {
    const until = this.time + ms;
    await flush();
    for (;;) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      this.time = next[1].at; this.timers.delete(next[0]); next[1].callback();
      await flush();
    }
    this.time = until;
    await flush();
  }
}
