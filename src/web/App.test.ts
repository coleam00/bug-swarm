import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("App opens untimed choices, activates each touch card and displays the real Session build", () => {
  const scratch = mkdtempSync(join(tmpdir(), "app-arena-test-")), home = join(scratch, "home");
  mkdirSync(home);
  const moduleUrl = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, path)).href);
  // Run real React effects/handlers and Session subscriptions. Only canvas
  // mounting and native host methods sit outside this focused integration.
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
const { createElement } = await import(${JSON.stringify(import.meta.resolve("react"))});
const { create, act } = await import(${JSON.stringify(import.meta.resolve("react-test-renderer"))});
const { Session } = await import(${moduleUrl("game/session.ts")});
const { api } = await import(${moduleUrl("game/api.ts")});
const { step, IDLE } = await import(${moduleUrl("game/simulation.ts")});
const { pick } = await import(${moduleUrl("game/upgrade-fixture.test-support.ts")});
const { UPGRADE_IDS, UPGRADE_NAMES } = await import(${moduleUrl("../shared/upgrades.ts")});
api.start = async () => ({ runId: "scratch-run" });
api.finish = async () => ({ saved: true });
api.best = async () => ({ best: null }); api.leaders = async () => [];
let session;
mock.module(${moduleUrl("game/session.ts")}, () => ({ Session: class extends Session {
  constructor(...args) { super(...args); session = this; }
} }));
mock.module(${moduleUrl("game/engine.ts")}, () => ({ mountGame: () => () => {} }));

// Execute both timeout and interval callbacks, so an accidental auto-pick
// cannot hide behind an unexecuted timer. Gameplay still uses simulation time.
let clock = 0, nextTimer = 0;
const timers = new Map();
function schedule(callback, delay, repeat, args) {
  const id = ++nextTimer, ms = Math.max(1, Number(delay) || 0);
  timers.set(id, { callback, at: clock + ms, repeat: repeat ? ms : 0, args }); return id;
}
globalThis.setTimeout = (fn, delay, ...args) => schedule(fn, delay, false, args);
globalThis.setInterval = (fn, delay, ...args) => schedule(fn, delay, true, args);
globalThis.clearTimeout = globalThis.clearInterval = id => timers.delete(id);
function wait(ms) {
  const until = clock + ms;
  for (;;) {
    let next;
    for (const entry of timers) if (!next || entry[1].at < next[1].at) next = entry;
    if (!next || next[1].at > until) break;
    const [id, timer] = next; clock = timer.at;
    if (timer.repeat) timer.at += timer.repeat; else timers.delete(id);
    timer.callback(...timer.args);
  }
  clock = until;
}
const identity = { playerId: crypto.randomUUID(), name: "Robot" };
globalThis.localStorage = { getItem: () => JSON.stringify(identity) };
globalThis.window = { innerWidth: 390, innerHeight: 844 };
globalThis.document = { activeElement: null };
const focusable = () => ({ focus() { document.activeElement = this; } });
const canvas = focusable(), dialogs = [];
function createNodeMock(element) {
  if (element.type === "canvas") return canvas;
  if (element.type !== "dialog") return null;
  const cards = Array.from({ length: 3 }, focusable);
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; },
    querySelector: () => cards[0], querySelectorAll: () => cards };
  dialogs.push(dialog); return dialog;
}
const { App } = await import(${moduleUrl("App.tsx")});
let tree;
const text = node => typeof node === "object" ? node.children.map(text).join(" ") : String(node);
try {
  await act(async () => { tree = create(createElement(App), { createNodeMock }); });
  assert.ok(session?.current, "App did not start its real Session");
  const portrait = session.current;
  assert.deepEqual(portrait.simulation.arena, { width: 450, height: 800 });
  window.innerWidth = 844; window.innerHeight = 390;
  act(() => { session.start(); });
  assert.deepEqual(session.current.simulation.arena, { width: 800, height: 450 });
  assert.deepEqual(portrait.simulation.arena, { width: 450, height: 800 });

  for (let index = 0; index < 3; index++) {
    act(() => { session.start(); });
    const s = session.current.simulation;
    s.time = 19.99; s.spawnIn = s.fireIn = Infinity;
    act(() => { step(s, IDLE, 0.02); session.publishChoice(); });
    const dialog = dialogs.at(-1), choice = session.view.choice;
    assert.ok(dialog?.open, "Choice must open as a modal");
    const renderedDialog = tree.root.findByType("dialog");
    assert.ok(renderedDialog.props["aria-labelledby"], "Choice must be labelled");
    const cards = renderedDialog.findAllByType("button");
    assert.equal(cards.length, 3);
    cards.forEach((card, i) => {
      const name = UPGRADE_NAMES[choice.offer[i]], content = text(card);
      assert.ok(content.includes(name), "Card must name its offered upgrade");
      assert.match(content.replace(name, ""), /[a-z]/i, "Card must explain the upgrade");
    });
    const frozen = structuredClone(s);
    await act(async () => { wait(60000); });
    assert.deepEqual(s, frozen, "Waiting must not select or advance gameplay");
    assert.equal(session.view.choice, choice);
    assert.ok(dialog.open);
    const id = choice.offer[index];
    act(() => { cards[index].props.onPointerDown({ pointerType: "touch" }); cards[index].props.onClick(); });
    assert.equal(session.view.choice, null, "Touch must resume the run");
    assert.deepEqual(session.view.upgrades, [{ id, count: 1 }]);
    assert.equal(session.current.touch, true);
    assert.equal(dialog.open, false, "Selecting must close the modal");
    assert.equal(document.activeElement, canvas, "Selecting must restore game focus");
  }

  act(() => { session.start(); });
  const s = session.current.simulation;
  UPGRADE_IDS.forEach((id, index) => { for (let n = 0; n <= index; n++) pick(s, id); });
  await act(async () => { session.end(); });
  const build = text(tree.root.findByProps({ className: "build" }));
  for (const id of UPGRADE_IDS) assert.ok(build.includes(UPGRADE_NAMES[id]), "Build must name every acquired upgrade");
  assert.deepEqual(build.match(/[0-9]+/g).map(Number).sort(), [1, 2, 3, 4]);
  await act(async () => { session.start(); session.end(); });
  const empty = text(tree.root.findByProps({ className: "build" }));
  assert.ok(empty.trim(), "Empty build must have explanatory text");
  assert.ok(UPGRADE_IDS.every(id => !empty.includes(UPGRADE_NAMES[id])));
} finally { if (tree) act(() => { tree.unmount(); }); }
assert.equal(timers.size, 0, "Unmount must clear outstanding UI timers");
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
