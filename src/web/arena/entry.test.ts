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
let mounted = 0, disposed = 0, onError, joined;
mock.module(${moduleUrl("engine.ts")}, () => ({ mountArena: (canvas, identity, touch, status, refused) => {
  mounted++; onError = refused; joined = { identity, touch }; return () => { disposed++; };
} }));
let saved = null;
globalThis.localStorage = { getItem: () => saved, setItem: (key, value) => { assert.equal(key, "bug-swarm-player"); saved = value; } };
const { Arena } = await import(${moduleUrl("Arena.tsx")});
for (const kind of ["new", "legacy", "returning"]) {
  const id = crypto.randomUUID(); saved = kind === "new" ? null : JSON.stringify({ playerId: id, name: "Robot", ...(kind === "returning" ? { team: "tabs" } : {}) });
  let tree; act(() => { tree = create(createElement(Arena), { createNodeMock: () => ({}) }); });
  assert.equal(mounted, disposed, "Entry connected before a tap");
  assert.equal(tree.root.findAllByType("button").length, kind === "returning" ? 1 : 2);
  if (kind === "new") {
    act(() => tree.root.findAllByType("button")[0].props.onClick());
    assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 1);
    act(() => tree.root.findByType("input").props.onChange({ target: { value: "<script>" } }));
    act(() => tree.root.findAllByType("button")[0].props.onClick()); assert.equal(mounted, disposed);
    act(() => tree.root.findByType("input").props.onChange({ target: { value: "Robot" } }));
  } else assert.equal(tree.root.findByType("input").props.readOnly, true);
  act(() => tree.root.findByType("form").props.onPointerDown({ pointerType: "touch" }));
  act(() => tree.root.findAllByType("button")[0].props.onClick());
  assert.equal(mounted, disposed + 1); assert.equal(joined.touch, true); assert.equal(joined.identity.team, "tabs");
  if (kind !== "new") assert.equal(joined.identity.playerId, id);
  const before = mounted; act(() => onError("Saved team restored", "spaces"));
  assert.equal(JSON.parse(saved).team, "spaces"); assert.equal(mounted, before, "Team correction remounted a live connection");
  act(() => onError("This player is already in an arena."));
  assert.equal(mounted, disposed); assert.equal(tree.root.findAllByProps({ role: "alert" }).length, 1);
  act(() => tree.unmount()); assert.equal(mounted, disposed);
}
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], { cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
