import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("entry validates attempts, preserves explicit team choice, and supports saved and touch entry", () => {
  const scratch = mkdtempSync(join(tmpdir(), "start-screen-test-")), home = join(scratch, "home");
  mkdirSync(home);
  const url = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, path)).href);
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
const { createElement } = await import(${JSON.stringify(import.meta.resolve("react"))});
const { create, act } = await import(${JSON.stringify(import.meta.resolve("react-test-renderer"))});
mock.module(${url("StartScene.tsx")}, () => ({ StartScene: () => null }));
const { StartScreen } = await import(${url("StartScreen.tsx")});
let tree, focused;
const starts = [];
const text = node => typeof node === "object" ? node.children.map(text).join("") : String(node);
const mount = async savedIdentity => {
  starts.length = 0;
  await act(async () => { tree = create(createElement(StartScreen, { savedIdentity, onStart: value => starts.push(value) }), {
    createNodeMock: element => ({ focus() { focused = element.type; } })
  }); });
};
const change = value => act(() => tree.root.findByType("input").props.onChange({ target: { value } }));
const click = index => act(() => tree.root.findAllByType("button")[index].props.onClick());
const submit = () => act(() => tree.root.findByType("form").props.onSubmit({ preventDefault() {} }));
const alerts = () => tree.root.findAllByProps({ role: "alert" });
await mount(null);
assert.equal(text(tree.root.findByType("h1")), "Bug Swarm");
assert.equal(text(tree.root.findByProps({ className: "entry-tagline" })), "Survive the swarm.");
assert.equal(tree.root.findByType("input").props.placeholder, "Your name");
assert.equal(tree.root.findByType("input").props.autoFocus, undefined);
assert.equal(tree.root.findByType("input").props.maxLength, undefined);
assert.deepEqual(tree.root.findAllByType("button").map(text), ["Join Tabs", "Join Spaces"]);
assert.equal(alerts().length, 0);
for (const invalid of ["", "x", "a".repeat(17), "hello!", "éé", "admin", "fuuuck"]) {
  change(invalid); assert.equal(alerts().length, 0);
  click(0); assert.equal(starts.length, 0); assert.equal(alerts().length, 1);
  assert.equal(text(alerts()[0]), ["admin", "fuuuck"].includes(invalid) ? "Pick a different name." : "Use 2 to 16 letters or numbers.");
  assert.equal(focused, "input");
  const input = tree.root.findByType("input");
  assert.equal(input.props["aria-invalid"], true); assert.equal(input.props["aria-describedby"], "name-error");
}
change("  A-b_c 1  "); submit();
assert.equal(alerts().length, 0); assert.equal(starts.length, 0); assert.equal(focused, "button");
click(1); assert.deepEqual(starts.pop(), { name: "A-b_c 1", team: "spaces", touch: false });
change("Scunthorpe"); click(0);
assert.deepEqual(starts.pop(), { name: "Scunthorpe", team: "tabs", touch: false });
act(() => tree.root.findByType("main").props.onPointerDown({ pointerType: "touch" })); click(1);
assert.equal(starts.pop().touch, true);
act(() => tree.unmount());
const identity = { playerId: crypto.randomUUID(), name: "Saved Robot", team: "spaces" };
await mount(identity);
assert.equal(tree.root.findAllByType("input").length, 0);
assert.equal(tree.root.findAllByType("button").length, 1); assert.equal(text(tree.root.findByType("button")), "Play");
assert.equal(text(tree.root.findByProps({ className: "entry-player" })), "Saved RobotSpaces");
assert.equal(starts.length, 0);
act(() => tree.root.findByType("main").props.onPointerDown({ pointerType: "touch" })); submit();
assert.deepEqual(starts.pop(), { name: identity.name, team: "spaces", touch: true });
act(() => tree.unmount());
await mount({ playerId: identity.playerId, name: identity.name });
assert.equal(tree.root.findByType("input").props.readOnly, true);
assert.equal(tree.root.findByType("input").props.value, identity.name);
click(0); assert.deepEqual(starts.pop(), { name: identity.name, team: "tabs", touch: false });
act(() => tree.unmount());
`;
  const path = join(scratch, "probe.mjs"); writeFileSync(path, probe);
  try {
    const result = Bun.spawnSync([process.execPath, path], { cwd: scratch,
      env: { ...process.env, HOME: home, USERPROFILE: home }, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
