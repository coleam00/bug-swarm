// Developer-only Chrome evidence: intercepted production build, no listener or database.
// Install playwright-core in SCRATCH, build the app, then run with bun.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scratch = process.env.SCRATCH!;
assert.ok(scratch, "Set SCRATCH to an isolated directory containing playwright-core");
const home = join(scratch, "home"), evidence = resolve("docs/guard-evidence");
mkdirSync(home, { recursive: true }); mkdirSync(evidence, { recursive: true });
const { chromium } = await import(pathToFileURL(join(scratch, "node_modules/playwright-core/index.mjs")).href);
const browser = await chromium.launch({ headless: true,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, DATA_DIR: join(scratch, "data") },
});
const errors: string[] = [], assertions: string[] = [];
const report: Record<string, unknown> = { chrome: browser.version(), measuredAt: new Date().toISOString(), assertions };
try {
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 720 }]) {
    const mobile = size.width !== 1280;
    const context = await browser.newContext({ viewport: size, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    let starts = 0, offline = false;
    await context.route("**/*", (route: any) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/")) {
        if (offline) return route.abort();
        if (path === "/api/runs") starts++;
        return route.fulfill({ json: path === "/api/runs" ? { runId: crypto.randomUUID() } : path.endsWith("/finish") ? { saved: true, held: false } :
          path === "/api/teams" ? { tabs: 123, spaces: 99 } : path.endsWith("/best") ? { best: 100 } :
            Array.from({ length: 10 }, (_, i) => ({ playerId: String(i), name: `Robot ${i}`, score: 100 - i })) });
      }
      if (["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/og-image.png"].includes(path)) return route.fulfill({ status: 204 });
      const file = path === "/" ? "index.html" : path.slice(1);
      assert.ok(file === "index.html" || /^assets\/[\w.-]+$/.test(file));
      return route.fulfill({ body: readFileSync(join("dist", file)), contentType: file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
    });
    const page = await context.newPage(); page.on("pageerror", (e: Error) => errors.push(e.message));
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, point?: { x: number; y: number }) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: point ? [{ ...point, id: 1, radiusX: 6, radiusY: 6 }] : [],
    });
    const center = async (selector: string) => {
      const box = await page.locator(selector).first().boundingBox(); assert.ok(box);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const snapshot = () => page.evaluate(() => {
      const session = (window as any).guardSession, s = session.current.simulation;
      return { token: session.view.token, choice: session.view.choice?.number, touch: session.current.touch, time: s.time, robot: { ...s.robot }, ready: session.view.restartReady };
    });
    const openChoice = async () => {
      await page.evaluate(() => {
        const s = (window as any).guardSession.current.simulation;
        s.time = s.upgrades.nextChoiceAt - 0.01;
      });
      await page.locator("dialog").waitFor();
    };
    const waitChoice = () => page.waitForFunction(() => (window as any).guardSession.view.choiceReady);
    const waitRestart = () => page.getByRole("button", { name: "Play again" }).waitFor({ state: "visible" });
    const end = () => page.evaluate(() => (window as any).guardSession.end());
    await page.goto("http://localhost/"); await page.locator("#name").fill("Guard Robot");
    await page.getByRole("button", { name: "Join Tabs" }).click();
    await page.evaluate(() => {
      const element = document.querySelector(".game") as any;
      let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))!];
      for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const session = hook.memoizedState;
        if (session?.identity && typeof session.start === "function") { (window as any).guardSession = session; return; }
      }
      throw new Error("Session not found");
    });
    const protect = () => page.evaluate(() => {
      const s = (window as any).guardSession.current.simulation;
      s.spawnIn = s.fireIn = s.invulnerableUntil = Infinity; s.bugs = [];
    });
    await protect();
    // Sample the actual CSS animation before the guard expires.
    await openChoice();
    const { opacity, duration } = await page.locator(".choice-cards").evaluate((e: HTMLElement) => {
      const style = getComputedStyle(e);
      return { opacity: Number(style.opacity), duration: style.animationDuration };
    });
    assert.equal(duration, "0.35s", "Upgrade cards must fade for the full 350 ms guard");
    assert.ok(opacity < 1, `Expected an in-progress fade, got ${opacity}`);
    assert.equal(await page.locator("dialog button").first().getAttribute("aria-disabled"), "true");
    const frozen = await snapshot();
    if (mobile) {
      await touch("touchStart", await center("dialog button")); await waitChoice(); await touch("touchEnd");
    } else {
      await page.keyboard.down("Space"); await waitChoice(); await page.keyboard.up("Space");
    }
    assert.equal((await snapshot()).choice, frozen.choice); assert.equal((await snapshot()).time, frozen.time);
    assert.equal(await page.locator("dialog button").first().getAttribute("aria-disabled"), "false");
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".choice-cards")!).opacity === "1");
    const animation = await page.locator(".choice-cards").evaluate((e: HTMLElement) => ({ opacity: getComputedStyle(e).opacity, count: e.getAnimations().length }));
    assert.equal(animation.opacity, "1"); assert.equal(animation.count, 1);
    await page.screenshot({ path: join(evidence, `choice-${size.width}.png`) });
    // Native focus containment and Escape protection.
    await page.locator("dialog button").last().focus(); await page.keyboard.press("Tab");
    assert.equal(await page.locator("dialog button").first().evaluate((e: HTMLElement) => e === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.locator("dialog button").last().evaluate((e: HTMLElement) => e === document.activeElement), true);
    await page.keyboard.press("Escape"); assert.equal(await page.locator("dialog").count(), 1);
    if (mobile) await page.locator("dialog button").first().tap(); else await page.keyboard.press("Enter");
    await page.locator("dialog").waitFor({ state: "detached" });
    assert.equal(await page.locator("canvas").evaluate((e: HTMLElement) => e === document.activeElement), true);
    // A fresh numeric press only works after release; the paused simulation never catches up.
    await openChoice(); await page.keyboard.down("1"); await waitChoice();
    await page.keyboard.down("1"); assert.ok((await snapshot()).choice);
    await page.keyboard.up("1"); await page.keyboard.press("1"); await page.locator("dialog").waitFor({ state: "detached" });
    // Reduced motion removes only the fade, retaining the complete guard.
    await page.emulateMedia({ reducedMotion: "reduce" }); await openChoice();
    assert.equal(await page.locator(".choice-cards").evaluate((e: HTMLElement) => getComputedStyle(e).opacity), "1");
    assert.equal(await page.locator("dialog button").first().getAttribute("aria-disabled"), "true");
    await waitChoice(); await page.keyboard.press("2"); await page.locator("dialog").waitFor({ state: "detached" });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await end(); await page.locator(".over").waitFor();
    const token = (await snapshot()).token, startsBefore = starts;
    assert.equal(await page.getByRole("button", { name: "Play again" }).isVisible(), false);
    assert.equal(await page.locator(".restart").isVisible(), false);
    assert.ok((await page.locator(".over").innerText()).includes("Live top 10"));
    const buildY = (await page.locator(".build").boundingBox())!.y;
    if (mobile) { await touch("touchStart", await center(".final-score")); await waitRestart(); await touch("touchEnd"); }
    else { await page.keyboard.down("Enter"); await waitRestart(); await page.keyboard.down("Enter"); await page.keyboard.up("Enter"); }
    assert.equal((await snapshot()).token, token); assert.equal(starts, startsBefore);
    assert.equal((await page.locator(".build").boundingBox())!.y, buildY);
    assert.equal(await page.locator(".restart").isVisible(), true);
    await page.waitForFunction(() => document.querySelectorAll(".over li").length === 10);
    const scroll = await page.locator(".over").evaluate((e: HTMLElement) => { e.scrollTop = e.scrollHeight; return { top: e.scrollTop, height: e.clientHeight, content: e.scrollHeight }; });
    if (size.height === 390) assert.ok(scroll.top > 0);
    await page.screenshot({ path: join(evidence, `over-${size.width}.png`) });
    await page.locator(".over").evaluate((e: HTMLElement) => { e.scrollTop = 0; });
    if (mobile) await page.locator(".final-score").tap(); else await page.getByRole("button", { name: "Play again" }).focus().then(() => page.keyboard.press("Space"));
    await page.locator(".over").waitFor({ state: "detached" }); await protect();
    assert.equal((await snapshot()).token, token + 1);
    if (mobile) {
      // Stationary initial contact on the restarted canvas, then steering by drag.
      const point = await center("canvas"), before = await snapshot();
      await touch("touchStart", point); await page.waitForTimeout(70);
      assert.deepEqual((await snapshot()).robot, before.robot);
      await touch("touchMove", { x: point.x + 60, y: point.y }); await page.waitForTimeout(70);
      assert.ok((await snapshot()).robot.x > before.robot.x); await touch("touchEnd");
    }
    offline = true; await end(); await waitRestart();
    await page.waitForFunction(() => (window as any).guardSession.view.save === "failed");
    await page.getByRole("button", { name: "Play again" }).click(); await page.locator(".over").waitFor({ state: "detached" });
    assert.equal((await snapshot()).token, token + 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    report[`${size.width}x${size.height}`] = { earlyOpacity: opacity, fadeDuration: duration, finalAnimation: animation, scroll, startsBefore, startsAfter: starts };
    assertions.push(`${size.width}x${size.height}: early held ${mobile ? "touch" : "Space/Enter"} releases rejected; fresh card/numeric/restart inputs accepted; automatic prompts, fixed board layout, modal focus/escape, reduced motion, scrolling and offline restart passed.`);
    await context.close();
  }
  assert.deepEqual(errors, []); report.errors = errors;
  writeFileSync(join(evidence, "browser.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
