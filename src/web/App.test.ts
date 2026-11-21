import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
api.finish = async () => ({ saved: true, held: false });
api.teams = async () => ({ tabs: 0, spaces: 0 });
api.standing = async () => ({ rank: null, total: 0, next: null });
api.best = async () => ({ best: null }); api.leaders = async () => [];
let session, movement;
mock.module(${moduleUrl("game/session.ts")}, () => ({ CHOICE_GUARD_MS: 350, Session: class extends Session {
  constructor(...args) {
    super(...args, { now: () => clock, sleep: async ms => { wait(ms); } },
      { now: () => clock, schedule: (fn, delay) => setTimeout(fn, delay), cancel: id => clearTimeout(id) });
    session = this;
  }
} }));
mock.module(${moduleUrl("entry/StartScene.tsx")}, () => ({ StartScene: () => null }));
mock.module(${moduleUrl("game/engine.ts")}, () => ({ mountGame: (_canvas, _session, _hud, _debug, observer) => {
  movement = observer; return () => { movement = undefined; };
} }));

// Execute both timeout and interval callbacks, so an accidental auto-pick
// cannot hide behind an unexecuted timer. Gameplay still uses simulation time.
let clock = 0, nextTimer = 0;
performance.now = () => clock;
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
const values = new Map([["bug-swarm-player", JSON.stringify(identity)]]);
const saved = { get identity() { return values.get("bug-swarm-player") ?? null; }, set identity(value) { if (value === null) values.delete("bug-swarm-player"); else values.set("bug-swarm-player", value); } };
let storageFails = false;
globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => {
  if (storageFails) throw new Error("disabled"); values.set(key, value);
} };
const touch = ["true", "entry"].includes(process.env.HINT_TOUCH);
globalThis.window = Object.assign(new EventTarget(), { innerWidth: 390, innerHeight: 844,
  ...(process.env.HINT_TOUCH === "fallback" ? {} : { matchMedia: () => ({ matches: process.env.HINT_TOUCH === "true" }) }) });
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
  // New and legacy identities use the same one-tap entry, without network waits.
  for (const legacy of [false, true]) {
    for (const team of ["tabs", "spaces"]) {
      saved.identity = legacy ? JSON.stringify({ playerId: identity.playerId, name: identity.name }) : null;
      session = undefined;
      await act(async () => { tree = create(createElement(App), { createNodeMock }); });
      assert.equal(session, undefined, "Entry must await a team");
      assert.equal(values.has("bug-swarm-steering-hint-seen"), legacy || team === "spaces");
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
      assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 0);
      assert.equal(session, undefined, "Submitting without a team must stay on entry");
      const start = api.start;
      api.start = async () => { throw new Error("offline"); };
      if (process.env.HINT_TOUCH === "entry") act(() => { tree.root.findByProps({ className: "entry" }).props.onPointerDown({ pointerType: "touch" }); });
      await act(async () => { tree.root.findAllByType("button")[team === "tabs" ? 0 : 1].props.onClick(); });
      assert.ok(session.current, "Offline entry must start immediately");
      const hints = tree.root.findAllByProps({ className: "steering-hint" });
      if (!legacy && team === "tabs") {
        assert.equal(hints.length, 1);
        if (touch) assert.equal(text(hints[0]), "Drag anywhere to move");
        else assert.ok(text(hints[0]).trim());
        assert.equal(hints[0].parent.props.className, "surface");
        assert.equal(hints[0].props.role, "status"); assert.equal(hints[0].props.tabIndex, undefined);
        assert.equal(values.get("bug-swarm-steering-hint-seen"), "1");
        if (touch) act(() => { movement.moved(session.view.token); });
        else {
          act(() => { wait(3999); }); assert.equal(tree.root.findAllByProps({ className: "steering-hint" }).length, 1);
          act(() => { wait(1); });
        }
        assert.equal(tree.root.findAllByProps({ className: "steering-hint" }).length, 0);
      } else assert.equal(hints.length, 0);
      const selected = JSON.parse(saved.identity);
      assert.equal(selected.team, team);
      assert.equal(selected.name, legacy ? identity.name : "New Robot");
      if (legacy) assert.equal(selected.playerId, identity.playerId);
      await act(async () => { session.end(); });
      assert.equal(session.view.save, "failed");
      act(() => { wait(800); session.start(); });
      assert.equal(tree.root.findAllByProps({ className: "steering-hint" }).length, 0, "Restart must not rearm");
      assert.equal(tree.root.findAllByType("input").length, 0);
      act(() => { tree.unmount(); }); tree = undefined;
      api.start = start;
      session = undefined;
      await act(async () => { tree = create(createElement(App), { createNodeMock }); });
      assert.equal(tree.root.findAllByType("input").length, 0, "Reload must keep team");
      assert.equal(session, undefined, "Saved entry must not construct Session");
      assert.ok(text(tree.root.findByProps({ className: "entry-player" })).includes(selected.name));
      await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
      assert.equal(session.identity.playerId, selected.playerId);
      assert.equal(tree.root.findAllByProps({ className: "steering-hint" }).length, 0, "Reload must not rearm");
      act(() => { tree.unmount(); }); tree = undefined;
    }
  }
  // New moderation rules invalidate saved identities and require a fresh UUID.
  for (const name of ["fuuuck", "admin"]) {
    saved.identity = JSON.stringify({ ...identity, name }); session = undefined;
    const previous = saved.identity;
    await act(async () => { tree = create(createElement(App), { createNodeMock }); });
    assert.equal(session, undefined);
    const input = tree.root.findByType("input");
    assert.ok(!input.props.readOnly);
    act(() => { input.props.onChange({ target: { value: name } }); });
    act(() => { tree.root.findAllByType("button")[0].props.onClick(); });
    assert.ok(text(tree.root.findByProps({ role: "alert" })).trim());
    if (name === "admin") assert.equal(text(tree.root.findByProps({ role: "alert" })).trim(), "Pick a different name.");
    assert.equal(session, undefined); assert.equal(saved.identity, previous);
    act(() => { input.props.onChange({ target: { value: "Scunthorpe" } }); });
    await act(async () => { tree.root.findAllByType("button")[0].props.onClick(); });
    assert.ok(session.current);
    assert.equal(session.identity.name, "Scunthorpe");
    assert.notEqual(session.identity.playerId, identity.playerId);
    assert.equal(JSON.parse(saved.identity).playerId, session.identity.playerId);
    act(() => { tree.unmount(); }); tree = undefined;
  }
  saved.identity = null; storageFails = true;
  await act(async () => { tree = create(createElement(App), { createNodeMock }); });
  act(() => { tree.root.findByType("input").props.onChange({ target: { value: "Robot" } }); });
  await act(async () => { tree.root.findAllByType("button")[0].props.onClick(); });
  assert.equal(session.identity.team, "tabs"); assert.equal(saved.identity, null);
  act(() => { wait(800); session.start(); }); assert.equal(tree.root.findAllByType("input").length, 0);
  act(() => { tree.unmount(); }); tree = undefined;
  storageFails = false; saved.identity = JSON.stringify(identity); session = undefined;
  values.delete("bug-swarm-steering-hint-seen");
  await act(async () => { tree = create(createElement(App), { createNodeMock }); });
  assert.equal(session, undefined);
  assert.equal(values.has("bug-swarm-steering-hint-seen"), false, "Saved entry must not consume hint");
  if (process.env.HINT_TOUCH === "entry") act(() => { tree.root.findByProps({ className: "entry" }).props.onPointerDown({ pointerType: "touch" }); });
  await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
  assert.ok(session?.current, "Play must start its real Session");
  assert.equal(session.current.touch, process.env.HINT_TOUCH === "entry");
  act(() => { movement.moved(session.view.token); });
  const phase = () => tree.root.findByProps({ className: "game" }).props["data-phase"];
  assert.equal(phase(), "playing");
  const portrait = session.current;
  assert.deepEqual(portrait.simulation.arena, { width: 450, height: 800 });
  window.innerWidth = 844; window.innerHeight = 390;
  act(() => { wait(800); session.start(); });
  assert.deepEqual(session.current.simulation.arena, { width: 800, height: 450 });
  assert.deepEqual(portrait.simulation.arena, { width: 450, height: 800 });

  api.finish = async () => ({ saved: true, held: true });
  session.current.simulation.score = 13800;
  await act(async () => { session.end(); });
  assert.equal(text(tree.root.findByProps({ role: "status" })), "Under review");
  assert.ok(text(tree.root.findByProps({ "aria-label": "Game over" })).includes("13,800"));
  act(() => { wait(800); });
  assert.ok(tree.root.findAllByType("button").some(button => text(button).includes("Play again")));
  api.finish = async () => ({ saved: true, held: false });

  await act(async () => { wait(2000); });
  assert.equal(text(tree.root.findByProps({ role: "status" })), "Score saved");

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
    assert.equal(phase(), "choice");
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
    assert.equal(phase(), "playing");
    assert.deepEqual(session.view.upgrades, [{ id, count: 1 }]);
    assert.equal(session.current.touch, true);
    assert.equal(dialog.open, false, "Selecting must close the modal");
    assert.equal(document.activeElement, canvas, "Selecting must restore game focus");
  }

  act(() => { wait(800); session.start(); });
  const s = session.current.simulation;
  UPGRADE_IDS.forEach((id, index) => { for (let n = 0; n <= index; n++) pick(s, id); });
  await act(async () => { session.end(); });
  assert.equal(phase(), "over");
  const build = text(tree.root.findByProps({ className: "build" }));
  for (const id of UPGRADE_IDS) assert.ok(build.includes(UPGRADE_NAMES[id]), "Build must name every acquired upgrade");
  assert.deepEqual(build.match(/[0-9]+/g).map(Number).sort(), [1, 2, 3, 4]);
  // Best belongs to the summary for every server state, alongside replay.
  const bestSummary = () => tree.root.findByProps({ className: "over-summary" }).findAllByType("p").find(node => text(node).startsWith("Best:"));
  assert.ok(text(bestSummary()).includes("No saved runs yet"), "Best belongs in the summary");
  const readBest = api.best;
  api.best = async () => ({ best: 4321 });
  await act(async () => { await session.refreshBest(session.current); });
  assert.ok(text(bestSummary()).includes("4,321"), "Best must show the server value in the summary");
  api.best = async () => { throw new Error("offline"); };
  await act(async () => { await session.refreshBest(session.current); });
  assert.ok(text(bestSummary()).includes("Unavailable"));
  let resolveBest;
  api.best = () => new Promise(resolve => { resolveBest = resolve; });
  const race = () => tree.root.find(node => typeof node.type === "function" && node.type.name === "TeamRace");
  assert.ok(race().findAllByType("p").some(node => text(node).trim()), "An empty race needs feedback");
  let resolveTeams;
  api.teams = () => new Promise(resolve => { resolveTeams = resolve; });
  await act(async () => { wait(800); session.start(); session.end(); });
  assert.ok(text(bestSummary()).includes("Loading"));
  await act(async () => { resolveBest({ best: null }); });
  assert.ok(text(bestSummary()).includes("No saved runs yet"));
  api.best = readBest;
  const summary = () => text(tree.root.findByProps({ className: "over-summary" })).replace(/ +/g, " ");
  assert.ok(summary().includes("Not ranked"));
  for (const [rank, gap] of [[1, null], [10, 1], [11, 1], [37, 120], [1001, 466548]]) {
    api.standing = async () => ({ rank, total: 1234, next: rank === 1 ? null : { rank: rank - 1, pointsToBeat: gap } });
    await act(async () => { await session.refreshStanding(session.current); });
    assert.ok(summary().includes("Your best is # " + rank.toLocaleString("en-US") + " of 1,234"));
    if (rank <= 10) assert.ok(summary().includes("You're in the top 10!"));
    else assert.ok(summary().includes(gap.toLocaleString("en-US") + " " + (gap === 1 ? "point" : "points") + " to beat # " + (rank - 1).toLocaleString("en-US")));
  }
  api.leaders = async () => [
    { playerId: "duplicate", name: "WWWWWWWWWWWWWWWW", score: 466548 },
    { playerId: session.identity.playerId, name: "WWWWWWWWWWWWWWWW", score: 466548 },
  ];
  await act(async () => { await session.refreshLeaders(session.current); });
  const rows = tree.root.findAllByType("li");
  assert.equal(rows[0].props["aria-current"], undefined);
  assert.equal(rows[1].props["aria-current"], "true");
  assert.equal(text(rows[1].findByType("strong")), "466,548");
  assert.equal(text(rows[1].findByProps({ className: "leader-name" })), "WWWWWWWWWWWWWWWW");
  api.leaders = async () => [];
  await act(async () => { await session.refreshLeaders(session.current); });
  assert.equal(tree.root.findAllByProps({ "aria-current": "true" }).length, 0);
  api.standing = async () => { throw new Error("ranking offline"); };
  await act(async () => { await session.refreshStanding(session.current); });
  assert.ok(summary().includes("Ranking unavailable"));
  api.standing = () => new Promise(() => {});
  await act(async () => { wait(800); session.start(); session.current.simulation.score = 466548; session.end(); });
  assert.ok(summary().includes("Loading ranking…"));
  assert.ok(summary().includes("466,548"));
  await act(async () => { wait(800); session.restart(session.view.token); session.end(); });
  assert.ok(summary().includes("Loading ranking…"));
  api.standing = async () => ({ rank: null, total: 0, next: null });

  assert.ok(text(race().findByProps({ role: "status" })).trim(), "Loading needs feedback");
  assert.equal(race().findAllByProps({ className: "team-labels" }).length, 0, "Loading cannot invent totals");
  await act(async () => { resolveTeams({ tabs: 30, spaces: 10 }); });
  const overChildren = tree.root.findByProps({ className: "over-summary" }).children;
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
  api.teams = async () => ({ tabs: 466548, spaces: 123456 });
  await act(async () => { await session.refreshTeams(session.current); });
  assert.deepEqual(tree.root.findByProps({ className: "team-labels" }).findAllByType("strong").map(text), ["466,548", "123,456"]);
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
  assert.equal(phase(), "playing");
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
    saved.identity = JSON.stringify({ playerId, name });
    await act(async () => { firstTab = create(createElement(App), { createNodeMock }); tree = create(createElement(App), { createNodeMock }); });
    await act(async () => { firstTab.root.findAllByType("button")[0].props.onClick(); });
    await act(async () => { tree.root.findAllByType("button")[1].props.onClick(); });
    assert.deepEqual(statuses, [201, 409, 201], "A conflicting choice must retry with the stored team");
    const authoritative = { playerId, name, team: "tabs" };
    assert.deepEqual(session.identity, authoritative);
    assert.deepEqual(JSON.parse(saved.identity), authoritative);
    session.current.simulation.seconds = session.current.simulation.score = 1;
    serverTime += 1000;
    await act(async () => { session.end(); });
    assert.equal(session.view.save, "saved");
    assert.deepEqual(await realApi.teams(), { tabs: 1, spaces: 0 });
    act(() => { firstTab.unmount(); tree.unmount(); }); firstTab = tree = undefined;

    saved.identity = JSON.stringify({ ...authoritative, team: "spaces" }); offline = true;
    await act(async () => { tree = create(createElement(App), { createNodeMock }); });
    await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    assert.ok(session.current, "A conflicted identity still plays offline");
    assert.equal(tree.root.findAllByType("input").length, 0, "Recovery must not ask for another selection");
    offline = false;
    await act(async () => { wait(800); session.start(); });
    assert.deepEqual(session.identity, authoritative);
    assert.deepEqual(JSON.parse(saved.identity), authoritative);
    act(() => { tree.unmount(); }); tree = undefined;

    saved.identity = JSON.stringify({ ...authoritative, team: "spaces" });
    await act(async () => { tree = create(createElement(App), { createNodeMock }); });
    await act(async () => { tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); });
    assert.deepEqual(session.identity, authoritative, "Online reload must recover an already-conflicted identity");
    assert.deepEqual(JSON.parse(saved.identity), authoritative);
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
  const probePath = join(scratch, "app-probe.mjs");
  writeFileSync(probePath, probe);
  try {
    for (const touch of ["false", "true", "entry", "fallback"]) {
      const child = Bun.spawnSync([process.execPath, probePath], {
        cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home,
          APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"),
          XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), DATA_DIR: join(scratch, "data"), HINT_TOUCH: touch },
        stdout: "pipe", stderr: "pipe", timeout: 10_000,
      });
      expect(child.exitCode, child.stderr.toString()).toBe(0);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 15_000);
