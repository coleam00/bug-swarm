import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// A child owns both ephemeral loopback listeners and all data. No service discovery
// or assumptions about an already-running API, frontend port or built dist directory.
test.each([undefined, "https://lan.test"])("Vite serves cards and images without dist (PUBLIC_ORIGIN=%j)", publicOrigin => {
  const scratch = mkdtempSync(join(tmpdir(), "share-dev-test-"));
  const home = join(scratch, "home");
  mkdirSync(home);
  const workspace = resolve(import.meta.dir, "../..");
  try {
    for (const path of ["src", "package.json", "vite.config.ts", "index.html"]) {
      cpSync(join(workspace, path), join(scratch, path), { recursive: true });
    }
    symlinkSync(join(workspace, "node_modules"), join(scratch, "node_modules"), "junction");
    const child = Bun.spawnSync([process.execPath, "--eval", String.raw`
      import assert from "node:assert/strict";
      import { createServer } from "vite";
      const serve = Bun.serve;
      let api;
      Bun.serve = options => api = serve(options);
      await import("./src/server/main.ts");
      Bun.serve = serve;
      process.env.PORT = String(api.port);
      // Force Vite off its configured default, and exercise its occupied-port retry.
      const vite = await createServer({ server: { host: "127.0.0.1", port: api.port } });
      try {
        await vite.listen();
        const origin = new URL(vite.resolvedUrls.local[0]).origin;
        assert.notEqual(new URL(origin).port, String(api.port));
        for (const path of ["/", "/index.html", "/board", "/board/"]) {
          const response = await fetch(origin + path);
          const html = await response.text();
          assert.equal(response.status, 200);
          assert.ok(html.includes('property="og:image" content="' + (process.env.PUBLIC_ORIGIN ?? origin) + '/og-image.png"'));
          assert.ok(!html.includes("__BUG_SWARM_PUBLIC_ORIGIN__"));
        }
        for (const path of ["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/og-image.png"]) {
          const response = await fetch(origin + path);
          assert.equal(response.status, 200);
          assert.match(response.headers.get("content-type"), /^image\//);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (path.endsWith("png")) assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
          else if (path.endsWith("ico")) assert.equal(bytes.readUInt16LE(2), 1);
          else assert.ok(bytes.toString().startsWith("<svg"));
        }
      } finally { await vite.close(); api.stop(true); }
    `], {
      cwd: scratch, env: {
        ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
        XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, DATA_DIR: join(scratch, "data"),
        PORT: "0", NODE_ENV: "development", PUBLIC_ORIGIN: publicOrigin, RAILWAY_PUBLIC_DOMAIN: undefined,
        LOAD_TEST_START_LIMIT: undefined,
      }, stdout: "pipe", stderr: "pipe", timeout: 30_000,
    });
    expect(child.exitCode, child.stderr.toString() + child.stdout.toString()).toBe(0);
  } finally {
    // Child exit releases listeners, watcher and SQLite before Windows cleanup.
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 35_000);
