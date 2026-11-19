import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("App gives its real session the screen shape on initial start and samples it again on restart", () => {
  const scratch = mkdtempSync(join(tmpdir(), "app-arena-test-")), home = join(scratch, "home");
  mkdirSync(home);
  const moduleUrl = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, path)).href);
  // Isolate module mocks from other tests. Render the actual App, capturing its
  // real Session without replacing the constructor arguments or arena provider.
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
const { createElement } = await import(${JSON.stringify(import.meta.resolve("react"))});
const { renderToString } = await import(${JSON.stringify(import.meta.resolve("react-dom/server"))});
const { Session } = await import(${moduleUrl("game/session.ts")});
const { api } = await import(${moduleUrl("game/api.ts")});
api.start = async () => ({ runId: "scratch-run" });
let session;
mock.module(${moduleUrl("game/session.ts")}, () => ({ Session: class extends Session {
  constructor(...args) { super(...args); session = this; }
} }));
globalThis.localStorage = { getItem: () => JSON.stringify({ playerId: crypto.randomUUID(), name: "Robot" }) };
globalThis.window = { innerWidth: 390, innerHeight: 844 };
const { App } = await import(${moduleUrl("App.tsx")});
assert.match(renderToString(createElement(App)), /<canvas/);
assert.ok(session, "App did not create a Session");
const portrait = session.start();
assert.deepEqual(portrait.simulation.arena, { width: 450, height: 800 });
window.innerWidth = 844; window.innerHeight = 390;
const landscape = session.start();
assert.deepEqual(landscape.simulation.arena, { width: 800, height: 450 });
assert.deepEqual(portrait.simulation.arena, { width: 450, height: 800 });
await Promise.all([portrait.start, landscape.start]);
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], {
      cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home,
        APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
        XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), DATA_DIR: join(scratch, "data") },
      stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 15_000);
