import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { scratchEnv } from "./options";
import { Browser, bounded, until } from "./browser";
import { Player } from "./player";
import { createServer } from "../../src/server/server";
test("Vite mode opt-in is explicit; normal builds disable the hook even with the environment flag", () => {
  const parent = join(process.cwd(), ".evidence", "86", "tests"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "build-")), config = pathToFileURL(join(process.cwd(), "vite.config.ts")).href;
  try {
    // Import Vite/plugins/git once, and keep all environment changes in this
    // owned child. The test deadline exceeds its one bounded child operation.
    const probe = `import config from ${JSON.stringify(config)}; for(const enabled of [false,true]){process.env.ARENA_PLAYTEST=enabled?'1':'';const normal=config({mode:'production',command:'build'});if(normal.define.__ARENA_PLAYTEST__!=='false')throw Error('normal hook enabled');try{const instrumented=config({mode:'playtest',command:'build'});if(!enabled)throw Error('guard missing');if(instrumented.define.__ARENA_PLAYTEST__!=='true')throw Error('instrumentation missing');}catch(e){if(enabled||!String(e).includes('require ARENA_PLAYTEST'))throw e}}`;
    const result = Bun.spawnSync([process.execPath, "--eval", probe], { env: { ...scratchEnv(root), NODE_ENV: "production", RAILWAY_GIT_COMMIT_SHA: "opt-in-test" }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 15000);

test("built and served production client has no hook; explicitly instrumented client exposes a completed frame", async () => {
  const parent = join(process.cwd(), ".evidence", "86", "tests"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "clients-")), browser = new Browser(), apps: ReturnType<typeof createServer>[] = [];
  try {
    const results = await Promise.allSettled(["production", "playtest"].map(async mode => {
      const dir = join(root, mode), assets = join(dir, "assets");
      const env = { ...scratchEnv(dir), NODE_ENV: "production", ARENA_PLAYTEST: mode === "playtest" ? "1" : "" };
      const child = Bun.spawn([process.execPath, "node_modules/vite/bin/vite.js", "build", "--mode", mode, "--outDir", relative(process.cwd(), assets)], { env, stdout: Bun.file(join(dir, "build.log")), stderr: Bun.file(join(dir, "errors.log")) });
      try { await bounded(child.exited, 30000, `${mode} build`); }
      finally { if (child.exitCode === null) { child.kill(); await child.exited; } }
      expect(child.exitCode).toBe(0);
      return { mode, dir, assets, env };
    }));
    const builds = results.map(result => { if (result.status === "rejected") throw result.reason; return result.value; });
    await browser.start(root);
    // Linux's short socket-path alias must still resolve inside this run.
    expect(realpathSync((browser.metadata as { tempDirectory: string }).tempDirectory)).toBe(realpathSync(join(root, "tmp")));
    for (const { mode, dir, assets, env } of builds) {
      const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(dir, "data"), assets, env }); apps.push(app);
      const page = await browser.page(app.server.url.origin), player = new Player(browser, page, mode === "playtest" ? "Instrumented" : "Production", "tabs");
      await until(() => browser.evaluate(page.session, "!!document.querySelector('#name')"));
      await player.click("#name"); await browser.call("Input.insertText", { text: player.name }, page.session); await player.click(".entry-teams button");
      // This readiness check works without the hook and proves the real engine
      // mounted, received a welcome and completed enough frames for its HUD.
      await until(() => browser.evaluate(page.session, "document.querySelector('canvas')?.dataset.players==='1'"));
      const observed = await browser.evaluate<{ exposed: boolean; completed: boolean }>(page.session, "({exposed:Object.hasOwn(window,'__arenaDebug'),completed:!!(window.__arenaDebug?.frame && window.__arenaDebug?.paint.players.length)})");
      expect(observed).toEqual({ exposed: mode === "playtest", completed: mode === "playtest" });
      await browser.screenshot(page.session, join(dir, "client.png"));
      await browser.call("Target.disposeBrowserContext", { browserContextId: page.context });
    }
    expect(browser.errors).toEqual([]);
  } finally { await browser.close(); for (const app of apps) await app.stop(); rmSync(root, { recursive: true, force: true }); }
}, 120000);
