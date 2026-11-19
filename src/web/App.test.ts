import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("App migrates team entry, plays offline, and renders choices, builds and server team races", () => {
  const scratch = mkdtempSync(join(tmpdir(), "app-arena-test-")), home = join(scratch, "home");
  mkdirSync(home);
  const moduleUrl = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, path)).href);
  // Run real React effects/handlers and Session subscriptions. Only canvas
  // mounting and native host methods sit outside this focused integration.
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
const logged = [];
console.error = (...args) => logged.push(args);
const { createElement } = await import(${JSON.stringify(import.meta.resolve("react"))});
const { create, act } = await import(${JSON.stringify(import.meta.resolve("react-test-renderer"))});
const { Session } = await import(${moduleUrl("game/session.ts")});
const { api } = await import(${moduleUrl("game/api.ts")});
const { step, IDLE } = await import(${moduleUrl("game/simulation.ts")});
const { pick } = await import(${moduleUrl("game/upgrade-fixture.test-support.ts")});
const { UPGRADE_IDS, UPGRADE_NAMES } = await import(${moduleUrl("../shared/upgrades.ts")});
api.start = async () => ({ runId: "scratch-run" });
api.finish = async () => ({ saved: true });
api.teams = async () => ({ tabs: 0, spaces: 0 });
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
const identity = { playerId: crypto.randomUUID(), name: "Robot", team: "tabs" };
let stored = JSON.stringify(identity), storageFails = false;
globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => {
  if (storageFails) throw new Error("disabled"); stored = value;
} };
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
  // New and legacy identities use the same one-tap entry, without network waits.
  for (const legacy of [false, true]) {
    for (const team of ["tabs", "spaces"]) {
      stored = legacy ? JSON.stringify({ playerId: identity.playerId, name: identity.name }) : null;
      session = undefined;
      await act(async () => { tree = create(createElement(App), { createNodeMock }); });
      assert.equal(session, undefined, "Entry must await a team");
      const input = tree.root.findByType("input");
      if (legacy) { assert.equal(input.props.value, identity.name); assert.ok(input.props.readOnly); }
      else {
        act(() => { tree.root.findAllByType("button")[0].props.onClick(); });
        assert.ok(text(tree.root.findByProps({ role: "alert" })).trim(), "Name is required");
        act(() => { input.props.onChange({ target: { value: "New Robot" } }); });
      }
      act(() => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
      assert.match(text(tree.root.findByProps({ role: "alert" })), /Choose/);
      const start = api.start;
      api.start = async () => { throw new Error("offline"); };
      await act(async () => { tree.root.findAllByType("button")[team === "tabs" ? 0 : 1].props.onClick(); });
      assert.ok(session.current, "Offline entry must start immediately");
      const selected = JSON.parse(stored);
      assert.equal(selected.team, team);
      assert.equal(selected.name, legacy ? identity.name : "New Robot");
      if (legacy) assert.equal(selected.playerId, identity.playerId);
      await act(async () => { session.end(); });
      assert.equal(session.view.save, "failed");
      act(() => { session.start(); });
      assert.equal(tree.root.findAllByType("input").length, 0);
      act(() => { tree.unmount(); }); tree = undefined;
      api.start = start;
      await act(async () => { tree = create(createElement(App), { createNodeMock }); });
      assert.equal(tree.root.findAllByType("input").length, 0, "Reload must keep team");
      assert.equal(session.identity.playerId, selected.playerId);
      act(() => { tree.unmount(); }); tree = undefined;
    }
  }
  stored = null; storageFails = true;
  await act(async () => { tree = create(createElement(App), { createNodeMock }); });
  act(() => { tree.root.findByType("input").props.onChange({ target: { value: "Robot" } }); });
  await act(async () => { tree.root.findAllByType("button")[0].props.onClick(); });
  assert.equal(session.identity.team, "tabs"); assert.equal(stored, null);
  act(() => { session.start(); }); assert.equal(tree.root.findAllByType("input").length, 0);
  act(() => { tree.unmount(); }); tree = undefined;
  storageFails = false; stored = JSON.stringify(identity);
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
  assert.match(text(tree.root), /No team scores yet/);
  let resolveTeams;
  api.teams = () => new Promise(resolve => { resolveTeams = resolve; });
  await act(async () => { session.start(); session.end(); });
  assert.match(text(tree.root), /Loading team totals/);
  await act(async () => { resolveTeams({ tabs: 30, spaces: 10 }); });
  assert.match(text(tree.root.findByProps({ className: "team-labels" })), /Tabs[ ]+30.*Spaces[ ]+10/);
  const bar = tree.root.findByProps({ className: "race-bar" });
  assert.equal(bar.props["aria-hidden"], "true");
  assert.deepEqual(bar.findAllByType("span").map(span => span.props.style.width), ["75%", "25%"]);
  api.teams = async () => ({ tabs: 0, spaces: 10 });
  await act(async () => { await session.refreshTeams(session.current); });
  assert.deepEqual(tree.root.findByProps({ className: "race-bar" }).findAllByType("span").map(span => span.props.style.width), ["0%", "100%"]);
  api.teams = async () => { throw new Error("offline"); };
  await act(async () => { await session.refreshTeams(session.current); });
  assert.match(text(tree.root), /Couldn't load team totals/);
  assert.equal(tree.root.findAllByProps({ className: "race-bar" }).length, 0);
  api.teams = async () => ({ tabs: 0, spaces: 0 });
  await act(async () => { session.start(); session.end(); });
  const empty = text(tree.root.findByProps({ className: "build" }));
  assert.ok(empty.trim(), "Empty build must have explanatory text");
  assert.ok(UPGRADE_IDS.every(id => !empty.includes(UPGRADE_NAMES[id])));
  const over = tree.root.findByProps({ "aria-label": "Game over" });
  const token = session.view.token;
  act(() => { over.props.onPointerDown({ clientX: 1, clientY: 1 }); over.props.onPointerUp({ clientX: 1, clientY: 100, pointerType: "touch" }); });
  assert.equal(session.view.token, token, "Scrolling must not restart");
  const restart = over.findAllByType("button")[0];
  act(() => {
    over.props.onPointerDown({ clientX: 1, clientY: 1 });
    over.props.onPointerUp({ clientX: 1, clientY: 1, pointerType: "touch" });
    restart.props.onClick({ detail: 1 });
  });
  assert.equal(session.view.token, token + 1, "A button tap must start exactly once");
} finally { if (tree) act(() => { tree.unmount(); }); }
assert.equal(timers.size, 0, "Unmount must clear outstanding UI timers");
assert.ok(logged.length > 0, "Expected failures must be logged");
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
