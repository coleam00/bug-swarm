import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("board subscribes, renders server data as text, preserves rows, handles outages and cleans up", () => {
  const scratch = mkdtempSync(join(tmpdir(), "board-ui-")), home = join(scratch, "home");
  mkdirSync(home);
  const moduleUrl = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, path)).href);
  const probe = `
import assert from "node:assert/strict";
import { createElement } from ${JSON.stringify(import.meta.resolve("react"))};
import { create, act } from ${JSON.stringify(import.meta.resolve("react-test-renderer"))};
import { BoardController } from ${moduleUrl("polling.ts")};
import { FakeScheduler, deferred } from ${moduleUrl("polling.test-support.ts")};
import { Board } from ${moduleUrl("Board.tsx")};
globalThis.document = { title: "" };
Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("Board accessed player storage"); } });
const text = node => typeof node === "object" ? node.children.map(text).join(" ") : String(node);
for (const origin of ["https://swarm.test", "http://localhost:12345"]) {
  globalThis.window = { location: { origin } };
  const clock = new FakeScheduler(), leaders = [], teams = [], logs = [];
  const controller = new BoardController({
    leaders: () => { const request = deferred(); leaders.push(request); return request.promise; },
    teams: () => { const request = deferred(); teams.push(request); return request.promise; },
  }, clock, (...args) => logs.push(args));
  let tree;
  try {
    await act(async () => { tree = create(createElement(Board, { controller })); });
    assert.match(text(tree.root), /Waiting for the top 10/);
    assert.match(text(tree.root), /Waiting for team scores/);
    assert.equal(document.title, "Bug Swarm — Stream Board");
    assert.equal(tree.root.findByType("a").props.href, origin);
    assert.equal(text(tree.root.findByType("a")), origin);
    assert.equal(tree.root.findAllByType("input").length, 0);
    assert.equal(tree.root.findAllByType("canvas").length, 0);
    assert.equal(tree.root.findAllByType("button").length, 0);
    await act(async () => { leaders[0].reject(new Error("initial failure")); teams[0].reject(new Error("initial failure")); });
    assert.match(text(tree.root), /Reconnecting/);
    assert.match(text(tree.root), /Waiting for the top 10/);
    await act(async () => { await clock.tick(2000); });
    await act(async () => { leaders[1].resolve([]); teams[1].resolve({ tabs: 0, spaces: 0 }); });
    assert.match(text(tree.root), /First score takes the lead/);
    assert.match(text(tree.root), /No team scores yet/);
    assert.equal(text(tree.root.findByProps({ role: "status" })), "");
    await act(async () => { await clock.tick(2000); });
    await act(async () => {
      leaders[2].resolve([{ playerId: "a", name: "Robot_Name-12345", score: 1234567 }]);
      teams[2].resolve({ tabs: 3, spaces: 1 });
    });
    const row = tree.root.findByType("li"), shell = tree.root.findByType("main");
    assert.match(text(row), /Robot_Name-12345/); assert.match(text(row), /1.2M/);
    assert.equal(row.findByType("strong").props.title, "1,234,567");
    assert.equal(row.findByType("strong").props["aria-label"], "1,234,567 points");
    assert.equal(row.props.className, "board-highlight");
    await act(async () => { await clock.tick(2000); });
    await act(async () => {
      leaders[3].resolve([{ playerId: "a", name: "Robot_Name-12345", score: 1234568 }]);
      teams[3].resolve({ tabs: 3, spaces: 4 });
    });
    assert.equal(tree.root.findByType("li"), row, "Refresh replaced the keyed row");
    assert.equal(tree.root.findAllByProps({ className: "board-team board-highlight" }).length, 1);
    await act(async () => { await clock.tick(1000); });
    assert.equal(row.props.className, undefined, "Unchanged polls extended the arrival highlight");
    await act(async () => { await clock.tick(1000); });
    await act(async () => { leaders[4].resolve([{ playerId: "x", name: "<b>bad</b>", score: 99 }]); teams[4].reject(new Error("offline")); });
    assert.match(text(tree.root), /Reconnecting/); assert.match(text(row), /Robot_Name/);
    assert.equal(tree.root.findByType("main"), shell, "Outage replaced the page shell");
    assert.equal(tree.root.findAll(node => node.props.dangerouslySetInnerHTML !== undefined).length, 0);
    assert.equal(tree.root.findAllByType("b").length, 0);
    await act(async () => { await clock.tick(2000); });
    await act(async () => { leaders[5].resolve([]); teams[5].resolve({ tabs: 0, spaces: 0 }); });
    assert.equal(tree.root.findAllByType("li").length, 0);
    assert.equal(text(tree.root.findByProps({ role: "status" })), "");
    act(() => tree.unmount()); tree = undefined;
    assert.equal(clock.timers.size, 0);
    // React StrictMode's effect cleanup/setup sequence on the same controller.
    await act(async () => { tree = create(createElement(Board, { controller })); });
    act(() => tree.unmount()); tree = undefined;
    const stopped = controller.getSnapshot();
    await act(async () => { leaders.at(-1).resolve([{ playerId: "late", name: "Late", score: 999 }]); teams.at(-1).resolve({ tabs: 99, spaces: 0 }); });
    assert.equal(controller.getSnapshot(), stopped); assert.equal(clock.timers.size, 0);
  } finally { if (tree) act(() => tree.unmount()); controller.stop(); }
}
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], {
      cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home },
      stdout: "pipe", stderr: "pipe", timeout: 15000,
    });
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
