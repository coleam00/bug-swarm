// Developer-only Chrome evidence. Requires a build and playwright-core installed in SCRATCH.
// HTTP is intercepted in process: no server, real API, database or existing browser profile.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scratch = process.env.SCRATCH!;
assert.ok(scratch, "Set SCRATCH to a fresh directory containing playwright-core");
const home = join(scratch, "home"), evidence = resolve("docs/touch-evidence");
mkdirSync(home, { recursive: true }); mkdirSync(evidence, { recursive: true });
const { chromium } = await import(pathToFileURL(join(scratch, "node_modules/playwright-core/index.mjs")).href);
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, DATA_DIR: join(scratch, "data") },
});
const errors: string[] = [];
const results: Record<string, unknown> = { chrome: browser.version(), measuredAt: new Date().toISOString(), assertions: [] };
const record = (text: string) => (results.assertions as string[]).push(text);
const performanceOnly = process.argv.includes("--performance");
try {
  if (performanceOnly) {
    // Compile exactly the developer fixture, separate from production entry points.
    const bundle = await Bun.build({ entrypoints: ["scripts/look-benchmark.ts"], target: "browser" });
    assert.ok(bundle.success); const source = await bundle.outputs[0]!.text();
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await context.route("**/*", (route: any) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ body: path.endsWith(".ts") ? source : readFileSync("scripts/look-benchmark.html"),
        contentType: path.endsWith(".ts") ? "text/javascript" : "text/html" });
    });
    for (const joystick of [false, true]) {
      const page = await context.newPage(); page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(`http://localhost/scripts/look-benchmark.html?profile=stress${joystick ? "&joystick" : ""}`);
      await page.waitForFunction(() => (window as any).lookBenchmark?.result, null, { timeout: 90000 });
      const report = await page.evaluate(() => (window as any).lookBenchmark.result);
      assert.equal(report.joystick, joystick); assert.equal(report.minBugs, 150); assert.equal(report.maxBugs, 150);
      results[joystick ? "on" : "off"] = report;
      await page.screenshot({ path: join(evidence, `stress-${joystick ? "on" : "off"}.png`) });
      await page.evaluate(() => (window as any).lookBenchmark.dispose()); await page.close();
      console.log(`${joystick ? "on" : "off"}: ${JSON.stringify(report)}`);
    }
    await context.close();
  } else {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const serveProduction = (route: any) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/")) return route.fulfill({ json: path === "/api/runs" ? { runId: crypto.randomUUID() } :
        path.endsWith("/finish") ? { saved: true } : path === "/api/teams" ? { tabs: 0, spaces: 0 } : path.endsWith("/best") ? { best: null } : [] });
      const file = path === "/" ? "index.html" : path.slice(1);
      assert.ok(file === "index.html" || /^assets\/[\w.-]+$/.test(file));
      return route.fulfill({ body: readFileSync(join("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
    };
    await context.route("**/*", serveProduction);
    let page = await context.newPage(); page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.addInitScript(() => {
      (window as any).touchEvents = [];
      for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture"]) document.addEventListener(type, (event: Event) => {
        const e = event as PointerEvent;
        (window as any).touchEvents.push({ type, id: e.pointerId, pointerType: e.pointerType, x: e.clientX, y: e.clientY });
      });
    });
    const cdp = await context.newCDPSession(page);
    const frames = () => page.evaluate(() => new Promise<void>(resolve => {
      let remaining = 8; const tick = () => --remaining ? requestAnimationFrame(tick) : resolve(); requestAnimationFrame(tick);
    }));
    const touch = (type: string, points: { id: number; x: number; y: number }[]) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: points.map(p => ({ ...p, radiusX: 8, radiusY: 8, force: 1 })),
    });
    const read = () => page.evaluate(() => {
      const s = (window as any).touchSession.current.simulation;
      return { ...s.robot, time: s.time, arena: s.arena, token: (window as any).touchSession.view.token };
    });
    const findSession = () => page.evaluate(() => {
      const element = document.querySelector(".game") as any;
      let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))!];
      for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const session = hook.memoizedState;
        if (session?.identity && typeof session.start === "function") {
          (window as any).touchSession = session;
          const s = session.current.simulation; s.spawnIn = s.fireIn = Infinity; s.invulnerableUntil = Infinity;
          return;
        }
      }
      throw new Error("Session not found");
    });
    const stationary = async () => { const before = await read(); await frames(); const after = await read(); assert.equal(after.x, before.x, JSON.stringify(await page.evaluate(() => (window as any).touchEvents))); assert.equal(after.y, before.y); };
    await page.goto("http://localhost/");
    assert.ok((await page.locator(".entry").innerText()).includes("Drag farther to move faster; lift to stop."));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(evidence, "portrait-hint.png"), fullPage: true });
    await page.setViewportSize({ width: 844, height: 390 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(evidence, "landscape-hint.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#name").fill("Touch Robot"); await page.getByRole("button", { name: "Join Tabs" }).tap();
    await page.locator("canvas").waitFor(); await findSession();
    record("Portrait and landscape entry hints fit; auto-fire and three-hit explanation retained.");
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size); await frames();
      await page.evaluate(() => (window as any).touchSession.start(true)); await frames(); await findSession();
      const box = await page.locator("canvas").boundingBox(); assert.ok(box);
      const owner = { id: 1, x: box.x + 90, y: box.y + box.height * 0.78 };
      const second = { id: 2, x: box.x + 240, y: box.y + box.height * 0.65 };
      await touch("touchStart", [owner]); await stationary();
      await touch("touchMove", [{ ...owner, x: owner.x + 5 }]); await stationary();
      await touch("touchMove", [{ ...owner, x: owner.x + 33 }]);
      const halfStart = await read(); await frames(); const halfEnd = await read();
      assert.ok(Math.abs(halfEnd.x - halfStart.x - 90 * (halfEnd.time - halfStart.time)) < 0.01);
      await touch("touchMove", [{ ...owner, x: owner.x + 60 }]);
      const fullStart = await read(); await frames(); const fullEnd = await read();
      assert.ok(Math.abs(fullEnd.x - fullStart.x - 180 * (fullEnd.time - fullStart.time)) < 0.01);
      await page.evaluate(() => {
        const s = (window as any).touchSession.current.simulation;
        s.bugs = [{ id: -1, kind: "base", x: s.robot.x - 65, y: s.robot.y + 40 },
          { id: -2, kind: "fast", x: s.robot.x + 50, y: s.robot.y - 60 }];
      });
      await page.screenshot({ path: join(evidence, `${size.width === 390 ? "portrait" : "landscape"}-joystick.png`) });
      // Screenshot encoding can span enough frames to reach a wall; recenter the fixture.
      await page.evaluate(() => { const s = (window as any).touchSession.current.simulation; s.robot.x = s.arena.width / 2; s.robot.y = s.arena.height / 2; s.bugs = []; });
      await touch("touchStart", [{ ...owner, x: owner.x + 60 }, second]);
      await touch("touchMove", [{ ...owner, x: owner.x + 60 }, { ...second, x: second.x - 50 }]);
      const otherStart = await read(); await frames(); const otherEnd = await read();
      assert.ok(Math.abs(otherEnd.x - otherStart.x - 180 * (otherEnd.time - otherStart.time)) < 0.01, JSON.stringify({ otherStart, otherEnd })); assert.equal(otherEnd.y, otherStart.y);
      await touch("touchEnd", [{ ...owner, x: owner.x + 60 }]); await stationary();
      await touch("touchMove", [{ ...second, x: second.x + 30 }]); await stationary();
      await touch("touchEnd", []);
      // Capture continues beyond the arena element; the fixed origin is never clamped.
      await touch("touchStart", [owner]); await touch("touchMove", [{ ...owner, x: -20 }]);
      const edgeStart = await read(); await frames(); assert.ok((await read()).x < edgeStart.x);
      await touch("touchMove", [{ ...owner, y: owner.y - 60 }]);
      const upStart = await read(); await frames(); assert.ok((await read()).y < upStart.y);
      await touch("touchEnd", []); await stationary();
      record(`${size.width}x${size.height}/DPR2: stationary touchdown, dead zone, half/full speed, second finger ignored, lift/no takeover, outside capture and direction changes.`);
    }
    const box = await page.locator("canvas").boundingBox(); assert.ok(box);
    const owner = { id: 1, x: box.x + 100, y: box.y + 200 };
    await touch("touchStart", [owner]); await touch("touchMove", [{ ...owner, x: owner.x + 60 }]);
    const arena = (await read()).arena;
    await page.setViewportSize({ width: 390, height: 844 }); await frames(); await stationary();
    assert.deepEqual((await read()).arena, arena); await touch("touchEnd", []);
    record("Rotation cancels active touch while retaining the run arena.");
    await page.evaluate(() => { const s = (window as any).touchSession.current.simulation; s.time = 19.99; });
    await page.locator("dialog").waitFor();
    await page.screenshot({ path: join(evidence, "upgrade.png") });
    await page.locator('dialog button[aria-disabled="false"]').first().waitFor();
    await page.locator("dialog button").first().tap(); await page.locator("dialog").waitFor({ state: "detached" }); await stationary();
    const beforeRestart = await read();
    await page.evaluate(() => { (window as any).touchSession.current.simulation.dead = true; });
    await page.locator(".over").waitFor();
    await page.getByRole("button", { name: "Play again" }).waitFor({ state: "visible" });
    const restartBox = await page.locator("canvas").boundingBox(); assert.ok(restartBox);
    const restartTouch = { id: 1, x: restartBox.x + 60, y: restartBox.y + 60 };
    await touch("touchStart", [restartTouch]); await touch("touchEnd", []); await frames();
    assert.ok((await read()).token > beforeRestart.token); await stationary();
    await touch("touchStart", [restartTouch]); await stationary();
    await touch("touchMove", [{ ...restartTouch, x: restartTouch.x + 60 }]);
    const restarted = await read(); await frames(); assert.ok((await read()).x > restarted.x); await touch("touchEnd", []);
    record("Touch upgrade selection resumes stationary; game-over tap restarts and the next contact moves only on drag.");
    results.pointerEvents = await page.evaluate(() => (window as any).touchEvents);
    await context.close();
    // A separate desktop context has no touch or mobile emulation.
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await desktop.route("**/*", serveProduction);
    page = await desktop.newPage(); page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.goto("http://localhost/"); await page.locator("#name").fill("Desktop Robot");
    await page.getByRole("button", { name: "Join Tabs" }).click(); await page.locator("canvas").waitFor();
    await findSession();
    await page.mouse.move(1200, 300); const mouseStart = await read(); await frames(); assert.ok((await read()).x > mouseStart.x);
    await page.keyboard.down("a"); const keyStart = await read(); await frames(); assert.ok((await read()).x < keyStart.x); await page.keyboard.up("a");
    await page.keyboard.down("ArrowDown"); await page.keyboard.down("ArrowRight");
    const diagonalStart = await read(); await frames(); const diagonalEnd = await read();
    assert.ok(Math.abs(Math.hypot(diagonalEnd.x - diagonalStart.x, diagonalEnd.y - diagonalStart.y) - 180 * (diagonalEnd.time - diagonalStart.time)) < 0.01);
    await page.keyboard.up("ArrowDown"); await page.keyboard.up("ArrowRight");
    record("Desktop mouse targets, WASD priority and full-speed normalized arrow diagonals work.");
    results.viewport = "390x844 and 844x390 CSS px, DPR 2; desktop 1280x720 DPR 1";
    await desktop.close();
  }
  assert.deepEqual(errors, []); results.pageErrors = errors;
  await Bun.write(join(evidence, performanceOnly ? "performance.json" : "browser.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
  if (performanceOnly) for (const key of ["off", "on"]) {
    const report = results[key] as { lowestRollingFps: number };
    assert.ok(report.lowestRollingFps >= 58, `${key}: ${JSON.stringify(report)}`);
  }
} finally { await browser.close(); }
