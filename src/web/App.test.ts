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
const { api, RateLimitError } = await import(${moduleUrl("game/api.ts")});
const realApi = { ...api };
const { step, IDLE } = await import(${moduleUrl("game/simulation.ts")});
const { pick } = await import(${moduleUrl("game/upgrade-fixture.test-support.ts")});
const { UPGRADE_IDS, UPGRADE_NAMES } = await import(${moduleUrl("../shared/upgrades.ts")});
api.start = async () => ({ runId: "scratch-run" });
api.finish = async () => ({ saved: true });
api.teams = async () => ({ tabs: 0, spaces: 0 });
api.best = async () => ({ best: null }); api.leaders = async () => [];
let session;
mock.module(${moduleUrl("game/session.ts")}, () => ({ CHOICE_GUARD_MS: 350, Session: class extends Session {
  constructor(...args) {
    super(...args, { now: () => clock, sleep: async ms => { wait(ms); } },
      { now: () => clock, schedule: (fn, delay) => setTimeout(fn, delay), cancel: id => clearTimeout(id) });
    session = this;
  }
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
globalThis.window = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844 });
globalThis.document = Object.assign(new EventTarget(), { activeElement: null });
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
  // New moderation rules invalidate saved identities and require a fresh UUID.
  for (const name of ["fuuuck", "admin"]) {
    stored = JSON.stringify({ ...identity, name }); session = undefined;
    const previous = stored;
    await act(async () => { tree = create(createElement(App), { createNodeMock }); });
    assert.equal(session, undefined);
    const input = tree.root.findByType("input");
    assert.ok(!input.props.readOnly);
    act(() => { input.props.onChange({ target: { value: name } }); });
    act(() => { tree.root.findAllByType("button")[0].props.onClick(); });
    assert.ok(text(tree.root.findByProps({ role: "alert" })).trim());
    if (name === "admin") assert.equal(text(tree.root.findByProps({ role: "alert" })).trim(), "That name is reserved");
    assert.equal(session, undefined); assert.equal(stored, previous);
    act(() => { input.props.onChange({ target: { value: "Scunthorpe" } }); });
    await act(async () => { tree.root.findAllByType("button")[0].props.onClick(); });
    assert.ok(session.current);
    assert.equal(session.identity.name, "Scunthorpe");
    assert.notEqual(session.identity.playerId, identity.playerId);
    assert.equal(JSON.parse(stored).playerId, session.identity.playerId);
    act(() => { tree.unmount(); }); tree = undefined;
  }
  // New and legacy identities use the same one-tap entry, without network waits.
  for (const legacy of [false, true]) {
    for (const team of ["tabs", "spaces"]) {
      stored = legacy ? JSON.stringify({ playerId: identity.playerId, name: identity.name }) : null;
      session = undefined;
      await act(async () => { tree = create(createElement(App), { createNodeMock }); });
      assert.equal(session, undefined, "Entry must await a team");
      const input = tree.root.findByType("input");
      for (const [name, colour] of [["Tabs", "#ff9f43"], ["Spaces", "#2ed3c6"]]) {
        const button = tree.root.findAllByType("button").find(button => text(button).includes(name));
        assert.equal(button.props.style.background, colour, name + " entry colour");
      }
      if (legacy) { assert.equal(input.props.value, identity.name); assert.ok(input.props.readOnly); }
      else {
        act(() => { tree.root.findAllByType("button")[0].props.onClick(); });
        assert.ok(text(tree.root.findByProps({ role: "alert" })).trim(), "Name is required");
        act(() => { input.props.onChange({ target: { value: "New Robot" } }); });
      }
      act(() => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
      assert.ok(text(tree.root.findByProps({ role: "alert" })).trim());
      assert.equal(session, undefined, "Submitting without a team must stay on entry");
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
      act(() => { wait(800); session.start(); });
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
  act(() => { wait(800); session.start(); }); assert.equal(tree.root.findAllByType("input").length, 0);
  act(() => { tree.unmount(); }); tree = undefined;
  storageFails = false; stored = JSON.stringify(identity);
  await act(async () => { tree = create(createElement(App), { createNodeMock }); });
  assert.ok(session?.current, "App did not start its real Session");
  const portrait = session.current;
  assert.deepEqual(portrait.simulation.arena, { width: 450, height: 800 });
  window.innerWidth = 844; window.innerHeight = 390;
  act(() => { wait(800); session.start(); });
  assert.deepEqual(session.current.simulation.arena, { width: 800, height: 450 });
  assert.deepEqual(portrait.simulation.arena, { width: 450, height: 800 });

  // Wall-clock guards publish without input, keep their layout, and never queue a press.
  const pointerEvent = { pointerType: "touch", pointerId: 7, button: 0, clientX: 5, clientY: 5 };
  const keyEvent = key => ({ key, repeat: false, prevented: false, preventDefault() { this.prevented = true; } });
  function openChoice() {
    act(() => { wait(800); session.start(); });
    const simulation = session.current.simulation;
    simulation.time = 19.99; simulation.spawnIn = simulation.fireIn = Infinity;
    act(() => { step(simulation, IDLE, 0.02); session.publishChoice(); });
    return tree.root.findByType("dialog");
  }
  for (const key of ["Enter", " "]) {
    const dialog = openChoice(), choice = session.view.choice;
    const card = dialog.findAllByType("button")[0], group = dialog.findByProps({ className: "choice-cards" });
    assert.equal(group.props.style["--choice-guard"], "350ms");
    assert.equal(card.props["aria-disabled"], true);
    act(() => { card.props.onClick({ detail: 0 }); }); assert.equal(session.view.choice, choice);
    act(() => { card.props.onPointerDown(pointerEvent); });
    const early = keyEvent(key); act(() => { dialog.props.onKeyDown(early); });
    assert.ok(early.prevented, "Early native key activation must be suppressed");
    // Re-record the early pointer; a key may clear the previous pointer modality.
    act(() => { card.props.onPointerDown(pointerEvent); wait(349); });
    assert.equal(card.props["aria-disabled"], true);
    act(() => { wait(1); });
    assert.equal(card.props["aria-disabled"], false);
    assert.equal(dialog.findByProps({ className: "choice-cards" }), group, "Readiness must not remount the fade");
    act(() => { card.props.onPointerUp(pointerEvent); card.props.onClick({ detail: 1 }); });
    assert.equal(session.view.choice, choice, "An early down cannot activate on a late release");
    const repeat = { ...keyEvent(key), repeat: true };
    act(() => { dialog.props.onKeyDown(repeat); card.props.onClick({ detail: 0 }); });
    assert.ok(repeat.prevented); assert.equal(session.view.choice, choice);
    const up = keyEvent(key); act(() => { dialog.props.onKeyUp(up); });
    assert.ok(up.prevented, "Early Space must not generate a keyup click");
    act(() => { card.props.onPointerDown(pointerEvent); dialog.props.onPointerCancel(); card.props.onClick({ detail: 1 }); });
    assert.equal(session.view.choice, choice);
    for (const target of [window, document]) {
      act(() => { card.props.onPointerDown(pointerEvent); target.dispatchEvent(new Event(target === window ? "blur" : "visibilitychange")); card.props.onClick({ detail: 1 }); });
      assert.equal(session.view.choice, choice);
    }
    act(() => { card.props.onClick({ detail: 0 }); });
    assert.equal(session.view.choice, null); assert.equal(session.current.touch, false);
  }
  act(() => { session.end(); });
  const guardedToken = session.view.token;
  const overlay = tree.root.findByProps({ "aria-label": "Game over" });
  const controls = tree.root.findByProps({ className: "restart-controls" });
  assert.equal(controls.props.style.visibility, "hidden"); assert.equal(controls.props["aria-hidden"], true);
  assert.equal(controls.findByType("button").props.tabIndex, -1);
  assert.ok(text(overlay).includes("Score")); assert.ok(text(overlay).includes("Live top 10"));
  act(() => { overlay.props.onPointerDown(pointerEvent); controls.findByType("button").props.onClick({ detail: 0 }); wait(799); });
  assert.equal(session.view.token, guardedToken); assert.equal(controls.props.style.visibility, "hidden");
  const earlySpace = keyEvent(" "); act(() => { overlay.props.onKeyDown(earlySpace); wait(1); }); assert.ok(earlySpace.prevented);
  assert.equal(controls.props.style.visibility, "visible"); assert.equal(controls.findByType("button").props.tabIndex, 0);
  act(() => { overlay.props.onPointerUp(pointerEvent); controls.findByType("button").props.onClick({ detail: 0 }); });
  assert.equal(session.view.token, guardedToken, "Crossing readiness cannot revive pointer or keyboard activation");
  const spaceUp = keyEvent(" "); act(() => { overlay.props.onKeyUp(spaceUp); }); assert.ok(spaceUp.prevented);
  for (const cancel of [() => overlay.props.onPointerCancel(), () => window.dispatchEvent(new Event("blur")), () => document.dispatchEvent(new Event("visibilitychange"))]) {
    act(() => { overlay.props.onPointerDown(pointerEvent); cancel(); overlay.props.onPointerUp(pointerEvent); });
    assert.equal(session.view.token, guardedToken);
  }
  act(() => { overlay.props.onPointerDown(pointerEvent); overlay.props.onPointerUp({ ...pointerEvent, pointerId: 8 }); });
  assert.equal(session.view.token, guardedToken);
  act(() => { controls.findByType("button").props.onClick({ detail: 0 }); });
  assert.equal(session.view.token, guardedToken + 1);

  for (let index = 0; index < 3; index++) {
    act(() => { wait(800); session.start(); });
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
    act(() => { cards[index].props.onPointerDown({ pointerType: "touch", pointerId: 1, button: 0 }); cards[index].props.onPointerUp({ pointerId: 1 }); cards[index].props.onClick({ detail: 1 }); });
    assert.equal(session.view.choice, null, "Touch must resume the run");
    assert.deepEqual(session.view.upgrades, [{ id, count: 1 }]);
    assert.equal(session.current.touch, true);
    assert.equal(dialog.open, false, "Selecting must close the modal");
    assert.equal(document.activeElement, canvas, "Selecting must restore game focus");
  }

  act(() => { wait(800); session.start(); });
  const s = session.current.simulation;
  UPGRADE_IDS.forEach((id, index) => { for (let n = 0; n <= index; n++) pick(s, id); });
  await act(async () => { session.end(); });
  const build = text(tree.root.findByProps({ className: "build" }));
  for (const id of UPGRADE_IDS) assert.ok(build.includes(UPGRADE_NAMES[id]), "Build must name every acquired upgrade");
  assert.deepEqual(build.match(/[0-9]+/g).map(Number).sort(), [1, 2, 3, 4]);
  const race = () => tree.root.findByProps({ view: session.view });
  assert.ok(race().findAllByType("p").some(node => text(node).trim()), "An empty race needs feedback");
  let resolveTeams;
  api.teams = () => new Promise(resolve => { resolveTeams = resolve; });
  await act(async () => { wait(800); session.start(); session.end(); });
  assert.ok(text(race().findByProps({ role: "status" })).trim(), "Loading needs feedback");
  assert.equal(race().findAllByProps({ className: "team-labels" }).length, 0, "Loading cannot invent totals");
  await act(async () => { resolveTeams({ tabs: 30, spaces: 10 }); });
  const overChildren = tree.root.findByProps({ "aria-label": "Game over" }).children;
  const scoreIndex = overChildren.findIndex(node => node.props?.className === "final-score");
  assert.ok(scoreIndex >= 0);
  assert.equal(overChildren[scoreIndex + 1], race(), "The race belongs directly beneath the final score");
  const labels = tree.root.findByProps({ className: "team-labels" }).findAllByType("span");
  const bar = tree.root.findByProps({ className: "race-bar" });
  assert.equal(bar.props["aria-hidden"], "true");
  assert.deepEqual(bar.findAllByType("span").map(span => span.props.style.width), ["75%", "25%"]);
  for (const [name, colour, total] of [["Tabs", "#ff9f43", 30], ["Spaces", "#2ed3c6", 10]]) {
    const index = labels.findIndex(label => text(label).includes(name));
    assert.ok(index >= 0);
    assert.equal(text(labels[index].findByType("strong")), String(total));
    assert.equal(labels[index].props.style.color, colour, name + " label colour");
    assert.equal(bar.findAllByType("span")[index].props.style.background, colour, name + " bar colour");
  }
  api.teams = async () => ({ tabs: 0, spaces: 10 });
  await act(async () => { await session.refreshTeams(session.current); });
  assert.deepEqual(tree.root.findByProps({ className: "race-bar" }).findAllByType("span").map(span => span.props.style.width), ["0%", "100%"]);
  api.teams = async () => { throw new Error("offline"); };
  await act(async () => { await session.refreshTeams(session.current); });
  assert.ok(text(race().findByProps({ role: "status" })).trim(), "Unavailable totals need feedback");
  assert.equal(tree.root.findAllByProps({ className: "race-bar" }).length, 0);
  api.teams = async () => ({ tabs: 0, spaces: 0 });
  await act(async () => { wait(800); session.start(); session.end(); });
  const empty = text(tree.root.findByProps({ className: "build" }));
  assert.ok(empty.trim(), "Empty build must have explanatory text");
  assert.ok(UPGRADE_IDS.every(id => !empty.includes(UPGRADE_NAMES[id])));
  const normalStart = api.start;
  api.start = async () => { throw new RateLimitError(); };
  await act(async () => { wait(800); session.start(); session.end(); });
  assert.ok(tree.root.findAllByProps({ role: "status" }).some(node => text(node) === "Too many runs right now. Your next run will save."));
  assert.equal(session.view.save, "rate-limited");
  act(() => { wait(800); });
  const over = tree.root.findByProps({ "aria-label": "Game over" });
  const token = session.view.token;
  act(() => { over.props.onPointerDown({ clientX: 1, clientY: 1, pointerId: 1, button: 0 }); over.props.onPointerUp({ clientX: 1, clientY: 100, pointerType: "touch", pointerId: 1 }); });
  assert.equal(session.view.token, token, "Scrolling must not restart");
  const restart = over.findAllByType("button")[0];
  act(() => {
    over.props.onPointerDown({ clientX: 1, clientY: 1, pointerId: 1, button: 0 });
    over.props.onPointerUp({ clientX: 1, clientY: 1, pointerType: "touch", pointerId: 1 });
    restart.props.onClick({ detail: 1 });
  });
  assert.equal(session.view.token, token + 1, "A button tap must start exactly once");
  assert.equal(session.view.save, "pending");
  assert.equal(tree.root.findAllByProps({ "aria-label": "Game over" }).length, 0, "Refused starts must allow immediate restart");
  api.start = normalStart;
  act(() => { tree.unmount(); }); tree = undefined;

  // Two independent entry screens share storage and an actual teamless server player.
  // Also recover identities already poisoned by an older version, including offline reload.
  Object.assign(api, realApi);
  const { openDb } = await import(${moduleUrl("../server/db.ts")});
  const { createApp } = await import(${moduleUrl("../server/app.ts")});
  let serverTime = 1000;
  const db = openDb(":memory:"), server = createApp(db, { now: () => serverTime });
  const playerId = crypto.randomUUID(), name = "Legacy Robot";
  db.query("INSERT INTO players(id, name, name_key) VALUES (?, ?, ?)").run(playerId, name, name.toLowerCase());
  let offline = false;
  const statuses = [];
  globalThis.fetch = async (path, init) => {
    if (offline) throw new Error("offline");
    const response = await server.request(path, init);
    if (path === "/api/runs") statuses.push(response.status);
    return response;
  };
  let firstTab;
  try {
    stored = JSON.stringify({ playerId, name });
    await act(async () => { firstTab = create(createElement(App), { createNodeMock }); tree = create(createElement(App), { createNodeMock }); });
    await act(async () => { firstTab.root.findAllByType("button")[0].props.onClick(); });
    await act(async () => { tree.root.findAllByType("button")[1].props.onClick(); });
    assert.deepEqual(statuses, [201, 409, 201], "A conflicting choice must retry with the stored team");
    const authoritative = { playerId, name, team: "tabs" };
    assert.deepEqual(session.identity, authoritative);
    assert.deepEqual(JSON.parse(stored), authoritative);
    session.current.simulation.seconds = session.current.simulation.score = 1;
    serverTime += 1000;
    await act(async () => { session.end(); });
    assert.equal(session.view.save, "saved");
    assert.deepEqual(await realApi.teams(), { tabs: 1, spaces: 0 });
    act(() => { firstTab.unmount(); tree.unmount(); }); firstTab = tree = undefined;

    stored = JSON.stringify({ ...authoritative, team: "spaces" }); offline = true;
    await act(async () => { tree = create(createElement(App), { createNodeMock }); });
    assert.ok(session.current, "A conflicted identity still plays offline");
    assert.equal(tree.root.findAllByType("input").length, 0, "Recovery must not ask for another selection");
    offline = false;
    await act(async () => { wait(800); session.start(); });
    assert.deepEqual(session.identity, authoritative);
    assert.deepEqual(JSON.parse(stored), authoritative);
    act(() => { tree.unmount(); }); tree = undefined;

    stored = JSON.stringify({ ...authoritative, team: "spaces" });
    await act(async () => { tree = create(createElement(App), { createNodeMock }); });
    assert.deepEqual(session.identity, authoritative, "Online reload must recover an already-conflicted identity");
    assert.deepEqual(JSON.parse(stored), authoritative);
    session.current.simulation.seconds = session.current.simulation.score = 1;
    serverTime += 1000;
    await act(async () => { session.end(); });
    assert.equal(session.view.save, "saved");
    assert.deepEqual(await realApi.teams(), { tabs: 2, spaces: 0 });
    assert.deepEqual(db.query("SELECT id, team FROM players").all(), [{ id: playerId, team: "tabs" }]);
  } finally {
    if (firstTab) act(() => { firstTab.unmount(); });
    if (tree) act(() => { tree.unmount(); }); tree = undefined;
    db.close();
  }
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
