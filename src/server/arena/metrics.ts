import { METRIC_WINDOW_MS, STEP_MS } from "../../shared/arena/constants";
export class TickMetrics {
  private samples: { at: number; ms: number }[] = [];
  constructor(private now = () => performance.now()) {}
  add(ms: number) {
    this.expire();
    if (this.samples.length >= Math.ceil(METRIC_WINDOW_MS / STEP_MS) + 1) this.samples.shift();
    this.samples.push({ at: this.now(), ms });
  }
  private expire() { const cutoff = this.now() - METRIC_WINDOW_MS; while (this.samples[0] && this.samples[0].at <= cutoff) this.samples.shift(); }
  stats() {
    this.expire(); const sorted = this.samples.map(s => s.ms).sort((a, b) => a - b);
    const percentile = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1]! : null;
    return { windowMs: METRIC_WINDOW_MS, samples: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
  }
  static combine(metrics: TickMetrics[]) {
    // Samples can use an injected epoch. Only source metrics expire them.
    const sorted = metrics.flatMap(metric => { metric.expire(); return metric.samples.map(s => s.ms); }).sort((a, b) => a - b);
    return { windowMs: METRIC_WINDOW_MS, samples: sorted.length,
      p50Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1]! : null,
      p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1]! : null };
  }
}
