import { METRIC_WINDOW_MS, STEP_MS } from "../../shared/arena/constants";
export const HISTORY_MS = 180_000;
const SLOTS = HISTORY_MS / STEP_MS + 1;
export function distribution(values: number[]) {
  values.sort((a, b) => a - b);
  const at = (p: number) => values.length ? values[Math.ceil(values.length * p) - 1]! : null;
  return { samples: values.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: values.at(-1) ?? null };
}
export function byteDistribution(entries: Iterable<readonly [number, number]>) {
  const counts = new Map<number, number>(); let samples = 0;
  for (const [bytes, count] of entries) { counts.set(bytes, (counts.get(bytes) ?? 0) + count); samples += count; }
  const histogram = [...counts].sort((a, b) => a[0] - b[0]);
  const at = (p: number) => { let count = 0; for (const [bytes, n] of histogram) { count += n; if (count >= Math.ceil(samples * p)) return bytes; } return null; };
  return { samples, p50: at(.5), p95: at(.95), max: histogram.at(-1)?.[0] ?? null, histogram };
}
export class TickMetrics {
  private times: Float64Array;
  private values: Float64Array;
  private cursor = 0; private count = 0;
  constructor(private now = () => performance.now(), private capacity = SLOTS) { this.times = new Float64Array(capacity); this.values = new Float64Array(capacity); }
  add(ms: number) {
    this.times[this.cursor] = this.now(); this.values[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % this.capacity; this.count = Math.min(this.capacity, this.count + 1);
  }
  samples(since?: number, until = Infinity) {
    const cutoff = since ?? this.now() - METRIC_WINDOW_MS;
    const values: number[] = [];
    for (let i = 0; i < this.count; i++) if ((since === undefined ? this.times[i]! > cutoff : this.times[i]! >= cutoff) && this.times[i]! < until) values.push(this.values[i]!);
    return values;
  }
  stats(since?: number, until = Infinity, raw = false) {
    const values = this.samples(since, until);
    return { windowMs: until === Infinity ? METRIC_WINDOW_MS : until - since!, ...distribution([...values]), ...(raw ? { raw: values } : {}) };
  }
  static combine(metrics: TickMetrics[], since?: number, until?: number, raw = false) {
    const values = metrics.flatMap(m => m.samples(since, until));
    return { windowMs: until === undefined ? METRIC_WINDOW_MS : until - since!, ...distribution([...values]), ...(raw ? { raw: values } : {}) };
  }
}
export const TRAFFIC_KEYS = ["in", "bytesIn", "attempted", "accepted", "queued", "rejected", "skipped", "bytesOut", "transportErrors", "malformed", "unknown", "oversized", "rateLimited", "sequence", "handshake", "backpressure", "saveErrors"] as const;
export type TrafficKey = typeof TRAFFIC_KEYS[number];
export type TrafficTotals = Record<TrafficKey, number>;
export const emptyTraffic = (): TrafficTotals => Object.fromEntries(TRAFFIC_KEYS.map(k => [k, 0])) as TrafficTotals;
/** Fixed 50 ms buckets. No arrays/objects allocated while recording traffic. */
export class TrafficMetrics {
  private tags = new Float64Array(SLOTS).fill(-1);
  private values = new Float64Array(SLOTS * TRAFFIC_KEYS.length);
  add(now: number, key: TrafficKey, value = 1) {
    const tag = Math.floor(now / STEP_MS), slot = tag % SLOTS, offset = slot * TRAFFIC_KEYS.length;
    if (this.tags[slot] !== tag) { this.tags[slot] = tag; this.values.fill(0, offset, offset + TRAFFIC_KEYS.length); }
    this.values[offset + TRAFFIC_KEYS.indexOf(key)]! += value;
  }
  totals(since: number, until: number) {
    const totals = emptyTraffic(), seconds = new Map<number, number>();
    for (let tag = Math.floor(since / STEP_MS); tag < until / STEP_MS; tag++) {
      const slot = tag % SLOTS; if (this.tags[slot] !== tag) continue;
      for (let k = 0; k < TRAFFIC_KEYS.length; k++) totals[TRAFFIC_KEYS[k]!] += this.values[slot * TRAFFIC_KEYS.length + k]!;
      const second = Math.floor((tag * STEP_MS - since) / 1000);
      seconds.set(second, (seconds.get(second) ?? 0) + this.values[slot * TRAFFIC_KEYS.length + 7]!);
    }
    return { ...totals, peakSecondBytesOut: Math.max(0, ...seconds.values()) };
  }
}
