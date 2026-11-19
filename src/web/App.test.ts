import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("App wires screen-shaped runs, three named choice cards and the game-over build", () => {
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
let session, forcedView;
mock.module(${moduleUrl("game/session.ts")}, () => ({ Session: class extends Session {
  constructor(...args) { super(...args); if (forcedView) this.view = { ...this.view, ...forcedView }; session = this; }
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
const { UPGRADE_IDS } = await import(${moduleUrl("../shared/upgrades.ts")});
forcedView = { choice: { number: 1, offer: UPGRADE_IDS.slice(0, 3) }, upgrades: UPGRADE_IDS.map(id => ({ id, count: 1 })) };
const choiceHtml = renderToString(createElement(App));
assert.match(choiceHtml, /<dialog[^>]*aria-labelledby="choice-title"/);
assert.equal((choiceHtml.match(/<button/g) ?? []).length, 3);
for (const text of ["Review laser", "Test shield", "Refactor bomb", "Shots hit up to 3 bugs", "Refill to block 2 hits", "15s recharge"]) assert.ok(choiceHtml.includes(text), text);
forcedView = { choice: { number: 2, offer: UPGRADE_IDS.slice(1) }, upgrades: UPGRADE_IDS.map(id => ({ id, count: 1 })) };
assert.match(renderToString(createElement(App)), /Add a second firing drone/);
forcedView = { over: true, upgrades: UPGRADE_IDS.map(id => ({ id, count: 2 })) };
const overHtml = renderToString(createElement(App));
for (const text of ["Review laser", "Test shield", "Refactor bomb", "CI drone", "Play again"]) assert.ok(overHtml.includes(text), text);
assert.equal((overHtml.match(new RegExp(String.fromCharCode(215) + "2", "g")) ?? []).length, 4);
forcedView = { over: true, upgrades: [] };
assert.match(renderToString(createElement(App)), /No upgrades taken/);
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
