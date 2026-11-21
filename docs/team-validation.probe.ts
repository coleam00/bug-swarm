// Developer-only Chrome evidence. Install playwright-core in SCRATCH, build first,
// then run with SCRATCH pointing to that directory. No network listener is opened:
// all browser HTTP requests use the real Hono app through Playwright interception.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { openDb } from "../src/server/db";
import { createApp } from "../src/server/app";

const scratch = process.env.SCRATCH!;
assert.ok(scratch, "Set SCRATCH to a fresh directory containing playwright-core");
const home = join(scratch, "home"), data = mkdtempSync(join(scratch, "data-"));
mkdirSync(home, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, DATA_DIR: data };
const { chromium } = await import(pathToFileURL(join(scratch, "node_modules/playwright-core/index.mjs")).href);
const db = openDb(join(data, "app.db")), app = createApp(db);
const evidence = resolve("docs/team-evidence"); mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }), headless: true, env });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const results: Record<string, unknown> = { chrome: browser.version(), viewport: "390x844 touch; 844x390 landscape" };
let mode = "real", starts = 0;
const held: (() => void)[] = [];
await context.route("**/*", async (route: any) => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path.startsWith("/api/")) {
    if (path === "/api/runs") starts++;
    if (path === "/api/teams" && mode === "loading") await new Promise<void>(resolve => held.push(resolve));
    if (mode === "error" && request.method() === "GET") return route.fulfill({ status: 503, body: "unavailable" });
    if (path === "/api/teams" && ["zero", "populated"].includes(mode)) {
      return route.fulfill({ json: mode === "zero" ? { tabs: 0, spaces: 0 } : { tabs: 123, spaces: 456 } });
    }
    const response = await app.request(path, { method: request.method(), headers: request.headers(), body: request.postData() ?? undefined });
    return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
  }
  const file = path === "/" ? "index.html" : path.slice(1);
  assert.ok(file === "index.html" || readdirSync("dist/assets").some(name => file === `assets/${name}`));
  return route.fulfill({ body: readFileSync(join("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
});
const page = await context.newPage();
const pageErrors: Error[] = [];
page.on("pageerror", (error: Error) => pageErrors.push(error));
page.on("console", (message: any) => { if (message.type() === "error") console.error("Browser log", message.text()); });
// Locate the real Session through React's host fiber; no production test hooks.
async function sessionAction(action: "end" | "all-upgrades") {
  await page.evaluate((action: string) => {
    const element = document.querySelector(".game") as any;
    let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))!];
    for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
      const session = hook.memoizedState;
      if (session?.identity && typeof session.end === "function") {
        const simulation = session.current.simulation;
        simulation.dead = true;
        if (action === "all-upgrades") {
          simulation.seconds = 80; simulation.score = 80;
          for (const id of Object.keys(simulation.upgrades.counts)) simulation.upgrades.counts[id] = 1;
        }
        session.end(); return;
      }
    }
    throw new Error("Session not found");
  }, action);
}
async function measure(name: string, entry = false) {
  const measurement = await page.evaluate((entry: boolean) => {
    const targets = [...document.querySelectorAll("button")].map(button => ({ text: button.textContent, ...button.getBoundingClientRect().toJSON() }));
    return { targets, overflow: document.documentElement.scrollWidth > innerWidth, width: innerWidth, height: innerHeight };
  }, entry);
  assert.equal(measurement.overflow, false);
  for (const target of measurement.targets) { assert.ok(target.width >= 44); assert.ok(target.height >= 44); }
  if (!entry && measurement.height === 844) {
    const button = measurement.targets.find((target: any) => target.text === "Play again");
    assert.ok(button && button.y >= 0 && button.bottom <= 844);
  }
  results[name] = measurement;
  await page.screenshot({ path: join(evidence, `${name}.png`) });
}
try {
  const first = performance.now();
  await page.goto("https://swarm.test/");
  await page.locator("#name").fill("Team Robot");
  await measure("entry", true);
  await page.setViewportSize({ width: 844, height: 390 });
  await measure("landscape-entry", true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Join Tabs" }).tap();
  await page.locator("canvas").waitFor(); results.firstEntryMs = Math.round(performance.now() - first);
  await page.waitForTimeout(1200); await sessionAction("end");
  await page.getByText("Score saved", { exact: true }).waitFor();
  await page.waitForFunction(() => /Tabs\s+[1-9]/.test(document.querySelector(".team-labels")?.textContent ?? ""));
  await measure("real-finish");
  const hideAt = performance.now();
  const hide = Bun.spawnSync([process.execPath, "run", "hide", "Team Robot"], { env, stdout: "pipe", stderr: "pipe" });
  assert.equal(hide.exitCode, 0, hide.stderr.toString());
  await page.getByText("No team scores yet", { exact: true }).waitFor({ timeout: 5000 });
  results.hideVisibleMs = Math.round(performance.now() - hideAt);
  assert.ok(Number(results.hideVisibleMs) < 5000);
  await measure("hidden-zero");
  const before = starts;
  await page.getByRole("button", { name: "Play again" }).tap();
  await page.waitForTimeout(100); assert.equal(starts, before + 1);
  mode = "loading"; await sessionAction("all-upgrades");
  await page.getByText("Loading team totals…", { exact: true }).waitFor();
  await measure("loading-upgrades");
  mode = "populated"; held.splice(0).forEach(resolve => resolve());
  await page.waitForFunction(() => document.querySelector(".team-labels")?.textContent?.includes("456"));
  await measure("populated-upgrades");
  mode = "error";
  await page.getByRole("button", { name: "Play again" }).tap();
  await sessionAction("all-upgrades");
  await page.getByText("Couldn't load team totals", { exact: true }).waitFor();
  await measure("failed-upgrades");
  await page.setViewportSize({ width: 844, height: 390 });
  await measure("landscape-failed");
  await page.getByRole("button", { name: "Play again" }).tap();
  await page.locator(".over").waitFor({ state: "detached" });
  await page.setViewportSize({ width: 390, height: 844 });
  // Legacy entry preserves the exact id and fixed name, selecting Spaces once.
  const legacyId = crypto.randomUUID();
  await page.evaluate((id: string) => localStorage.setItem("bug-swarm-player", JSON.stringify({ playerId: id, name: "Legacy Robot" })), legacyId);
  await page.reload(); await measure("legacy-entry", true);
  assert.equal(await page.locator("#name").inputValue(), "Legacy Robot");
  await page.getByRole("button", { name: "Join Spaces" }).tap();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("bug-swarm-player")!).playerId), legacyId);
  const returning = performance.now(); await page.reload(); await page.getByRole("button", { name: "Play", exact: true }).click(); await page.locator(".game canvas").waitFor();
  results.returnEntryMs = Math.round(performance.now() - returning);
  assert.equal(await page.locator("#name").count(), 0);
  // Every API request fails, but a fresh identity still starts and moves locally.
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.locator("#name").fill("Offline Robot");
  await context.route("**/api/**", (route: any) => route.abort());
  const offline = performance.now(); await page.getByRole("button", { name: "Join Spaces" }).tap();
  await page.locator("canvas").waitFor(); results.offlineEntryMs = Math.round(performance.now() - offline);
  await page.waitForTimeout(200); assert.equal(await page.locator("canvas").count(), 1);
  assert.equal(pageErrors.length, 0, "No uncaught browser errors");
  await Bun.write(join(evidence, "measurements.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
} finally {
  held.splice(0).forEach(resolve => resolve());
  await browser.close(); db.close();
}
