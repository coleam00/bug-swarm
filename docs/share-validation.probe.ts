// Manual Chrome evidence; same scratch-only playwright-core setup as team-validation.probe.ts.
// Build first. SCRATCH contains playwright-core; all artifacts and browser data stay there.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "../src/server/db";
import { createApp } from "../src/server/app";
import { createShareAssets, SHARE_PATHS } from "../src/server/share-assets";
import { renderShareMeta } from "../src/server/share-meta";

const scratch = process.env.SCRATCH!;
assert.ok(scratch, "Set SCRATCH to a directory containing playwright-core");
const home = join(scratch, "home"), evidence = join(scratch, "share-evidence");
mkdirSync(home, { recursive: true }); mkdirSync(evidence, { recursive: true });
const db = openDb(join(mkdtempSync(join(scratch, "share-data-")), "app.db"));
const app = createApp(db); app.route("/", createShareAssets());
const { chromium } = await import(pathToFileURL(join(scratch, "node_modules/playwright-core/index.mjs")).href);
const primary = await chromium.launchPersistentContext(join(scratch, `chrome-profile-${crypto.randomUUID()}`), {
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }), headless: true, timeout: 20_000, env: {
  ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
} });
const browser = primary.browser()!;
const results: Record<string, unknown> = { chrome: browser.version() };
const requests: string[] = [], errors: string[] = [];
let starts = 0, offline = false;
const leaders = Array.from({ length: 10 }, (_, index) => ({ playerId: crypto.randomUUID(), name: `Robot number ${index + 10}`, score: 1000 - index }));

try {
  for (const viewport of process.argv.includes("--artwork-only") ? [] : [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    await context.route("**/*", async (route: any) => {
      const request = route.request(), path = new URL(request.url()).pathname;
      requests.push(path);
      if (path.startsWith("/api/") || SHARE_PATHS.includes(path as any)) {
        if (path === "/api/runs") starts++;
        if (offline && path.startsWith("/api/")) return route.abort();
        if (path === "/api/leaderboard") return route.fulfill({ json: leaders });
        const response = await app.request(path, { method: request.method(), headers: request.headers(), body: request.postData() ?? undefined });
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
      }
      const file = path.startsWith("/assets/") ? path.slice(1) : "index.html";
      assert.ok(!file.includes(".."));
      return route.fulfill({ body: file === "index.html" ? renderShareMeta(readFileSync("dist/index.html", "utf8"), "https://swarm.test") : readFileSync(join("dist", file)),
        contentType: file.endsWith("js") ? "text/javascript" : file.endsWith("css") ? "text/css" : "text/html" });
    });
    const page = await context.newPage();
    page.on("pageerror", (error: Error) => errors.push(error.message));
    const cdp = await context.newCDPSession(page);
    async function gesture(x: number, y: number, endY = y, hold = 0) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      if (hold) await page.waitForTimeout(hold);
      if (endY !== y) for (let i = 1; i <= 12; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (endY - y) * i / 12 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    async function session(action: string) {
      return page.evaluate((action: string) => {
        const element = document.querySelector(".game") as any;
        let fiber = element[Object.keys(element).find(key => key.startsWith("__reactFiber"))!];
        for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const session = hook.memoizedState;
          if (!session?.identity || typeof session.end !== "function") continue;
          const sim = session.current.simulation;
          if (action === "choice") { sim.time = 19.99; sim.bugs.length = 0; sim.invulnerableUntil = 100; }
          if (action === "end") { sim.dead = true; session.end(); }
          return { token: session.current.token, x: sim.robot.x, y: sim.robot.y };
        }
        throw new Error("Session not found");
      }, action);
    }
    const key = `${viewport.width}x${viewport.height}`, timing: Record<string, unknown> = {};
    const first = performance.now();
    await page.goto("https://swarm.test/");
    await page.locator("#name").fill("Share Robot");
    const entry = await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("#name")!;
      input.select();
      return { selection: getComputedStyle(input).userSelect, selected: input.value.slice(input.selectionStart!, input.selectionEnd!),
        buttons: [...document.querySelectorAll("button")].every(b => getComputedStyle(b).touchAction === "manipulation"),
        overscroll: [document.documentElement, document.body].map(el => getComputedStyle(el).overscrollBehavior) };
    });
    assert.equal(entry.selection, "text"); assert.equal(entry.selected, "Share Robot"); assert.ok(entry.buttons);
    assert.deepEqual(entry.overscroll, ["none", "none"]);
    const beforeStart = starts;
    const joinButton = await page.getByRole("button", { name: "Join Tabs" }).boundingBox();
    await page.getByRole("button", { name: "Join Tabs" }).tap();
    await page.touchscreen.tap(joinButton!.x + joinButton!.width / 2, joinButton!.y + joinButton!.height / 2);
    await page.locator("canvas").waitFor(); timing.firstEntryMs = Math.round(performance.now() - first);
    assert.ok(Number(timing.firstEntryMs) < 10000);
    assert.equal(starts, beforeStart + 1);
    assert.equal(await page.evaluate(() => visualViewport!.scale), 1);
    const hud = await page.locator(".hud").boundingBox();
    let menus = 0; await page.exposeFunction("recordContextMenu", () => menus++);
    await page.evaluate(() => document.addEventListener("contextmenu", () => (window as any).recordContextMenu()));
    await gesture(hud!.x + 50, hud!.y + 20, undefined, 750);
    const hudState = await page.locator(".hud").evaluate((el: Element) => ({ select: getComputedStyle(el).userSelect, selected: getSelection()?.toString() }));
    assert.equal(hudState.select, "none"); assert.equal(hudState.selected, ""); assert.equal(menus, 0);
    await gesture(100, 30, 120); assert.equal(await page.evaluate(() => scrollY), 0);
    const canvas = await page.locator("canvas").boundingBox();
    assert.equal(await page.locator("canvas").evaluate((el: Element) => getComputedStyle(el).touchAction), "none");
    const beforeDrag = await session("read");
    await gesture(canvas!.x + canvas!.width * .8, canvas!.y + canvas!.height * .7, canvas!.y + canvas!.height * .4, 150);
    const afterDrag = await session("read");
    assert.ok(Math.hypot(afterDrag.x - beforeDrag.x, afterDrag.y - beforeDrag.y) > 1);
    await session("choice"); await page.locator("dialog[open]").waitFor();
    const dialog = await page.locator("dialog").evaluate((el: Element) => ({ overflow: getComputedStyle(el).overflowY, overscroll: getComputedStyle(el).overscrollBehavior,
      selection: getComputedStyle(el).userSelect, buttons: [...el.querySelectorAll("button")].every(b => getComputedStyle(b).touchAction === "manipulation") }));
    assert.deepEqual(dialog, { overflow: "auto", overscroll: "none", selection: "none", buttons: true });
    await page.screenshot({ path: join(evidence, `${key}-choice.png`) });
    await page.locator("dialog button").first().tap(); await page.locator("dialog").waitFor({ state: "detached" });
    // Force game over for gesture evidence; the accelerated result is correctly rejected by the API.
    await session("end"); await page.locator(".over ol li").nth(9).waitFor();
    const token = (await session("read")).token;
    const over = await page.locator(".over").boundingBox();
    await gesture(over!.x + over!.width / 2, over!.y + over!.height - 35, over!.y + 30);
    await page.waitForTimeout(150);
    assert.equal((await session("read")).token, token);
    const scroll = await page.locator(".over").evaluate((el: Element) => ({ top: el.scrollTop, range: el.scrollHeight - el.clientHeight, overscroll: getComputedStyle(el).overscrollBehavior }));
    assert.equal(scroll.overscroll, "none"); if (scroll.range > 0) assert.ok(scroll.top > 0);
    await page.screenshot({ path: join(evidence, `${key}-over.png`) });
    const restart = starts;
    // Any stationary overlay tap restarts, even after scrolling the results.
    await page.locator(".over").tap({ position: { x: 20, y: 20 } });
    await page.locator(".over").waitFor({ state: "detached" });
    await page.waitForTimeout(100); assert.equal(starts, restart + 1);
    const returning = performance.now(); await page.reload(); await page.locator("canvas").waitFor();
    timing.returnEntryMs = Math.round(performance.now() - returning); assert.ok(Number(timing.returnEntryMs) < 2000);
    results[key] = { entry, hudState, menus, dialog, scroll, ...timing, steeringDistance: Math.round(Math.hypot(afterDrag.x - beforeDrag.x, afterDrag.y - beforeDrag.y)) };
    for (const path of ["/board", "/board/"]) {
      await page.goto("https://swarm.test" + path); await page.locator(".board-leaders li").nth(9).waitFor();
      await gesture(100, viewport.height - 50, 60);
      const board = await page.evaluate(() => ({ y: scrollY, range: document.documentElement.scrollHeight - innerHeight,
        overscroll: getComputedStyle(document.body).overscrollBehavior, selection: getComputedStyle(document.querySelector(".stream-board")!).userSelect }));
      assert.equal(board.overscroll, "none"); assert.notEqual(board.selection, "none");
      assert.ok(board.range > 0 && board.y > 0); results[key + path] = board;
    }
    await page.goto("https://swarm.test/"); await page.evaluate(() => localStorage.clear()); offline = true;
    await page.reload(); await page.locator("#name").fill("Offline Robot");
    await page.getByRole("button", { name: "Join Spaces" }).tap(); await page.locator("canvas").waitFor();
    const offlineBefore = await session("read");
    const rect = await page.locator("canvas").boundingBox();
    await gesture(rect!.x + rect!.width * .8, rect!.y + rect!.height / 2, undefined, 200);
    const offlineAfter = await session("read"); assert.ok(offlineAfter.x > offlineBefore.x);
    offline = false; await context.close();
  }
  assert.ok(!requests.some(path => path === "/og-image.png"), "Gameplay never requests preview artwork");
  const context = await browser.newContext();
  await context.route("**/*", async (route: any) => {
    const path = new URL(route.request().url()).pathname;
    if (SHARE_PATHS.includes(path as any)) {
      const response = await app.request(path);
      return route.fulfill({ headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    // Playwright bypasses interception for URLs ending /favicon.ico; a query lets
    // Chrome decode the same route bytes without contacting a real network host.
    return route.fulfill({ contentType: "text/html", body: `<body style="margin:24px;background:#0b1018;color:white"><img src="/favicon.svg" width="16"><img src="/favicon.svg" width="32"><img src="/favicon.ico?decode=1"><img src="/apple-touch-icon.png"><img src="/og-image.png" style="display:block;max-width:100%"></body>` });
  });
  const page = await context.newPage(); await page.goto("https://swarm.test/inspect");
  const images = await page.evaluate(async () => Promise.all([...document.images].map(async img => {
    try { await img.decode(); } catch (error) {
      const response = await fetch(img.src), bytes = new Uint8Array(await response.arrayBuffer());
      throw new Error(`${img.src}: ${error}; ${response.headers.get("content-type")}; bytes=${[...bytes.slice(0, 32)]}; length=${bytes.length}`);
    }
    return { path: new URL(img.src).pathname, width: img.naturalWidth, height: img.naturalHeight };
  })));
  assert.deepEqual(images.map((image: any) => [image.width, image.height]), [[180, 180], [180, 180], [32, 32], [180, 180], [1200, 630]]);
  results.images = images; results.requests = [...new Set(requests)]; assert.deepEqual(errors, []);
  for (const file of readdirSync("dist/assets").filter(file => file.endsWith(".js"))) {
    assert.ok(!/resvg|share-assets/.test(readFileSync(join("dist/assets", file), "utf8")), "Rasterizer stays out of browser bundles");
  }
  const css = readFileSync("src/web/style.css", "utf8");
  assert.match(css, /\.entry, \.game, \.choices \{[^}]*-webkit-touch-callout: none/);
  assert.match(css, /#name \{[^}]*-webkit-touch-callout: default/);
  await page.screenshot({ path: join(evidence, "artwork.png"), fullPage: true });
  await Bun.write(join(evidence, "measurements.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); db.close(); }
