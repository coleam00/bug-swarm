// Artwork-only Chrome evidence. Gameplay/entry validation: scripts/validate-cutover.ts.
// Build first. SCRATCH contains playwright-core; all artifacts and browser data stay there.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "../src/server/db";
import { createApp } from "../src/server/app";
import { createShareAssets, SHARE_PATHS } from "../src/server/share-assets";

const scratch = process.env.SCRATCH!;
assert.ok(scratch, "Set SCRATCH to a directory containing playwright-core");
const home = join(scratch, "home"), evidence = join(scratch, "share-evidence");
assert.ok(join(scratch).startsWith(join(process.cwd(), ".evidence")), "SCRATCH must be inside checkout .evidence/");
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

try {
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
  const entryCss = readFileSync("src/web/entry/entry.css", "utf8");
  assert.match(entryCss, /\.entry \{[^}]*-webkit-touch-callout: none/);
  assert.match(entryCss, /\.entry input \{[^}]*-webkit-touch-callout: default/);
  await page.screenshot({ path: join(evidence, "artwork.png"), fullPage: true });
  await Bun.write(join(evidence, "measurements.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); db.close(); }
