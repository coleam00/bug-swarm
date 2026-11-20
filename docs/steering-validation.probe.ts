// Developer-only Chrome evidence. Build first; install playwright-core in SCRATCH.
// All HTTP is intercepted; no server or database is opened.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FIRST_SPAWN_DELAY } from "../src/web/game/config";

const scratch = process.env.SCRATCH!;
assert.ok(scratch, "Set SCRATCH to an isolated home containing playwright-core");
const evidence = resolve("docs/steering-evidence"); mkdirSync(evidence, { recursive: true });
const { chromium } = await import(pathToFileURL(join(scratch, "node_modules/playwright-core/index.mjs")).href);
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  env: { ...process.env, HOME: join(scratch, "home"), USERPROFILE: join(scratch, "home") } });
const assertions: string[] = [], errors: string[] = [];
const report: Record<string, unknown> = { chrome: browser.version(), at: new Date().toISOString(), assertions };
const identity = { playerId: crypto.randomUUID(), name: "Hint Robot", team: "tabs" };
try {
  if (process.argv.includes("--performance")) {
    const bundle = await Bun.build({ entrypoints: ["docs/steering-benchmark.ts"], target: "browser" });
    assert.ok(bundle.success); const source = await bundle.outputs[0]!.text();
    const measurements = [];
    for (const size of [{ width: 1280, height: 720 }]) {
      const context = await browser.newContext({ viewport: size, deviceScaleFactor: size.width === 1280 ? 1 : 2 });
      await context.route("**/*", (route: any) => route.fulfill({ contentType: "text/html", body:
        `<style>body{margin:0;background:#0b1018}canvas{width:100vw;height:100dvh}</style><canvas></canvas><script type="module">${source}</script>` }));
      const page = await context.newPage(); page.on("pageerror", (error: Error) => { errors.push(error.message); console.error(error); });
      await page.goto("http://localhost/");
      await page.waitForTimeout(5000);
      console.log(await page.evaluate(() => (window as any).steeringProgress));
      assert.deepEqual(errors, []);
      // Timer polling must not enter the fixture's wrapped game animation frame.
      await page.waitForFunction(() => (window as any).steeringBenchmark?.done, undefined, { timeout: 180_000, polling: 100 });
      const result = await page.evaluate(() => (window as any).steeringBenchmark);
      measurements.push({ size, ...result });
      for (const phase of result.phases) {
        assert.ok(phase.fps >= 58, JSON.stringify(phase));
        assert.equal(phase.minBugs, 150); assert.equal(phase.maxBugs, 150);
      }
      assert.ok(result.pendingChecks > 3000); assert.equal(result.dismissedChecks, 1);
      await context.close();
    }
    report.measurements = measurements;
    assertions.push("Actual mountGame path at 1280x720: 150 mixed bugs, 60s watching and 60s dismissed, >=58 FPS");
  } else {
    const layouts = [];
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 720 }]) {
      const touch = size.width !== 1280;
      const context = await browser.newContext({ viewport: size, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
      let offline = false;
      await context.route("**/*", (route: any) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith("/api/")) {
          if (offline) return route.abort();
          return route.fulfill({ json: path === "/api/runs" ? { runId: crypto.randomUUID() } : path.endsWith("/finish") ? { saved: true } :
            path === "/api/teams" ? { tabs: 0, spaces: 0 } : path.endsWith("/best") ? { best: null } :
            path.endsWith("/standing") ? { rank: null, total: 0, next: null } : [] });
        }
        if (["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/og-image.png"].includes(path)) return route.fulfill({ status: 204 });
        const file = path === "/" || path === "/board" ? "index.html" : path.slice(1);
        assert.ok(file === "index.html" || /^assets\/[\w.-]+$/.test(file));
        return route.fulfill({ body: readFileSync(join("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
      });
      const page = await context.newPage(); page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.addInitScript(() => {
        // Keep the browser's run reproducible; identity still uses randomUUID.
        crypto.getRandomValues = ((values: Uint32Array) => { values[0] = 1; return values; }) as typeof crypto.getRandomValues;
      });
      const discover = () => page.evaluate(() => {
        const element = document.querySelector(".game") as any;
        let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))!];
        for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          if (hook.memoizedState?.identity && typeof hook.memoizedState.start === "function") (window as any).hintSession = hook.memoizedState;
        }
        const s = (window as any).hintSession.current.simulation; s.invulnerableUntil = Infinity;
      });
      const hint = page.locator(".steering-hint");
      const snapshot = () => page.evaluate(() => ({ ...(window as any).hintSession.current.simulation.robot }));
      const restart = async () => {
        await page.evaluate(() => (window as any).hintSession.end());
        await page.getByRole("button", { name: "Play again" }).click();
        assert.equal(await hint.count(), 0);
      };
      await page.goto("http://localhost/board");
      assert.equal(await page.evaluate(() => localStorage.getItem("bug-swarm-steering-hint-seen")), null);
      await page.goto("http://localhost/"); await page.locator("#name").fill("Hint Robot");
      await page.getByRole("button", { name: "Join Tabs" }).click(); await discover();
      assert.ok((await hint.textContent())?.trim());
      const layout = await hint.evaluate((element: HTMLElement) => {
        const r = element.getBoundingClientRect(), surface = element.parentElement!, arena = surface.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, arena: { x: arena.x, y: arena.y, width: arena.width, height: arena.height },
          font: getComputedStyle(element).fontSize, pointerEvents: getComputedStyle(element).pointerEvents,
          overflow: document.documentElement.scrollWidth > innerWidth, role: element.getAttribute("role"), tabIndex: element.tabIndex };
      });
      assert.equal(layout.pointerEvents, "none"); assert.equal(layout.overflow, false); assert.equal(layout.role, "status"); assert.equal(layout.tabIndex, -1);
      assert.ok(layout.x >= 0 && layout.x + layout.width <= size.width && layout.y >= layout.arena.y);
      assert.ok(layout.y + layout.height < layout.arena.y + layout.arena.height / 2);
      layouts.push({ size, ...layout });
      await page.screenshot({ path: join(evidence, `hint-${size.width}.png`) });
      const robot = await snapshot();
      if (touch) {
        const cdp = await context.newCDPSession(page), x = size.width / 2, y = layout.y + layout.height / 2;
        const dispatch = (type: string, dx = 0) => cdp.send("Input.dispatchTouchEvent", { type,
          touchPoints: type === "touchEnd" ? [] : [{ x: x + dx, y, id: 1, radiusX: 4, radiusY: 4 }] });
        await dispatch("touchStart"); assert.equal(await hint.count(), 1);
        await dispatch("touchMove", 3); assert.equal(await hint.count(), 1);
        await dispatch("touchMove", 70); await hint.waitFor({ state: "detached" }); await dispatch("touchEnd");
      } else {
        await page.keyboard.press("q"); assert.equal(await hint.count(), 1);
        await page.keyboard.down("d"); await hint.waitFor({ state: "detached" }); await page.keyboard.up("d");
      }
      assert.notDeepEqual(await snapshot(), robot);
      await restart(); await page.reload(); await page.locator("canvas").waitFor(); assert.equal(await hint.count(), 0);
      // Existing identity without a flag, with API unavailable: untouched deadline.
      offline = true;
      await page.evaluate(identity => { localStorage.setItem("bug-swarm-player", JSON.stringify(identity)); localStorage.removeItem("bug-swarm-steering-hint-seen"); }, identity);
      await page.reload(); await hint.waitFor(); await discover();
      await page.waitForTimeout(3500); assert.equal(await hint.count(), 1);
      await hint.waitFor({ state: "detached", timeout: 1200 });
      assert.ok(await page.evaluate(() => (window as any).hintSession.current.simulation.time) > 3);
      await restart();
      if (!touch) {
        // A real, unprotected idle run with no input and no upgrade auto-pick.
        const quiet = await snapshot();
        await page.waitForFunction(at => (window as any).hintSession.current.simulation.time >= at,
          FIRST_SPAWN_DELAY - 0.2, { timeout: 15000 });
        assert.equal(await page.evaluate(() => (window as any).hintSession.current.simulation.nextId), 1);
        await page.waitForFunction(() => (window as any).hintSession.view.over, undefined, { timeout: 45000 });
        const run = await page.evaluate(() => {
          const s = (window as any).hintSession.current.simulation;
          return { elapsed: s.time, dead: s.dead, robot: { ...s.robot }, hits: s.hits };
        });
        assert.ok(run.dead && run.elapsed >= 18 - 1e-7 && run.elapsed <= 40 + 1e-7);
        assert.deepEqual(run.robot, quiet); assert.equal(run.hits, 3);
        report.openingIdle = run;
        assertions.push("Desktop seed 1: quiet first-spawn delay and actual idle death inside 18–40 gameplay seconds");
      }
      // A blocked storage getter still permits play and one hint for this page.
      await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw Error("blocked storage"); } }); });
      await page.reload(); await page.locator("#name").fill("Blocked Robot");
      await page.getByRole("button", { name: "Join Tabs" }).click(); await hint.waitFor(); await discover();
      await page.keyboard.down("ArrowRight"); await hint.waitFor({ state: "detached" }); await page.keyboard.up("ArrowRight");
      await restart();
      assertions.push(`${size.width}x${size.height}: board/entry eligibility, exact text, arena layout, input pass-through, movement, 4s expiry, restart/reload, existing identity, blocked storage and offline play`);
      await context.close();
    }
    report.layouts = layouts;
  }
  assert.deepEqual(errors, []); report.errors = errors;
  writeFileSync(join(evidence, process.argv.includes("--performance") ? "performance.json" : "browser.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
