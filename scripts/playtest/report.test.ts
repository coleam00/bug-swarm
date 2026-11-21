import { test, expect } from "bun:test";
import { requireMeasurements } from "./report";
import type { ScenarioReport } from "./types";
test("passing reports require finite measurements for every page and the server", () => {
  const valid: Pick<ScenarioReport, "pages" | "tick"> = { pages: { A: { samples: 20, fps: [60], frameMs: [0] }, B: { samples: 20, fps: [59], frameMs: [.5] } }, tick: { samples: 20, p95Ms: 1, p50Ms: .5, maxMs: 2, windowMs: 60000 } };
  expect(() => requireMeasurements(valid)).not.toThrow();
  for (const missing of ["fps", "frameMs"] as const) {
    const report = structuredClone(valid); report.pages.B![missing] = [];
    expect(() => requireMeasurements(report)).toThrow("missing paired");
  }
  for (const bad of [NaN, Infinity, -1]) {
    const report = structuredClone(valid); report.pages.A!.frameMs = [bad];
    expect(() => requireMeasurements(report)).toThrow("invalid performance");
  }
  const noFrames = structuredClone(valid); noFrames.pages.B!.fps = []; noFrames.pages.B!.frameMs = [];
  expect(() => requireMeasurements(noFrames)).toThrow("missing paired");
  expect(() => requireMeasurements({ ...valid, tick: undefined })).toThrow("server tick");
});
