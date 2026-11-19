import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const workspace = resolve(import.meta.dir, "../..");
const scratch = mkdtempSync(join(tmpdir(), "startup-test-"));
const home = join(scratch, "home");
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  APPDATA: join(home, "AppData", "Roaming"),
  LOCALAPPDATA: join(home, "AppData", "Local"),
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  BUN_INSTALL_CACHE_DIR: join(home, "bun-cache"),
  PORT: undefined,
  DATA_DIR: undefined,
  NODE_ENV: undefined,
};

// Run the actual entry point without opening a TCP listener. Capture the options
// passed to Bun and exercise the real Hono/static handler registered at startup.
const probe = `
let options;
Bun.serve = (value) => { options = value; return {}; };
await import("./src/server/main.ts");
const page = await options.fetch(new Request("http://startup.test/"));
const html = await page.text();
const assetPath = html.match(/src="([^"]+\\.js)"/)?.[1];
if (!assetPath) throw new Error("Built HTML has no JavaScript bundle");
const asset = await options.fetch(new Request(new URL(assetPath, "http://startup.test")));
await Bun.write("startup.json", JSON.stringify({
  port: options.port,
  hostname: options.hostname,
  pageStatus: page.status,
  html,
  assetPath,
  assetStatus: asset.status,
  assetType: asset.headers.get("content-type"),
  assetHash: new Bun.CryptoHasher("sha256").update(await asset.arrayBuffer()).digest("hex"),
}));
`;

beforeAll(() => {
  mkdirSync(home);
  for (const path of ["src", "package.json", "vite.config.ts", "index.html"]) {
    cpSync(join(workspace, path), join(scratch, path), { recursive: true });
  }
  symlinkSync(join(workspace, "node_modules"), join(scratch, "node_modules"), "junction");
  const build = Bun.spawnSync([process.execPath, "run", "build"], {
    cwd: scratch, env, stdout: "pipe", stderr: "pipe", timeout: 30_000,
  });
  expect(build.exitCode, build.stderr.toString()).toBe(0);
}, 30_000);

afterAll(() => {
  // Both child processes have exited and released SQLite handles before cleanup.
  rmSync(scratch, { recursive: true, force: true });
});

test.each([
  { name: "defaults", overrides: {}, port: 3000, dataDir: "data" },
  {
    name: "production overrides",
    overrides: { NODE_ENV: "production", PORT: "8080", DATA_DIR: join(scratch, "custom-data") },
    port: 8080,
    dataDir: join(scratch, "custom-data"),
  },
])("startup uses $name and serves the built bundle", async ({ overrides, port, dataDir }) => {
  const child = Bun.spawnSync([process.execPath, "--eval", probe], {
    cwd: scratch, env: { ...env, ...overrides }, stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  const result = JSON.parse(readFileSync(join(scratch, "startup.json"), "utf8"));
  expect({ port: result.port, hostname: result.hostname }).toEqual({ port, hostname: "0.0.0.0" });
  expect(existsSync(resolve(scratch, dataDir, "app.db"))).toBe(true);
  expect(result.pageStatus).toBe(200);
  expect(result.html.toLowerCase()).toContain("<!doctype html>");
  expect(result.assetStatus).toBe(200);
  expect(result.assetType).toMatch(/javascript/);
  const builtAsset = await Bun.file(join(scratch, "dist", result.assetPath)).arrayBuffer();
  expect(result.assetHash).toBe(new Bun.CryptoHasher("sha256").update(builtAsset).digest("hex"));
}, 15_000);
