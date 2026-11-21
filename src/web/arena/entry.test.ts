import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
test("arena entry validates names, reuses legacy/saved identities, restores teams and disposes the game", () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-entry-")), home = join(scratch, "home"); mkdirSync(home);
  const moduleUrl = (file: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, file)).href);
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createElement } from ${JSON.stringify(import.meta.resolve("react"))};
import { create, act } from ${JSON.stringify(import.meta.resolve("react-test-renderer"))};
let mounted = 0, disposed = 0, onError, onAccepted, onLife, onStatus, joined;
mock.module(${moduleUrl("engine.ts")}, () => ({ mountArena: (canvas, identity, touch, status, refused, accepted, lifeView) => {
  mounted++; onError = refused; onAccepted = accepted; onLife = lifeView; onStatus = status; joined = { identity, touch }; return () => { disposed++; };
} }));
mock.module(${moduleUrl("../entry/StartScene.tsx")}, () => ({ StartScene: () => null }));
globalThis.window = new EventTarget(); globalThis.document = new EventTarget();
const { api } = await import(${moduleUrl("../api.ts")});
let serverBest = 9876;
const requests = { best: [], standing: [] };
api.best = async playerId => { requests.best.push(playerId); assert.equal(playerId, joined.identity.playerId); return { best: serverBest }; };
api.standing = async playerId => { requests.standing.push(playerId); assert.equal(playerId, joined.identity.playerId); return { rank: 2, total: 12, next: { rank: 1, pointsToBeat: 765 } }; };
api.teams = async () => ({ tabs: 54321, spaces: 87654 });
let saved = null;
globalThis.localStorage = { getItem: () => saved, setItem: (key, value) => { assert.equal(key, "bug-swarm-player"); saved = value; } };
const { Arena } = await import(${moduleUrl("Arena.tsx")});
const { HIDDEN_IDENTITY_MESSAGE } = await import(${moduleUrl("../../shared/arena/protocol.ts")});
const unavailable = "That name isn't allowed.";
const alertText = () => tree.root.findByProps({ role: "alert" }).children.join("");
let tree;
for (const kind of ["new", "legacy", "returning"]) for (const team of ["tabs", "spaces"]) {
  const id = crypto.randomUUID(); saved = kind === "new" ? null : JSON.stringify({ playerId: id, name: "Robot", ...(kind === "returning" ? { team } : {}) });
  const original = saved;
  const mount = () => act(() => { tree = create(createElement(Arena), { createNodeMock: () => ({ focus() {} }) }); });
  const choose = () => act(() => { if (tree.root.findAllByType("button").length === 1) tree.root.findByType("form").props.onSubmit({ preventDefault() {} }); else tree.root.findAllByType("button").find(b => b.children.join("").toLowerCase().includes(team)).props.onClick(); });
  mount();
  assert.equal(mounted, disposed, "Entry connected before a tap");
  assert.equal(tree.root.findAllByType("button").length, kind === "returning" ? 1 : 2);
  if (kind === "new") {
    act(() => tree.root.findAllByType("button")[0].props.onClick());
    assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 1);
    act(() => tree.root.findByType("input").props.onChange({ target: { value: "<script>" } }));
    act(() => tree.root.findAllByType("button")[0].props.onClick()); assert.equal(mounted, disposed);
    act(() => tree.root.findByType("input").props.onChange({ target: { value: "Robot" } }));
  } else if (kind === "legacy") assert.equal(tree.root.findByType("input").props.readOnly, true);
  act(() => tree.root.findByType("main").props.onPointerDown({ pointerType: "touch" }));
  choose();
  assert.equal(mounted, disposed + 1); assert.equal(joined.touch, true); assert.equal(joined.identity.team, team);
  assert.equal(saved, original, "An attempt must not persist before welcome");
  if (kind !== "new") assert.equal(joined.identity.playerId, id);
  let acceptedName = "Robot";
  if (kind === "new") {
    act(() => onError(unavailable, undefined, "name-hidden"));
    assert.equal(alertText(), unavailable, "A fresh editable attempt keeps correction guidance");
    assert.equal(saved, null); assert.equal(tree.root.findByType("input").props.readOnly, false);
    assert.equal(tree.root.findByType("input").props.value, "Robot", "Refusal preserves the editable draft");
    assert.equal(tree.root.findAllByType("button").length, 2);
    // Reload after refusal: no rejected identity may survive in storage.
    act(() => tree.unmount()); mount();
    assert.equal(tree.root.findByType("input").props.readOnly, false);
    acceptedName = "AllowedRobot";
    act(() => tree.root.findByType("input").props.onChange({ target: { value: acceptedName } })); choose();
    assert.equal(joined.identity.team, team); assert.equal(saved, null);
  }
  act(() => onAccepted());
  assert.deepEqual(JSON.parse(saved), { playerId: joined.identity.playerId, name: acceptedName, team });
  const playCanvas = tree.root.findByType("canvas"), beforeFeedback = mounted;
  for (const feedback of ["Reconnecting…", "Score saved: 142. Rejoining…", "Score save failed. Rejoining…"]) {
    act(() => onStatus(feedback));
    const status = tree.root.findByProps({ role: "status" });
    assert.equal(status.children.join(""), feedback, "Connection feedback must be rendered");
    assert.equal(status.props.hidden, undefined); assert.notEqual(status.props.style?.display, "none");
    assert.equal(tree.root.findByType("canvas"), playCanvas, "Feedback must retain the mounted canvas");
    assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0, "Reconnect feedback must not be modal");
    assert.equal(mounted, beforeFeedback);
  }
  act(() => onStatus("")); assert.equal(tree.root.findAllByProps({ role: "status" }).length, 0);
  if (kind === "new" && team === "tabs") {
    const respawns = [];
    const show = (life, save) => onLife({ life, score: 4321, save }, touch => respawns.push(touch));
    await act(async () => show(1, "saved"));
    const text = node => typeof node === "string" ? node : node.children.map(text).join("");
    const numbers = node => (text(node).match(/[0-9][0-9,]*/g) ?? []).map(value => Number(value.replaceAll(",", "")));
    const overlay = () => tree.root.findByProps({ role: "dialog" });
    const summary = () => overlay().findByProps({ className: "arena-life-content" }).children[0];
    const best = () => summary().findAllByType("p")[1];
    assert.deepEqual(numbers(overlay().findByProps({ className: "life-score" })), [4321], "Life score comes from this life");
    assert.deepEqual(numbers(best()), [9876], "Best comes from the server rather than the life score");
    const standing = overlay().findByProps({ className: "personal-standing" }).findAllByType("p");
    assert.deepEqual(numbers(standing[0]), [2, 12], "Rank and population come from the server");
    assert.deepEqual(numbers(standing.at(-1)), [765, 1], "Next-rank gap and target come from the server, including inside the top ten");
    const teams = overlay().findByProps({ className: "team-labels" }).findAllByType("span");
    assert.deepEqual(teams.map(numbers), [[54321], [87654]], "Both team totals come from the server");
    assert.deepEqual(requests, { best: [joined.identity.playerId], standing: [joined.identity.playerId] });
    const down = { pointerType: "touch", button: 0, pointerId: 1, clientX: 20, clientY: 20 };
    act(() => overlay().props.onPointerUp(down)); assert.deepEqual(respawns, []);
    act(() => overlay().props.onPointerDown(down)); assert.deepEqual(respawns, []);
    act(() => overlay().props.onPointerCancel()); act(() => overlay().props.onPointerUp(down)); assert.deepEqual(respawns, []);
    act(() => overlay().props.onPointerDown(down));
    act(() => overlay().props.onPointerMove({ ...down, clientY: 50 }));
    act(() => overlay().props.onPointerUp(down)); assert.deepEqual(respawns, [], "Scrolling back must not replay");
    act(() => overlay().props.onPointerDown(down)); act(() => overlay().props.onPointerUp(down));
    assert.deepEqual(respawns, [true], "A fresh tap must retain touch attribution");
    act(() => tree.root.findByType("button").props.onClick({ detail: 1 })); assert.deepEqual(respawns, [true]);
    act(() => tree.root.findByType("button").props.onClick({ detail: 0 })); assert.deepEqual(respawns, [true, false], "Accessible activation works");
    // A save acknowledgement can arrive while a replay tap is held down.
    let savedFeedback;
    for (const [index, save] of ["saved", "failed"].entries()) {
      const life = index + 2, count = respawns.length;
      serverBest = null;
      await act(async () => show(life, "pending"));
      const pendingFeedback = text(summary().findByProps({ role: "status" }));
      assert.ok(pendingFeedback.trim(), "Pending saves expose status feedback");
      const loadingBest = text(best());
      act(() => overlay().props.onPointerDown(down));
      await act(async () => show(life, save));
      const terminalFeedback = text(summary().findByProps({ role: "status" }));
      assert.ok(terminalFeedback.trim(), "Acknowledgements expose status feedback");
      assert.notEqual(terminalFeedback, pendingFeedback, "Saved and failed results must leave pending feedback");
      if (save === "saved") savedFeedback = terminalFeedback;
      else assert.notEqual(terminalFeedback, savedFeedback, "Save failure feedback must differ from success");
      assert.notEqual(text(best()), loadingBest, "Best read leaves loading even when no best exists");
      assert.deepEqual(numbers(best()), [], "A null best must not fabricate a score");
      act(() => overlay().props.onPointerUp(down));
      assert.equal(respawns.length, count + 1, save + " acknowledgement must preserve the in-progress tap");
      assert.equal(respawns.at(-1), true, "Acknowledgements preserve touch attribution");
      act(() => overlay().props.onPointerUp(down));
      assert.equal(respawns.length, count + 1, "Each tap requests just one respawn");
    }
    serverBest = 9876;
    // Replacing or removing the overlay really does invalidate the gesture.
    for (const replace of [() => show(5, "pending"), () => { onLife(null, () => {}); show(4, "pending"); }]) {
      act(() => show(4, "pending"));
      act(() => overlay().props.onPointerDown(down));
      const count = respawns.length;
      act(replace); act(() => overlay().props.onPointerUp(down));
      assert.equal(respawns.length, count, "A replacement overlay must not inherit an old tap, even with a reused life number");
    }
    for (const cancel of [() => window.dispatchEvent(new Event("blur")), () => document.dispatchEvent(new Event("visibilitychange"))]) {
      act(() => overlay().props.onPointerDown(down));
      const count = respawns.length;
      act(cancel); act(() => overlay().props.onPointerUp(down));
      assert.equal(respawns.length, count, "Losing foreground cancels the tap");
    }
    act(() => onLife(null, () => {})); assert.equal(tree.root.findAllByProps({ role: "dialog" }).length, 0);
  }
  const restoredTeam = team === "tabs" ? "spaces" : "tabs";
  const before = mounted; act(() => onError("Saved team restored", restoredTeam));
  assert.equal(JSON.parse(saved).team, restoredTeam); assert.equal(mounted, before, "Team correction remounted a live connection");
  act(() => onError("This player is already in an arena."));
  assert.equal(mounted, disposed); assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 1);
  assert.equal(tree.root.findAllByType("input").length, 0, "An accepted name stays fixed after refusal");
  choose();
  act(() => onAccepted());
  act(() => onError(unavailable, undefined, "name-hidden"));
  assert.equal(alertText(), HIDDEN_IDENTITY_MESSAGE, "Live removal must explain the saved identity rule");
  assert.equal(tree.root.findAllByType("input").length, 0);
  act(() => tree.unmount()); assert.equal(mounted, disposed);
  mount(); assert.equal(tree.root.findAllByType("input").length, 0);
  assert.equal(tree.root.findByProps({ className: "entry-player" }).findByType("strong").children.join(""), acceptedName);
  assert.equal(tree.root.findAllByType("button").length, 1);
  const persisted = saved;
  choose();
  // A saved identity can be refused before welcome too; it must receive the same rule.
  act(() => onError(unavailable, undefined, "name-hidden"));
  assert.equal(alertText(), HIDDEN_IDENTITY_MESSAGE); assert.equal(saved, persisted);
  assert.equal(tree.root.findAllByType("input").length, 0);
  act(() => tree.unmount());
}
const { resumeStore } = await import(${moduleUrl("resume.ts")});
let resumeRaw = null;
globalThis.sessionStorage = { getItem: () => resumeRaw, setItem: (key, value) => { resumeRaw = value; } };
const resumed = { playerId: crypto.randomUUID(), name: "Resumed", team: "spaces" };
resumeStore.write({ identity: resumed, touch: true, target: "new-build", attempted: ["new-build"], resume: true });
act(() => { tree = create(createElement(Arena), { createNodeMock: () => ({ focus() {} }) }); });
assert.equal(tree.root.findAllByType("canvas").length, 1, "Reload must enter the play view without Join");
assert.deepEqual(joined, { identity: resumed, touch: true });
assert.equal(JSON.parse(resumeRaw).resume, false);
act(() => tree.unmount());
act(() => { tree = create(createElement(Arena), { createNodeMock: () => ({ focus() {} }) }); });
assert.equal(tree.root.findAllByType("button").length, 1, "An ordinary later visit still uses Play");
act(() => tree.unmount());
globalThis.history = { state: {}, replaceState(value) { this.state = value; } };
globalThis.sessionStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
const envelope = { identity: resumed, touch: true, target: "fallback", attempted: ["fallback"], resume: true };
assert.equal(resumeStore.write(envelope), true); assert.equal(resumeStore.read().target, "fallback");
const stalePrimary = JSON.stringify(resumeStore.read());
globalThis.sessionStorage.getItem = () => stalePrimary;
assert.equal(resumeStore.write({ ...envelope, target: "later", attempted: ["fallback", "later"] }), true);
assert.equal(resumeStore.read().target, "later", "Stale readable primary must not shadow the newer fallback guard");
globalThis.sessionStorage.getItem = () => { throw Error("blocked"); };
globalThis.history.state = { "bug-swarm-arena-reload-v1": { ...envelope, identity: { ...resumed, playerId: "invalid" } } };
assert.equal(resumeStore.read(), null, "Invalid stored identities cannot resume");
globalThis.history.replaceState = () => { throw Error("blocked"); };
const originalError = console.error; console.error = () => {};
assert.equal(resumeStore.write(envelope), false); console.error = originalError;
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], { cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
