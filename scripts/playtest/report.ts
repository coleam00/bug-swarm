import { requireAgreement } from "./agreement";
import type { ScenarioReport } from "./types";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** A passing scenario must supply evidence, not merely reserve report fields. */
export function requireMeasurements(report: Pick<ScenarioReport, "pages" | "tick">) {
  const pages = Object.entries(report.pages);
  requireAgreement(pages.length > 0, "No participating pages");
  for (const [name, page] of pages) {
    requireAgreement(page.samples >= 5, `${name}: insufficient agreement samples`);
    requireAgreement(page.fps.length > 0 && page.fps.length === page.frameMs.length, `${name}: missing paired FPS/frame-time measurements`);
    requireAgreement(page.fps.every(v => Number.isFinite(v) && v > 0) && page.frameMs.every(v => Number.isFinite(v) && v >= 0), `${name}: non-finite or invalid performance measurements`);
  }
  requireAgreement(report.tick && report.tick.samples > 0 && report.tick.p95Ms !== null && Number.isFinite(report.tick.p95Ms) && report.tick.p95Ms >= 0, "Missing finite server tick p95");
}

export function requireScreenshots(root: string, report: Pick<ScenarioReport, "pages" | "screenshots">) {
  for (const name of Object.keys(report.pages)) requireAgreement(report.screenshots.some(s => s.player === name), `${name}: missing screenshot evidence`);
  // Check every key-moment reference, including separately opened board pages,
  // rather than accepting one surviving image while other captures are missing.
  for (const screenshot of report.screenshots) {
    const path = join(root, screenshot.file);
    requireAgreement(existsSync(path), `Missing screenshot file: ${screenshot.file}`);
    const file = statSync(path);
    requireAgreement(file.isFile() && file.size > 0, `Empty or invalid screenshot file: ${screenshot.file}`);
  }
}
