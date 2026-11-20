// Manual production-browser evidence; see landscape-validation.md for reproduction.
// All HTTP is intercepted. No listener or operator database is used.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "../src/server/db";
import { createApp } from "../src/server/app";
import { UPGRADE_IDS, UPGRADE_NAMES } from "../src/shared/upgrades";

const scratch = process.env.SCRATCH;
assert.ok(scratch, "Set SCRATCH to a fresh directory with playwright-core installed");
const home = join(scratch, "home"), data = mkdtempSync(join(scratch, "data-"));
mkdirSync(home, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
  XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, DATA_DIR: data };
const { chromium } = await import(pathToFileURL(join(scratch, "node_modules/playwright-core/index.mjs")).href);
const db = openDb(join(data, "app.db")), app = createApp(db);
const evidence = resolve(process.env.EVIDENCE ?? "docs/landscape-evidence");
mkdirSync(evidence, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }), headless: true, env });
const results: any = { chrome: browser.version(), cases: [], smoke: {} };
const errors: Error[] = [];
type Insets = { top: number; right: number; bottom: number; left: number };
const none: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const leaders = Array.from({ length: 10 }, (_, i) => ({ playerId: String(i), name: "WWWWWWWWWWWWWW" + String(i).padStart(2, "0"), score: 12345 - i }));

// Reach the real Session via React's host fiber, as in team-validation.probe.ts.
// Fixture mutation stays in this developer script; production has no test hooks.
async function action(page: any, operation: string) {
  return page.evaluate((operation: string) => {
    const element = document.querySelector(".game") as any;
    let session: any;
    for (let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))!]; fiber; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        if (hook.memoizedState?.identity && typeof hook.memoizedState.end === "function") session = hook.memoizedState;
      }
    }
    if (!session) throw new Error("Session not found");
    const s = session.current.simulation;
    if (operation === "start") { session.start(); return; }
    if (operation === "read") return { robot: { ...s.robot }, arena: s.arena, token: session.view.token, choice: session.view.choice };
    if (operation === "choice") {
      s.upgrades.offer = ["review-laser", "test-shield", "refactor-bomb"];
      s.upgrades.choiceNumber++; session.publishChoice(); return;
    }
    if (operation === "fixture-end") {
      s.score = 12345;
      Object.keys(s.upgrades.counts).forEach((id, index) => { s.upgrades.counts[id] = index + 1; });
    }
    // The real smoke ends an unmodified simulation. Layout fixtures have zero
    // seconds so Session need not wait for a synthetic gameplay duration.
    s.dead = true; session.end();
  }, operation);
}

async function setup(width: number, height: number, touch: boolean, insets = none, real = false) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  let mode = "populated", starts = 0;
  const held: (() => void)[] = [];
  await context.addInitScript(() => localStorage.setItem("bug-swarm-player", JSON.stringify({ playerId: crypto.randomUUID(), name: "Layout Robot", team: "tabs" })));
  await context.route("**/*", async (route: any) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) {
      if (path === "/api/runs") starts++;
      if (real) {
        const response = await app.request(path, { method: request.method(), headers: request.headers(), body: request.postData() ?? undefined });
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      if (mode === "loading" && path !== "/api/runs") await new Promise<void>(resolve => held.push(resolve));
      if (mode === "failed" && path !== "/api/runs") return route.fulfill({ status: 503, body: "unavailable" });
      if (mode === "rate-limited" && path === "/api/runs") return route.fulfill({ status: 429, body: "too many runs" });
      const json = path === "/api/runs" ? { runId: "fixture" } : path.endsWith("/finish") ? { saved: true }
        : path.endsWith("/best") ? { best: mode === "empty" ? null : 23456 }
        : path === "/api/teams" ? ["zero", "empty"].includes(mode) ? { tabs: 0, spaces: 0 } : { tabs: 123456, spaces: 234567 }
        : mode === "empty" ? [] : leaders;
      return route.fulfill({ json });
    }
    if (path.startsWith("/favicon")) return route.fulfill({ status: 204, body: "" });
    const file = path === "/" ? "index.html" : path.slice(1);
    assert.ok(file === "index.html" || readdirSync("dist/assets").some(name => file === `assets/${name}`));
    return route.fulfill({ body: readFileSync(join("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
  });
  const page = await context.newPage();
  page.on("pageerror", (error: Error) => errors.push(error));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
  await page.goto("https://swarm.test/");
  await page.locator(".game[data-phase=playing]").waitFor();
  return { page, context, cdp, starts: () => starts, mode: (next: string) => { mode = next; },
    close: async () => { held.splice(0).forEach(resolve => resolve()); await context.close(); } };
}

async function measure(page: any, name: string, touch: boolean, insets = none, screenshot = true) {
  // No locator actions that could scroll before measurement and screenshot.
  const m = await page.evaluate(() => {
    const rect = (element: Element) => ({ text: element.textContent, ...element.getBoundingClientRect().toJSON(), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight });
    const one = (selector: string) => { const e = document.querySelector(selector); return e ? rect(e) : null; };
    return { width: innerWidth, height: innerHeight, phase: document.querySelector(".game")?.getAttribute("data-phase"),
      document: rect(document.documentElement), hud: one(".hud"), footer: one("footer"), canvas: one("canvas"), over: one(".over"),
      summary: one(".over-summary"), board: one(".over-board"), dialog: one(".choices"),
      content: [...document.querySelectorAll(".over h1, .over h2, .over p, .over button, .team-labels, .race-bar, .over li, .leader-row span, .leader-row strong, .choices h1, .choices p, .choices button")].map(rect),
      hudParts: [...document.querySelectorAll(".hud > *")].map(rect),
      buttons: [...document.querySelectorAll("button")].map(rect),
      safe: ["top", "right", "bottom", "left"].map(side => parseFloat(getComputedStyle(document.querySelector(".game")!).getPropertyValue(`padding-${side}`))) };
  });
  if (screenshot) await page.screenshot({ path: join(evidence, `${name}.png`) });
  results.cases.push({ name, touch, insets, ...m });
  const fits = (r: any) => {
    assert.ok(r.left >= insets.left - 1 && r.right <= m.width - insets.right + 1 && r.top >= insets.top - 1 && r.bottom <= m.height - insets.bottom + 1, `${name}: outside safe bounds: ${JSON.stringify(r)}`);
  };
  assert.deepEqual(m.safe, [insets.top, insets.right, insets.bottom, insets.left], `${name}: real env() insets applied`);
  assert.ok(m.document.scrollWidth <= m.width + 1 && m.document.scrollHeight <= m.height + 1, `${name}: document overflow`);
  for (const button of m.buttons) { assert.ok(button.width >= 44 && button.height >= 44, `${name}: minimum target`); fits(button); }
  const short = m.height <= 500 && m.width >= 600;
  if (m.phase === "over") {
    assert.equal(await page.locator(".over").evaluate((el: HTMLElement) => el.scrollTop), 0, "Initial results must not auto-scroll");
    if (short) {
      for (const panel of [m.over, m.summary, m.board]) {
        fits(panel); assert.ok(panel.scrollHeight <= panel.clientHeight + 1 && panel.scrollWidth <= panel.clientWidth + 1, `${name}: panel overflow`);
      }
      assert.ok(m.summary.right < m.board.left, `${name}: two columns`);
      assert.equal(m.hud.height, 0); assert.equal(m.footer.height, 0);
      for (const item of m.content) { fits(item); assert.ok(item.scrollWidth <= item.clientWidth + 1, `${name}: clipped text`); }
      const rows = await page.locator(".over li").count();
      if (rows) {
        assert.equal(rows, 10);
        assert.deepEqual(await page.locator(".leader-row span").allTextContents(), leaders.map(row => row.name));
        assert.deepEqual(await page.locator(".leader-row strong").allTextContents(), leaders.map(row => String(row.score)));
        for (const id of UPGRADE_IDS) assert.ok(m.board.text.includes(UPGRADE_NAMES[id]));
      }
    }
  } else {
    fits(m.hud); fits(m.canvas);
    assert.equal(m.footer.height === 0, touch, `${name}: footer follows primary pointer`);
    if (short) {
      assert.ok(m.hud.height <= 32, `${name}: compact HUD`);
      assert.equal(new Set(m.hudParts.map((r: any) => r.top)).size, 1, `${name}: one HUD line`);
      const oldHeight = m.height === 390 ? 306 : 276;
      if (touch && !insets.bottom && !insets.top) assert.ok(m.canvas.height > oldHeight, `${name}: more arena height`);
    }
    if (m.phase === "choice") { fits(m.dialog); for (const item of m.content) fits(item); }
  }
  return m;
}

async function finish(fixture: any, state: string) {
  fixture.mode(state); await action(fixture.page, "start");
  await fixture.page.waitForTimeout(40); // allow start registration before ending
  await action(fixture.page, "fixture-end");
  const text = state === "loading" ? "Saving score…" : state === "failed" ? "couldn't save your score"
    : state === "rate-limited" ? "Too many runs right now. Your next run will save." : "Score saved";
  await fixture.page.getByText(text, { exact: true }).waitFor();
  if (state !== "loading") await fixture.page.waitForFunction(() => !document.querySelector(".over")?.textContent?.includes("Loading…"));
}

try {
  for (const [width, height] of [[844, 390], [740, 360], [390, 844], [360, 640], [1280, 720]]) {
    const touch = width < 1000, fixture = await setup(width!, height!, touch);
    try {
      await measure(fixture.page, `${width}x${height}-playing`, touch);
      await action(fixture.page, "choice");
      await fixture.page.locator("dialog[open]").waitFor();
      await measure(fixture.page, `${width}x${height}-choice`, touch, none, width === 740);
      assert.equal(await fixture.page.evaluate(() => document.activeElement?.tagName), "BUTTON");
      const focusedCard = () => fixture.page.evaluate(() => [...document.querySelectorAll(".choices button")].indexOf(document.activeElement!));
      for (const expected of [1, 2, 0]) { await fixture.page.keyboard.press("Tab"); assert.equal(await focusedCard(), expected); }
      await fixture.page.keyboard.press("Shift+Tab"); assert.equal(await focusedCard(), 2);
      await fixture.page.keyboard.press("1");
      await fixture.page.locator("dialog").waitFor({ state: "detached" });
      assert.equal(await fixture.page.evaluate(() => document.activeElement?.tagName), "CANVAS");
      await finish(fixture, "populated");
      await measure(fixture.page, `${width}x${height}-over`, touch);
      if (height! <= 500) for (const state of ["zero", "empty", "loading", "failed", "rate-limited"]) {
        await finish(fixture, state);
        await measure(fixture.page, `${width}x${height}-${state}`, touch, none, width === 740);
      }
    } finally { await fixture.close(); }
  }
  // Desktop retains controls and expanded F output at both short sizes.
  for (const [width, height] of [[844, 390], [740, 360]]) {
    const f = await setup(width!, height!, false);
    try {
      await f.page.keyboard.press("f");
      await f.page.waitForFunction(() => document.querySelector("footer")?.textContent?.includes("FPS"));
      const m = await measure(f.page, `${width}x${height}-desktop`, false);
      assert.ok(m.footer.text.includes("FPS"));
      await action(f.page, "choice"); await f.page.locator("dialog[open]").waitFor();
      await measure(f.page, `${width}x${height}-desktop-choice`, false, none, false);
      await f.page.keyboard.press("1");
      await finish(f, "populated");
      await measure(f.page, `${width}x${height}-desktop-over`, false, none, false);
    } finally { await f.close(); }
  }
  for (const [width, height, insets] of [
    [844, 390, { top: 0, right: 44, bottom: 21, left: 44 }],
    [740, 360, { top: 0, right: 44, bottom: 21, left: 44 }],
    [844, 390, { top: 0, right: 12, bottom: 21, left: 44 }],
    [390, 844, { top: 44, right: 0, bottom: 34, left: 0 }],
    [360, 640, { top: 44, right: 0, bottom: 34, left: 0 }],
  ] as const) {
    const f = await setup(width, height, true, insets), prefix = `${width}x${height}-safe-${insets.right}`;
    try {
      await measure(f.page, `${prefix}-playing`, true, insets, false);
      await action(f.page, "choice"); await f.page.locator("dialog[open]").waitFor();
      await measure(f.page, `${prefix}-choice`, true, insets);
      await f.page.keyboard.press("1");
      await finish(f, "zero");
      await measure(f.page, `${prefix}-over`, true, insets);
    } finally { await f.close(); }
  }
  // Rotation during play and modal choice, real touch steering, single replay.
  const f = await setup(390, 844, true, none, true);
  try {
    const initial = await action(f.page, "read");
    await f.page.setViewportSize({ width: 844, height: 390 });
    await measure(f.page, "rotation-playing", true, none, false);
    const touch = (type: string, points: any[]) => f.cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
    await touch("touchStart", [{ x: 400, y: 180 }]);
    await touch("touchMove", [{ x: 470, y: 180 }]);
    await f.page.waitForTimeout(180);
    await touch("touchEnd", []);
    assert.ok((await action(f.page, "read")).robot.x > initial.robot.x + 5, "Touch steering survives rotation");
    await action(f.page, "choice"); await f.page.locator("dialog[open]").waitFor();
    const choice = (await action(f.page, "read")).choice;
    await f.page.setViewportSize({ width: 390, height: 844 });
    await measure(f.page, "rotation-choice-portrait", true, none, false);
    await f.page.setViewportSize({ width: 844, height: 390 });
    await measure(f.page, "rotation-choice-landscape", true, none, false);
    assert.deepEqual((await action(f.page, "read")).choice, choice, "Rotation preserves choice");
    await f.page.getByRole("button").first().tap();
    // Start a fresh, unmodified run for real score acceptance after modal fixtures.
    await action(f.page, "start");
    await f.page.waitForTimeout(1100);
    await action(f.page, "end");
    await f.page.getByText("Score saved", { exact: true }).waitFor({ timeout: 5000 });
    const before = f.starts();
    await f.page.getByRole("button", { name: "Play again" }).tap();
    await f.page.locator(".game[data-phase=playing]").waitFor();
    await f.page.waitForTimeout(100);
    assert.equal(f.starts(), before + 1, "One tap means one start");
    const replay = await action(f.page, "read");
    assert.deepEqual(replay.arena, { width: 800, height: 450 });
    results.smoke = { realSave: true, steeringAfterRotation: true, choiceSurvivesRotation: true, startsPerReplay: f.starts() - before, replayArena: replay.arena };
  } finally { await f.close(); }
  assert.equal(errors.length, 0, "No uncaught browser errors");
  results.uncaughtErrors = errors.length;
  await Bun.write(join(evidence, "measurements.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(`Chrome ${results.chrome}: ${results.cases.length} layout cases passed; real save, rotation, steering and single replay passed.`);
} finally { await browser.close(); db.close(); }
