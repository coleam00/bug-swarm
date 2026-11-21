import { test, expect } from "bun:test";
import { requireMeasurements, requireScreenshots } from "./report";
import type { ScenarioReport } from "./types";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Browser } from "./browser";
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

test("screenshot evidence requires every player and every nonempty capture, including boards", async () => {
  const parent = join(process.cwd(), ".evidence", "86", "tests"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "screenshots-")), browser = new Browser();
  // Only CDP is faked: exercise the actual capture writer and filesystem checks.
  browser.call = async () => ({ data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X0AAAAASUVORK5CYII=" });
  const report: Pick<ScenarioReport, "pages" | "screenshots"> = {
    pages: { A: { samples: 20, fps: [60], frameMs: [1] }, B: { samples: 20, fps: [60], frameMs: [1] } },
    screenshots: [{ player: "A", file: "joined-A.png" }, { player: "B", file: "joined-B.png" }, { player: "A", file: "moving-A.png" }, { player: "board-0", file: "board-0.png" }],
  };
  try {
    for (const s of report.screenshots) await browser.screenshot(s.player, join(root, s.file));
    expect(() => requireScreenshots(root, report)).not.toThrow();
    expect(() => requireScreenshots(root, { ...report, screenshots: report.screenshots.filter(s => s.player !== "B") })).toThrow("B: missing screenshot evidence");
    for (const s of report.screenshots) {
      const path = join(root, s.file);
      unlinkSync(path);
      expect(() => requireScreenshots(root, report)).toThrow(`Missing screenshot file: ${s.file}`);
      writeFileSync(path, "");
      expect(() => requireScreenshots(root, report)).toThrow(`Empty or invalid screenshot file: ${s.file}`);
      mkdirSync(path + ".dir"); unlinkSync(path);
      expect(() => requireScreenshots(root, { ...report, screenshots: report.screenshots.map(v => v === s ? { ...v, file: s.file + ".dir" } : v) })).toThrow("invalid screenshot file");
      await browser.screenshot(s.player, path);
    }
    expect(() => requireScreenshots(root, report)).not.toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
