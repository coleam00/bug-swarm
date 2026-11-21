import { join, relative } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs, runDirectory, scratchEnv, scenarios } from "./playtest/options";
import { Browser, chromeExecutable, bounded } from "./playtest/browser";
import { Context } from "./playtest/context";
import type { ScenarioReport } from "./playtest/types";
import together from "./playtest/scenarios/together";
import combat from "./playtest/scenarios/combat";
import revive from "./playtest/scenarios/revive";
import lateJoin from "./playtest/scenarios/late-join";
import phoneDesktop from "./playtest/scenarios/phone-desktop";
import restart from "./playtest/scenarios/restart";
import boss from "./playtest/scenarios/boss";

const implementations = { together, combat, revive, "late-join": lateJoin, "phone-desktop": phoneDesktop, restart, boss };
export async function main(args = process.argv.slice(2)) {
  const start = performance.now(), deadline = start + 570000, browser = new Browser();
  const controller = new AbortController(), interrupt = () => controller.abort(Error("Playtest interrupted"));
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  let root = "", error: string | undefined;
  const reports: ScenarioReport[] = [];
  const timing: Record<string, number> = {};
  try {
    const options = parseArgs(args); root = runDirectory(process.cwd(), options);
    chromeExecutable();
    console.log(`Playtest evidence: ${root}`);
    const assets = join(root, "assets"), env = { ...scratchEnv(root), ARENA_PLAYTEST: "1", NODE_ENV: "production", BUN_INSTALL_CACHE_DIR: join(root, "cache") };
    const buildStart = performance.now();
    const build = Bun.spawn([process.execPath, "node_modules/vite/bin/vite.js", "build", "--mode", "playtest", "--outDir", relative(process.cwd(), assets)], { env, stdout: Bun.file(join(root, "build.log")), stderr: Bun.file(join(root, "build-errors.log")) });
    try { await bounded(build.exited, 30000, "Playtest build"); }
    catch (error) { if (build.exitCode === null) build.kill(); await build.exited; throw error; }
    if (build.exitCode !== 0) throw Error("Instrumented production build failed: see build logs");
    timing.buildMs = performance.now() - buildStart;
    const browserStart = performance.now(); await browser.start(root); timing.browserStartupMs = performance.now() - browserStart;
    for (const name of options.scenario ? [options.scenario] : scenarios) {
      controller.signal.throwIfAborted();
      const bots = options.bots ?? (name === "together" ? 10 : name === "late-join" ? 8 : name === "boss" ? 2 : 0);
      const c = new Context(name, join(root, name), assets, browser, bots, deadline, controller.signal);
      console.log(`${name}: starting (${bots} bots)`);
      let failure: unknown;
      try { await implementations[name](c); } catch (e) { failure = e; console.error(`${name}: ${String(e)}`); }
      const report = await c.finish(failure); reports.push(report);
      console.log(`${name}: ${report.status} (${(report.elapsedMs / 1000).toFixed(1)} s)`);
      if (performance.now() >= deadline) throw Error("Suite exceeded 570 second deadline");
    }
  } catch (e) { error = String(e instanceof Error ? e.stack : e); console.error(error); }
  finally {
    try { await browser.close(); } catch (e) { error = [error, "Chrome cleanup: " + String(e)].filter(Boolean).join("\n"); }
    if (!root) { root = runDirectory(process.cwd(), { issue: "86" }); }
    mkdirSync(root, { recursive: true });
    const elapsedMs = performance.now() - start;
    const pass = !error && reports.length > 0 && reports.every(r => r.status === "pass" || r.status === "skip") && elapsedMs < 600000;
    writeFileSync(join(root, "report.json"), JSON.stringify({ status: pass ? "pass" : "fail", elapsedMs, timing, browser: browser.metadata, error, scenarios: reports }, null, 2));
    console.log(`Report: ${join(root, "report.json")}`);
    process.exitCode = pass ? 0 : 1;
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}
if (import.meta.main) await main();
