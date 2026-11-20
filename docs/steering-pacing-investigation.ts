// Reproduce the unresolved issue-40 balance tradeoff without changing production.
// Run with a scratch HOME/USERPROFILE/DATA_DIR; no API or database is opened.
import { SPAWN_CURVE } from "../src/web/game/config";
import { runMatrix, runBroadMatrix, printReport, targets, broadTargets, median } from "../scripts/pacing";
import { mkdirSync, writeFileSync } from "node:fs";

const output = "docs/steering-evidence";
mkdirSync(output, { recursive: true });
const curve = SPAWN_CURVE as unknown as { time: number; interval: number }[];
const original = curve.map(knot => ({ ...knot })), late = original.filter(knot => knot.time >= 60);
const candidates = {
  gentle: [{ time: 0, interval: 0.95 }, { time: 15, interval: 0.9 },
    { time: 20, interval: 0.2 }, { time: 22, interval: 0.2 },
    { time: 23, interval: 10 }, { time: 45, interval: 10 }, ...late],
  pressure: [{ time: 0, interval: 2 }, { time: 15, interval: 2 },
    { time: 20, interval: 0.02 }, { time: 22, interval: 0.02 },
    { time: 23, interval: 10 }, { time: 45, interval: 10 }, ...late],
};
const summaries = [];
try {
  for (const [name, knots] of Object.entries(candidates)) {
    curve.splice(0, curve.length, ...knots);
    for (const broad of [false, true]) {
      const rows = broad ? runBroadMatrix() : runMatrix();
      const log = console.log, lines: string[] = [];
      try { console.log = line => { lines.push(String(line)); }; printReport(rows, broad); }
      finally { console.log = log; }
      const idle = rows.filter(row => row.mode === "idle"), evasive = rows.filter(row => row.mode === "evasive");
      const idle20to30 = idle.length > 0 && idle.every(row => row.dead && row.elapsed >= 20 - 1e-7 && row.elapsed <= 30 + 1e-7);
      lines.push(`${idle20to30 ? "PASS" : "FAIL"} proposed idle20to30`);
      const file = `${name}-${broad ? "broad" : "default"}.txt`;
      writeFileSync(`${output}/${file}`, lines.join("\n") + "\n");
      summaries.push({ name, broad, knots, file, gates: { ...(broad ? broadTargets(rows) : targets(rows)), idle20to30 },
        idleMin: Math.min(...idle.map(row => row.elapsed)), idleMax: Math.max(...idle.map(row => row.elapsed)),
        evasiveMedian: median(evasive.map(row => row.elapsed)), longest: Math.max(...rows.map(row => row.elapsed)),
        scoreFailures: rows.filter(row => !row.validScore).length,
        idleOutliers: idle.filter(row => !row.dead || row.elapsed < 20 - 1e-7 || row.elapsed > 30 + 1e-7).length });
    }
  }
} finally { curve.splice(0, curve.length, ...original); }
writeFileSync(`${output}/pacing-investigation.json`, JSON.stringify(summaries, null, 2) + "\n");
console.log(JSON.stringify(summaries));
