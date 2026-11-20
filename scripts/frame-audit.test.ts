import { expect, test } from "bun:test";
import { FrameAudit } from "./frame-audit";

test("frame audit starts at the first sample and retains every complete rolling window", () => {
  const audit = new FrameAudit();
  for (let i = 0; i <= 120; i++) {
    const timestamp = 5000 + i * 1000 / 60;
    audit.record(timestamp, timestamp + 0.5, timestamp + 2.5, 0.2, 1.5, 0.1);
  }
  const report = audit.report();
  expect(report.gaps).toHaveLength(0); expect(report.windows).toHaveLength(2);
  for (const window of report.windows) {
    expect(window.frames).toBe(60); expect(window.durationMs).toBeCloseTo(1000);
    expect(window.fps).toBeCloseTo(60); expect(window.maxCallbackMs).toBe(2); expect(window.maxDelayMs).toBe(0.5);
  }
  expect(report.maxIntervalMs).toBeCloseTo(1000 / 60); expect(report.maxCallbackMs).toBe(2);
});

test("frame audit retains expensive preceding work and counts the lost frames in FPS", () => {
  const audit = new FrameAudit();
  audit.record(0, 1, 81, 0.1, 79, 0.1);
  audit.record(100, 101, 103, 0.2, 1.5, 0.1);
  for (let i = 1; i <= 54; i++) {
    const timestamp = 100 + i * 1000 / 60;
    audit.record(timestamp, timestamp + 1, timestamp + 3, 0.2, 1.5, 0.1);
  }
  const report = audit.report();
  expect(report.windows).toHaveLength(1); expect(report.windows[0]!.fps).toBeCloseTo(55);
  expect(report.maxIntervalMs).toBe(100); expect(report.maxCallbackMs).toBe(80);
  expect(report.gaps).toEqual([{ atMs: 100, intervalMs: 100, previousCallbackMs: 80,
    betweenCallbacksMs: 20, callbackDelayMs: 1, callbackMs: 2, updateMs: 0.2, drawMs: 1.5, fixtureMs: 0.1 }]);
});

test("frame audit distinguishes a delivery gap from a long measured callback", () => {
  const audit = new FrameAudit();
  audit.record(0, 0, 2, 0.2, 1.5, 0.1);
  audit.record(100, 107, 110, 0.3, 2, 0.2);
  const gap = audit.report().gaps[0]!;
  expect(gap.intervalMs).toBe(100); expect(gap.previousCallbackMs).toBe(2);
  expect(gap.betweenCallbacksMs).toBe(105); expect(gap.callbackDelayMs).toBe(7);
  expect(gap.callbackMs).toBe(3); expect(gap.updateMs).toBe(0.3); expect(gap.drawMs).toBe(2);
});
