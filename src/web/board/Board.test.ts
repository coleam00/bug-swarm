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
import { TEAMS, TEAM_NAMES } from ${moduleUrl("../../shared/teams.ts")};
globalThis.document = { title: "" };
Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("Board accessed player storage"); } });
const text = node => typeof node === "object" ? node.children.map(text).join(" ") : String(node);
for (const origin of ["https://swarm.test", "http://localhost:12345"]) {
  globalThis.window = { location: { origin } };
  const clock = new FakeScheduler(), leaders = [], teams = [], stats = [], logs = [];
  const controller = new BoardController({
    leaders: () => { const request = deferred(); leaders.push(request); return request.promise; },
    teams: () => { const request = deferred(); teams.push(request); return request.promise; },
    stats: () => { const request = deferred(); stats.push(request); return request.promise; },
  }, clock, (...args) => logs.push(args));
  let tree;
  const assertNoRows = () => {
    assert.equal(tree.root.findAllByType("li").length, 0);
    assert.ok(text(tree.root.findByProps({ className: "board-empty" })).trim(), "Missing empty/loading feedback");
  };
  const assertStatus = failed => {
    assert.equal(Boolean(text(tree.root.findByProps({ role: "status" })).trim()), failed, "Incorrect reconnecting indication");
  };
  const assertActivity = (total, pills = []) => {
    const domText = node => typeof node === "object" ? node.children.map(domText).join("") : String(node);
    const actual = domText(tree.root.findByProps({ className: "board-playing" }));
    assert.equal(actual, total + " playing now");
    assert.deepEqual(tree.root.findAllByProps({ className: "board-arena" }).map(domText), pills);
    const activity = tree.root.findByProps({ className: "board-activity" });
    assert.ok(!text(activity).includes("secret-room"), "Raw arena id shown");
    assert.ok(activity.findAll(node => Object.entries(node.props).some(([key, value]) => ["title", "aria-label"].includes(key) && String(value).includes("secret-room"))).length === 0);
  };
  const assertRows = (expected, scores) => {
    const rendered = tree.root.findAllByType("li");
    assert.equal(rendered.length, expected.length, "Missing leaderboard entries");
    rendered.forEach((row, i) => {
      const [rank, name] = row.findByProps({ className: "board-name" }).findAllByType("span");
      assert.equal(Number(text(rank)), i + 1);
      assert.equal(text(name), expected[i].name, "Leaderboard order/name differs from the response");
      assert.equal(text(row.findByType("strong")), scores[i], "Displayed score differs from the response");
    });
  };
  const assertRace = (totals, scores, percentages) => {
    const panels = tree.root.findAll(node => node.type === "div" && node.props.className?.split(" ").includes("board-team"));
    assert.equal(panels.length, TEAMS.length);
    panels.forEach((panel, i) => {
      assert.equal(text(panel.findByType("h2")), TEAM_NAMES[TEAMS[i]]);
      assert.equal(text(panel.findByType("strong")), scores[i], "Incorrect displayed team total");
      assert.equal(panel.findByType("strong").props.title, totals[i].toLocaleString("en-US"));
    });
    const bar = tree.root.find(node => node.type === "div" && node.props.className?.split(" ").includes("board-race-bar"));
    const segments = bar.findAllByType("span");
    assert.equal(segments.length, TEAMS.length);
    segments.forEach((segment, i) => assert.ok(Math.abs(parseFloat(segment.props.style.width) - percentages[i]) < 1e-8, "Race width differs from team proportions"));
  };
  try {
    await act(async () => { tree = create(createElement(Board, { controller })); });
    assertNoRows(); assertStatus(false); assertActivity("—");
    assert.ok(document.title.trim());
    const pendingTotals = tree.root.findByProps({ className: "board-teams" }).findAllByType("strong");
    assert.ok(pendingTotals.every(total => total.props.title === undefined && text(total).trim()), "Missing team placeholders");
    assert.equal(tree.root.findByType("a").props.href, origin);
    assert.equal(text(tree.root.findByType("a")), origin);
    assert.equal(tree.root.findAllByType("input").length, 0);
    assert.equal(tree.root.findAllByType("canvas").length, 0);
    assert.equal(tree.root.findAllByType("button").length, 0);
    await act(async () => { leaders[0].reject(new Error("initial failure")); teams[0].reject(new Error("initial failure")); stats[0].reject(new Error("initial failure")); });
    assertStatus(true); assertNoRows(); assertActivity("—");
    await act(async () => { await clock.tick(2000); });
    await act(async () => { leaders[1].resolve([]); teams[1].resolve({ tabs: 0, spaces: 0 }); stats[1].resolve({ totalPlayers: 0, arenas: [] }); });
    assertNoRows(); assertStatus(false); assertActivity("0");
    assertRace([0, 0], ["0", "0"], [50, 50]);
    const firstRows = [1234567, 950, 840, 730, 620, 510, 400, 290, 180, 70].map((score, i) => ({
      playerId: i ? "player-" + i : "a", name: i ? "Robot_" + i : "Robot_Name-12345", score,
    }));
    const updatedRows = [...firstRows].reverse().map(row => ({ ...row, score: row.score + 1 }));
    const updatedScores = ["71", "181", "291", "401", "511", "621", "731", "841", "951", "1.2M"];
    await act(async () => { await clock.tick(2000); });
    await act(async () => {
      leaders[2].resolve(firstRows);
      teams[2].resolve({ tabs: 999999, spaces: 333333 });
      stats[2].resolve({ totalPlayers: 1234, arenas: [7, 18, 18, 6, 5, 4, 3, 2, 1, 20].map((players, i) => ({ id: "secret-room-" + i, players })) });
    });
    const pills = ["Arena 10 · 20", "Arena 2 · 18", "Arena 3 · 18", "Arena 1 · 7", "Arena 4 · 6", "Arena 5 · 5", "Arena 6 · 4", "Arena 7 · 3", "+2 more"];
    assertActivity("1,234", pills);
    assertRows(firstRows, ["1.2M", "950", "840", "730", "620", "510", "400", "290", "180", "70"]);
    assertRace([999999, 333333], ["999,999", "333,333"], [75, 25]);
    const row = tree.root.findAllByType("li")[0], shell = tree.root.findByType("main");
    assert.equal(row.findByType("strong").props.title, "1,234,567");
    assert.equal(row.findByType("strong").props["aria-label"], "1,234,567 points");
    assert.equal(row.props.className, "board-highlight");
    await act(async () => { await clock.tick(2000); });
    await act(async () => {
      leaders[3].resolve(updatedRows);
      teams[3].resolve({ tabs: 999999, spaces: 1333332 });
    });
    assertRows(updatedRows, updatedScores);
    assertRace([999999, 1333332], ["999,999", "1.3M"], [300 / 7, 400 / 7]);
    assert.equal(tree.root.findAllByType("li")[9], row, "Refresh replaced the keyed row");
    assert.equal(tree.root.findAllByProps({ className: "board-team board-highlight" }).length, 1);
    await act(async () => { await clock.tick(1000); });
    assert.equal(row.props.className, undefined, "Unchanged polls extended the arrival highlight");
    await act(async () => { await clock.tick(1000); });
    // Only the leaderboard fails. Team updates must continue and the warning
    // must be visible even though the other endpoint is healthy.
    await act(async () => { leaders[4].resolve([{ playerId: "x", name: "<b>bad</b>", score: 99 }]); teams[4].resolve({ tabs: 1000000, spaces: 4000000 }); });
    assertStatus(true); assertRows(updatedRows, updatedScores);
    assertRace([1000000, 4000000], ["1M", "4M"], [20, 80]);
    assert.equal(tree.root.findByType("main"), shell, "Outage replaced the page shell");
    assert.equal(tree.root.findAll(node => node.props.dangerouslySetInnerHTML !== undefined).length, 0);
    assert.equal(tree.root.findAllByType("b").length, 0);
    await act(async () => { await clock.tick(2000); });
    // Now only teams fail: recovered leaderboard, retained totals, same warning.
    await act(async () => { leaders[5].resolve(updatedRows); teams[5].reject(new Error("offline")); });
    assertStatus(true); assertRows(updatedRows, updatedScores);
    assertRace([1000000, 4000000], ["1M", "4M"], [20, 80]);
    assert.equal(tree.root.findByType("main"), shell);
    await act(async () => { await clock.tick(2000); });
    await act(async () => { leaders[6].resolve([]); teams[6].resolve({ tabs: 0, spaces: 0 }); });
    assertNoRows(); assertStatus(false); assertRace([0, 0], ["0", "0"], [50, 50]);
    // A stats-only outage keeps both total and pills, and shows the shared warning.
    await act(async () => { stats[6].reject(new Error("stats offline")); });
    assertStatus(true); assertActivity("1,234", pills);
    await act(async () => { await clock.tick(2000); });
    await act(async () => { stats[7].resolve({ totalPlayers: 25, arenas: [{ id: "secret-room-new", players: 25 }] }); });
    assertStatus(false); assertActivity("25", ["Arena 1 · 25"]);
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
