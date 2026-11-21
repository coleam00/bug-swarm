import { expect, test } from "bun:test";
import { TickMetrics, TrafficMetrics, HISTORY_MS, byteDistribution } from "./metrics";
test("snapshot sizes merge weighted histograms rather than percentiles", () => {
  expect(byteDistribution([[100, 99], [1000, 1], [1000, 1]])).toMatchObject({ samples: 101, p50: 100, p95: 100, max: 1000 });
});
test("capacity overruns explicitly invalidate older windows", () => {
  let now = 0; const m = new TickMetrics(() => now, 2);
  m.add(1); now = 50; m.add(2); expect(m.retains(0)).toBe(true);
  now = 100; m.add(3); expect(m.retains(0)).toBe(false); expect(m.retains(50)).toBe(true);
});
test("aligned half-open timing windows, maxima and pooled unequal-room percentiles", () => {
  let now = 0; const a = new TickMetrics(() => now), b = new TickMetrics(() => now);
  a.add(99); now = 50; a.add(4); for (let i = 0; i < 99; i++) b.add(1);
  now = 100; a.add(1000);
  expect(a.stats(50, 100, true)).toMatchObject({ samples: 1, p50Ms: 4, p95Ms: 4, maxMs: 4, raw: [4] });
  expect(TickMetrics.combine([a, b], 50, 100)).toMatchObject({ samples: 100, p95Ms: 1, maxMs: 4 });
  now = 60050; expect(a.stats().samples).toBe(1); expect(a.stats(0, 100).samples).toBe(2);
  expect(a.stats(200, 300)).toMatchObject({ samples: 0, maxMs: null });
});
test("traffic totals exclude adjacent buckets, distinguish send results and retain bounded history", () => {
  const m = new TrafficMetrics();
  m.add(49, "bytesOut", 999); m.add(50, "bytesOut", 100); m.add(1049, "bytesOut", 200); m.add(1050, "bytesOut", 300);
  m.add(50, "attempted", 3); m.add(50, "accepted", 2); m.add(50, "queued"); m.add(50, "rejected"); m.add(50, "in", 4);
  expect(m.totals(50, 1050)).toMatchObject({ bytesOut: 300, peakSecondBytesOut: 300, attempted: 3, accepted: 2, queued: 1, rejected: 1, in: 4 });
  expect(m.totals(1050, 1100).bytesOut).toBe(300);
  m.add(HISTORY_MS + 100, "bytesOut", 7);
  expect(m.totals(50, 100).bytesOut).toBe(0); expect(m.totals(HISTORY_MS + 100, HISTORY_MS + 150).bytesOut).toBe(7);
});
