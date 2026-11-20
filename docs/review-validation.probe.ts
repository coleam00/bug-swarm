// Developer-only evidence: production bundle + real in-process API/SQLite + owner CLIs.
// Install playwright-core under SCRATCH, build the app, then run with bun.
// Browser routes dispatch to createApp.request; no network server or operator data.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createApp } from "../src/server/app";
import { getRun, openDb } from "../src/server/db";

const scratch = process.env.SCRATCH!;
assert.ok(scratch, "Set SCRATCH to an isolated directory containing playwright-core");
const home = join(scratch, "browser-home"), evidence = resolve("docs/review-evidence");
mkdirSync(home, { recursive: true }); mkdirSync(evidence, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home };
const { chromium } = await import(pathToFileURL(join(scratch, "node_modules/playwright-core/index.mjs")).href);
const persistent = await chromium.launchPersistentContext(join(scratch, `chrome-profile-${crypto.randomUUID()}`), { headless: true,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }), env });
const browser = persistent.browser()!;
const errors: string[] = [], measurements: unknown[] = [];
try {
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const data = join(scratch, `review-${size.width}-${crypto.randomUUID()}`);
    mkdirSync(data, { recursive: true });
    const db = openDb(join(data, "app.db"));
    let time = 0;
    const epoch = Date.now();
    const app = createApp(db, { now: () => time + Date.now() - epoch });
    const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const finishes: unknown[] = [];
    try {
      // Ten ordinary competitors, using real HTTP handlers and server validation.
      for (let i = 0; i < 10; i++) {
        time = 0;
        const playerId = crypto.randomUUID();
        const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const started = await app.request("/api/runs", post({ playerId, name: `Robot ${i}`, team: "tabs" }));
        assert.equal(started.status, 201);
        const { runId } = await started.json() as { runId: string }; time = 100000;
        const finished = await app.request(`/api/runs/${runId}/finish`, post({ playerId, score: 100 - i, squashes: 0, seconds: 100 - i, touch: false }));
        assert.equal(finished.status, 200);
      }
      time = 0;
      await context.route("**/*", async (route: any) => {
        const req = route.request(), path = new URL(req.url()).pathname;
        if (path.startsWith("/api/")) {
          const response = await app.request(path, { method: req.method(), headers: req.headers(), body: req.postDataBuffer() ?? undefined });
          const body = await response.text();
          if (path.endsWith("/finish")) finishes.push({ status: response.status, body: JSON.parse(body) });
          return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body });
        }
        if (["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/og-image.png"].includes(path)) return route.fulfill({ status: 204 });
        const file = path === "/" || path === "/board" ? "index.html" : path.slice(1);
        assert.ok(file === "index.html" || /^assets\/[\w.-]+$/.test(file));
        return route.fulfill({ body: readFileSync(join("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
      });
      const page = await context.newPage(), board = await context.newPage();
      for (const p of [page, board]) p.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto("http://localhost/"); await page.locator("#name").fill("Review Robot");
      await page.getByRole("button", { name: "Join Spaces" }).click();
      await page.evaluate(() => {
        const element = document.querySelector(".game") as any;
        let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))!];
        for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const session = hook.memoizedState;
          if (session?.identity && typeof session.start === "function") { (window as any).reviewSession = session; return; }
        }
        throw new Error("Session not found");
      });
      await page.waitForFunction(() => (window as any).reviewSession.current.runId);
      time = 300000;
      const runId = await page.evaluate(() => {
        const session = (window as any).reviewSession, run = session.current;
        // Synthetic forgery fixture, explicitly not a measured gameplay result.
        run.registeredAt = performance.now() - 300000;
        Object.assign(run.simulation, { dead: true, score: 7000, seconds: 300, squashes: 670 });
        session.end(); return run.runId;
      });
      await page.getByText("Under review", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Play again" }).waitFor({ state: "visible" });
      assert.equal(await page.locator(".final-score").textContent(), "Score 7,000");
      await page.getByText("Best: 7,000", { exact: true }).waitFor();
      await board.goto("http://localhost/board");
      await board.locator(".board-leaders li").nth(9).waitFor();
      assert.equal(await page.locator(".over ol li").count(), 10);
      assert.ok(!(await board.locator(".board-leaders").textContent()).includes("Review Robot"));
      assert.ok(!(await page.locator(".over ol").textContent()).includes("Review Robot"));
      assert.equal(getRun(db, runId)?.held, 1);
      await page.getByText("Not ranked", { exact: true }).waitFor();
      assert.equal(await page.locator('.team-labels').getByText("0", { exact: true }).count(), 1);
      const command = (script: string, args: string[] = []) => {
        const child = Bun.spawnSync([process.execPath, `scripts/${script}.ts`, ...args], { env: { ...env, DATA_DIR: data }, stdout: "pipe", stderr: "pipe" });
        assert.equal(child.exitCode, 0, child.stderr.toString()); return child.stdout.toString().trim();
      };
      const review = command("review"); assert.ok(review.includes(runId));
      assert.ok(review.includes('"Review Robot"\t7000\t300\t670'));
      const layout = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth,
        status: [...document.querySelectorAll('[role="status"]')].map(el => el.textContent) }));
      assert.equal(layout.body, size.width);
      await page.screenshot({ path: join(evidence, `held-${size.width}.png`) });
      // Both boards have cached the held state. Keep the production one-second TTL.
      const began = performance.now(), approval = command("approve", [runId]);
      await Promise.all([page.locator(".over ol li").filter({ hasText: "Review Robot" }).waitFor(),
        board.locator(".board-leaders li").filter({ hasText: "Review Robot" }).waitFor()]);
      await Promise.all([page.locator(".team-labels").getByText("7,000", { exact: true }).waitFor(),
        board.locator('.board-team strong[aria-label="7,000 points"]').waitFor()]);
      await page.getByText("Your best is #1 of 11", { exact: true }).waitFor();
      const releaseMs = performance.now() - began; assert.ok(releaseMs <= 5000, `Release took ${releaseMs} ms`);
      assert.equal(getRun(db, runId)?.held, 0);
      assert.ok((await page.locator(".over ol li").first().textContent()).includes("Review Robot"));
      assert.equal(await page.getByText("Under review", { exact: true }).count(), 1);
      assert.deepEqual(await board.locator(".board-rank").allTextContents(), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
      await board.screenshot({ path: join(evidence, `approved-board-${size.width}.png`) });
      await page.screenshot({ path: join(evidence, `approved-game-${size.width}.png`) });
      const standing = await page.locator(".personal-standing").textContent();
      const replay = await page.getByRole("button", { name: "Play again" }).boundingBox();
      assert.ok(replay && replay.width >= 44 && replay.height >= 44);
      assert.equal(await page.evaluate(() => document.body.scrollWidth), size.width);
      await page.getByRole("button", { name: "Play again" }).click();
      await page.waitForFunction(() => !(window as any).reviewSession.view.over);
      assert.equal(await page.locator(".over").count(), 0);
      measurements.push({ standing, replay, replayStarted: true, size, fixture: "synthetic 7,000 points / 300 seconds / 670 squashes", finishes, review, approval, releaseMs, layout });
    } finally { await context.close(); db.close(); }
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(evidence, "browser.json"), JSON.stringify({ chrome: browser.version(), measuredAt: new Date().toISOString(), measurements, errors }, null, 2) + "\n");
} finally { await browser.close(); }
