import { createCohort, type CohortStats } from "./bot-cohort";
import type { BotOptions } from "./bots";
export interface Cohort {
  ready: Promise<void>; cached: CohortStats;
  window(start: number, end: number): void;
  refresh(): Promise<void>; close(): Promise<void>;
}
export function botCohorts(options: BotOptions, fail: (error: Error) => void): Cohort[] {
  const result: Cohort[] = [];
  for (let index = 0; index < options.count; index += 20) {
    const slice = { ...options, count: Math.min(20, options.count - index) };
    if (options.count <= 20) {
      const local = createCohort(slice, index, fail);
      const cohort: Cohort = { ready: local.ready, cached: local.stats(), window: local.window,
        async refresh() { cohort.cached = local.stats(); }, async close() { await local.close(); cohort.cached = local.stats(); } };
      result.push(cohort); continue;
    }
    const worker = new Worker(new URL("./bot-worker.ts", import.meta.url).href);
    let resolveReady!: () => void, serial = 0;
    const pending = new Map<number, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
    const request = (type: string) => new Promise<void>(resolve => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); fail(Error("Bot worker " + type + " timed out")); resolve(); }, 3000);
      pending.set(id, { resolve, timer }); worker.postMessage({ type, id });
    });
    const cohort: Cohort = {
      cached: { joins: 0, arenas: [], playerIds: [], joining: { sent: 0, received: 0, bytesReceived: 0 }, client: { sent: 0, received: 0, bytesReceived: 0, schedulerSkips: 0, minInputSendGapMs: Infinity }, lifecycle: { prematureDisconnects: 0, normalTeardownConnections: 0 } },
      ready: new Promise<void>(resolve => { resolveReady = resolve; }),
      window(start, end) { worker.postMessage({ type: "window", start, end }); },
      async refresh() { await request("stats"); },
      async close() { try { await request("close"); } finally { worker.terminate(); for (const p of pending.values()) { clearTimeout(p.timer); p.resolve(); } pending.clear(); } },
    };
    worker.onmessage = event => {
      const message = event.data;
      if (message.stats) cohort.cached = message.stats;
      if (message.type === "ready") resolveReady();
      if (message.type === "failure") fail(Error(message.message));
      const p = pending.get(message.id); if (p) { clearTimeout(p.timer); pending.delete(message.id); p.resolve(); }
    };
    worker.onerror = event => { event.preventDefault(); fail(Error("Bot worker: " + event.message)); };
    worker.postMessage({ type: "start", options: slice, index });
    result.push(cohort);
  }
  return result;
}
