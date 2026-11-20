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
  LOAD_TEST_START_LIMIT: undefined,
  PUBLIC_ORIGIN: undefined,
  RAILWAY_PUBLIC_DOMAIN: undefined,
};

// Run the actual entry point without opening a TCP listener. Capture the options
// passed to Bun and exercise the real Hono/static handler registered at startup.
const probe = `
let options;
Bun.serve = (value) => { options = value; return {}; };
await import("./src/server/main.ts");
const page = await options.fetch(new Request("http://startup.test/", { headers: { "X-Forwarded-Host": "spoofed.test", "X-Forwarded-Proto": "https" } }));
const html = await page.text();
const assetPath = html.match(/src="([^"]+\\.js)"/)?.[1];
if (!assetPath) throw new Error("Built HTML has no JavaScript bundle");
const asset = await options.fetch(new Request(new URL(assetPath, "http://startup.test")));
const boards = [];
for (const path of ["/index.html", "/board", "/board/", "/board?stream=1", "/unknown-spa-path"]) {
  const response = await options.fetch(new Request("http://startup.test" + path));
  boards.push({ path, status: response.status, html: await response.text() });
}
const assets = [];
const images = [];
for (const path of ["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/og-image.png"]) {
  const response = await options.fetch(new Request("http://startup.test" + path));
  images.push({ path, status: response.status, type: response.headers.get("content-type"), size: (await response.arrayBuffer()).byteLength });
}
for (const file of new Bun.Glob("assets/*").scanSync("dist")) {
  const response = await options.fetch(new Request("http://startup.test/" + file));
  assets.push({ path: file, status: response.status, type: response.headers.get("content-type") });
}
const starts = [];
for (let i = 0; i < 32; i++) {
  const response = await options.fetch(new Request("http://startup.test/api/runs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: crypto.randomUUID(), name: "Robot", team: "tabs" }),
  }));
  starts.push(response.status);
}
await Bun.write("startup.json", JSON.stringify({
  boards, assets, starts, images,
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
  // Child processes have exited and released SQLite handles before cleanup.
  rmSync(scratch, { recursive: true, force: true });
});

test("invalid load override fails before creating a database or starting a listener", () => {
  const dataDir = join(scratch, "invalid-data");
  const child = Bun.spawnSync([process.execPath, "src/server/main.ts"], {
    cwd: scratch, env: { ...env, DATA_DIR: dataDir, LOAD_TEST_START_LIMIT: "" },
    stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  expect(child.exitCode).not.toBe(0);
  expect(child.stderr.toString()).toContain("LOAD_TEST_START_LIMIT must be a positive safe integer");
  expect(child.stdout.toString()).not.toContain("App on");
  expect(existsSync(dataDir)).toBe(false);
});

test("invalid public origin fails before opening the database", () => {
  const dataDir = join(scratch, "invalid-origin-data");
  const child = Bun.spawnSync([process.execPath, "src/server/main.ts"], {
    cwd: scratch, env: { ...env, DATA_DIR: dataDir, PUBLIC_ORIGIN: "https://example.test/path" },
    stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  expect(child.exitCode).not.toBe(0);
  expect(child.stderr.toString()).toContain("PUBLIC_ORIGIN");
  expect(existsSync(dataDir)).toBe(false);
});

test.each([
  { name: "defaults", overrides: {}, port: 3000, dataDir: "data", hostname: "0.0.0.0" },
  {
    name: "production overrides",
    overrides: { NODE_ENV: "production", PORT: "8080", DATA_DIR: join(scratch, "custom-data"), LOAD_TEST_START_LIMIT: "31" },
    port: 8080,
    dataDir: join(scratch, "custom-data"),
    hostname: "0.0.0.0",
  },
  {
    name: "development overrides",
    overrides: { NODE_ENV: "development", PORT: "8081", DATA_DIR: join(scratch, "dev-data") },
    port: 8081,
    dataDir: join(scratch, "dev-data"),
    hostname: "127.0.0.1",
  },
  { name: "public origin", overrides: { PUBLIC_ORIGIN: "https://custom.test/", RAILWAY_PUBLIC_DOMAIN: "ignored.test", DATA_DIR: join(scratch, "origin-data") }, port: 3000, dataDir: join(scratch, "origin-data"), hostname: "0.0.0.0" },
  { name: "Railway origin", overrides: { RAILWAY_PUBLIC_DOMAIN: "swarm.up.railway.app", DATA_DIR: join(scratch, "railway-data") }, port: 3000, dataDir: join(scratch, "railway-data"), hostname: "0.0.0.0" },
])("startup uses $name", async ({ overrides, port, dataDir, hostname }) => {
  const child = Bun.spawnSync([process.execPath, "--eval", probe], {
    cwd: scratch, env: { ...env, ...overrides }, stdout: "pipe", stderr: "pipe", timeout: 10_000,
  });
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  const result = JSON.parse(readFileSync(join(scratch, "startup.json"), "utf8"));
  expect({ port: result.port, hostname: result.hostname }).toEqual({ port, hostname });
  expect(existsSync(resolve(scratch, dataDir, "app.db"))).toBe(true);
  expect(result.starts.slice(0, 30)).toEqual(Array(30).fill(201));
  expect(result.starts.slice(30)).toEqual(overrides.NODE_ENV === "production" ? [201, 429] : [429, 429]);
  if (overrides.NODE_ENV === "production") expect(child.stderr.toString()).toContain("LOAD TEST");
  const origin = overrides.PUBLIC_ORIGIN ? "https://custom.test" : overrides.RAILWAY_PUBLIC_DOMAIN ? "https://swarm.up.railway.app" : "http://startup.test";
  expect(result.html).toContain(`property="og:url" content="${origin}/"`);
  expect(result.html).toContain(`property="og:image" content="${origin}/og-image.png"`);
  expect(result.html).not.toContain("__BUG_SWARM_PUBLIC_ORIGIN__");
  for (const image of result.images) {
    expect(image.status).toBe(200);
    expect(image.type).toMatch(/^image\//);
    expect(image.size).toBeGreaterThan(100);
  }
  expect(result.pageStatus).toBe(200);
  expect(result.html.toLowerCase()).toContain("<!doctype html>");
  expect(result.assetStatus).toBe(200);
  expect(result.assetType).toMatch(/javascript/);
  for (const board of result.boards) {
    expect(board.status).toBe(200);
    expect(board.html).toBe(result.html);
  }
  for (const asset of result.assets) {
    expect(asset.status).toBe(200);
    expect(asset.type).toMatch(asset.path.endsWith(".css") ? /css/ : /javascript/);
  }
  const builtAsset = await Bun.file(join(scratch, "dist", result.assetPath)).arrayBuffer();
  expect(result.assetHash).toBe(new Bun.CryptoHasher("sha256").update(builtAsset).digest("hex"));
}, 15_000);
