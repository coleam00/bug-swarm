// Developer-only: Node 22.18+ owns Chrome; Bun builds fixtures. Install playwright-core under SCRATCH. No listener or DB.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scratch = process.env.SCRATCH;
assert.ok(scratch, "Set SCRATCH to an isolated directory containing playwright-core");
const evidence = resolve("docs/start-evidence"); mkdirSync(evidence, { recursive: true });
const { chromium } = await import(pathToFileURL(join(scratch, "node_modules/playwright-core/index.mjs")).href);
const profile = await chromium.launchPersistentContext(mkdtempSync(join(scratch, "chrome-profile-")), { headless: true, timeout: 20000,
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  env: { ...process.env, HOME: join(scratch, "home"), USERPROFILE: join(scratch, "home"),
    APPDATA: join(scratch, "home", "roaming"), LOCALAPPDATA: join(scratch, "home", "local") } });
const browser = profile.browser()!;
const errors: string[] = [];
const report: any = { chrome: browser.version(), assertions: [], layouts: [] };
try {
  if (process.argv.includes("--performance")) {
    report.benchmarks = [];
    for (const baseline of [true, false]) {
      // Node owns Chrome's pipe on Windows; Bun compiles the fixture only.
      const source = execFileSync("bun", ["--eval", String.raw`
        const bundle = await Bun.build({ entrypoints: ["scripts/look-benchmark.ts"], target: "browser",
          plugins: process.env.START_BASELINE === "1" ? [{ name: "original-renderer", setup(build) {
            build.onLoad({ filter: /src[\\/]web[\\/]game[\\/](draw|assets)\.ts$/ }, args => {
              const file = args.path.endsWith("draw.ts") ? "draw.ts" : "assets.ts";
              const original = Bun.spawnSync(["git", "show", "c6d6a67:src/web/game/" + file]);
              if (original.exitCode !== 0) throw Error(original.stderr.toString());
              return { contents: original.stdout.toString(), loader: "ts" };
            });
          } }] : [] });
        if (!bundle.success) throw Error(JSON.stringify(bundle.logs));
        process.stdout.write(await bundle.outputs[0].text());
      `], { env: { ...process.env, START_BASELINE: baseline ? "1" : "0" }, maxBuffer: 10 * 1024 * 1024 }).toString();
      for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
        const context = await browser.newContext({ viewport: size, deviceScaleFactor: size.width === 390 ? 2 : 1 });
        await context.route("**/*", (route: any) => route.fulfill({ contentType: "text/html", body:
          `<style>body{margin:0}canvas{width:100vw;height:100dvh}</style><canvas></canvas><pre></pre><script type="module">${source}</script>` }));
        const page = await context.newPage(); page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto("https://swarm.test/?profile=stress&burst");
        await page.waitForFunction(() => (window as any).lookBenchmark?.result, undefined, { timeout: 85000, polling: 250 });
        const result = await page.evaluate(() => (window as any).lookBenchmark.result);
        assert.equal(result.minBugs, 150); assert.equal(result.maxBugs, 150); assert.ok(result.meanFps >= 58);
        report.benchmarks.push({ baseline, ...result }); console.log(JSON.stringify({ baseline, ...result }));
        await page.evaluate(() => (window as any).lookBenchmark.dispose()); await context.close();
      }
    }
    writeFileSync(join(evidence, "performance.json"), JSON.stringify(report, null, 2) + "\n");
  } else {
    for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const touch = size.width !== 1280, context = await browser.newContext({ viewport: size, hasTouch: touch,
        isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
      const starts: any[] = [];
      await context.route("**/*", (route: any) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith("/api/")) {
          if (path === "/api/runs") starts.push(route.request().postDataJSON());
          return route.fulfill({ json: path === "/api/runs" ? { runId: crypto.randomUUID() } : path.endsWith("/finish") ? { saved: true, held: false } :
            path === "/api/teams" ? { tabs: 0, spaces: 0 } : path.endsWith("/best") ? { best: null } :
            path.endsWith("/standing") ? { rank: null, total: 0, next: null } : [] });
        }
        if (path.startsWith("/favicon")) return route.fulfill({ status: 204 });
        const file = path === "/" ? "index.html" : path.slice(1);
        assert.ok(file === "index.html" || /^assets\/[\w.-]+$/.test(file));
        return route.fulfill({ body: readFileSync(join("dist", file)), contentType:
          file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html" });
      });
      const page = await context.newPage(); page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.addInitScript(() => {
        const request = requestAnimationFrame, cancel = cancelAnimationFrame;
        const pending = new Set<number>(), costs: number[] = [];
        (window as any).entryFrames = { pending, costs };
        window.requestAnimationFrame = fn => {
          const entry = !!document.querySelector(".entry-scene");
          const id = request(now => { pending.delete(id); const begin = performance.now(); fn(now); if (entry) costs.push(performance.now() - begin); });
          if (entry) pending.add(id); return id;
        };
        window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
      });
      const bounds = async (state: string) => {
        const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
          controls: [...document.querySelectorAll(".entry input, .entry button, .entry [role=alert]")].map(element => ({
            tag: element.tagName, text: element.textContent, ...element.getBoundingClientRect().toJSON() })) }));
        assert.equal(layout.overflow, false);
        for (const control of layout.controls) {
          assert.ok(control.x >= 0 && control.right <= size.width && control.y >= 0 && control.bottom <= size.height, JSON.stringify(control));
          if (control.tag !== "P") { assert.ok(control.width >= 44); assert.ok(control.height >= 44); }
        }
        report.layouts.push({ size, state, ...layout });
      };
      await page.goto("https://swarm.test/"); await page.locator("#name").waitFor();
      assert.equal(await page.locator(".entry h1").innerText(), "Bug Swarm");
      assert.equal(await page.locator(".entry p").innerText(), "Survive the swarm.");
      assert.deepEqual(await page.locator(".entry button").allTextContents(), ["Join Tabs", "Join Spaces"]);
      assert.equal(await page.locator("[role=alert]").count(), 0); assert.equal(starts.length, 0);
      assert.equal(await page.evaluate(() => localStorage.getItem("bug-swarm-steering-hint-seen")), null);
      await bounds("first");
      await page.screenshot({ path: join(evidence, `first-${size.width}x${size.height}.png`) });
      await page.waitForTimeout(2000);
      const costs = await page.evaluate(() => (window as any).entryFrames.costs);
      costs.sort((a: number, b: number) => a - b);
      report.layouts.push({ size, sceneFrames: costs.length, meanMs: costs.reduce((a: number, b: number) => a + b, 0) / costs.length,
        p95Ms: costs[Math.floor(costs.length * 0.95)] });
      const activate = (name: string) => touch ? page.getByRole("button", { name, exact: true }).tap() : page.getByRole("button", { name, exact: true }).click();
      await activate("Join Tabs");
      assert.equal(await page.locator("[role=alert]").innerText(), "Use 2 to 16 letters or numbers.");
      assert.equal(starts.length, 0); await bounds("error");
      await page.screenshot({ path: join(evidence, `error-${size.width}x${size.height}.png`) });
      await page.locator("#name").fill("  Swarm Robot  "); assert.equal(await page.locator("[role=alert]").count(), 0);
      await page.locator("#name").press("Enter"); assert.equal(starts.length, 0);
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Join Tabs");
      await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Join Spaces");
      if (touch) await activate("Join Spaces"); else await page.keyboard.press("Enter");
      await page.locator(".game canvas").waitFor();
      assert.equal(starts.length, 1); assert.equal(starts[0].team, "spaces"); assert.equal(starts[0].name, "Swarm Robot");
      assert.equal(await page.evaluate(() => (window as any).entryFrames.pending.size), 0);
      const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("bug-swarm-player")!));
      await page.reload(); await page.getByRole("button", { name: "Play", exact: true }).waitFor();
      assert.equal(starts.length, 1); assert.equal(await page.locator("#name").count(), 0);
      assert.equal(await page.locator(".entry-player").innerText(), "Swarm Robot\nSpaces");
      await bounds("returning");
      await page.screenshot({ path: join(evidence, `returning-${size.width}x${size.height}.png`) });
      await activate("Play"); await page.locator(".game canvas").waitFor(); assert.equal(starts.length, 2);
      assert.equal(starts[1].playerId, identity.playerId);
      await page.evaluate(() => localStorage.clear()); await page.reload(); await page.locator("#name").fill("Tabs Robot");
      await activate("Join Tabs"); await page.locator(".game canvas").waitFor(); assert.equal(starts[2].team, "tabs");
      if (touch) {
        await page.evaluate(() => localStorage.clear()); await page.reload(); await page.locator("#name").fill("Rotate Robot");
        await page.setViewportSize({ width: size.height, height: size.width }); await page.setViewportSize(size);
        assert.equal(await page.locator("#name").inputValue(), "Rotate Robot"); await bounds("rotation");
      }
      await page.emulateMedia({ reducedMotion: "reduce" }); await page.reload(); await page.locator(".entry-scene").waitFor();
      assert.equal(await page.evaluate(() => (window as any).entryFrames.pending.size), 0);
      report.assertions.push(`${size.width}x${size.height}: clean copy, delayed errors/retry, Enter/Tab, both teams, Join/Play, stable UUID, no pre-start request/hint, targets/bounds, stopped loop, reduced motion${touch ? ", touch activation and rotation" : ""}`);
      await context.close();
    }
    writeFileSync(join(evidence, "browser.json"), JSON.stringify(report, null, 2) + "\n");
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
console.log(JSON.stringify(report, null, 2));
