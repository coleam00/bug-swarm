import { requireAgreement } from "./agreement";
import type { ScenarioReport } from "./types";

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
