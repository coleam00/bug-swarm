import { expect, spyOn, test } from "bun:test";
import { CHOICE_INTERVAL, CI_DRONE, REFACTOR_BOMB, REVIEW_LASER, TEST_SHIELD, UPGRADE_IDS, type UpgradeId } from "../src/shared/upgrades";
import { createSimulation, IDLE, step } from "../src/web/game/simulation";
import { acquiredUpgrades, createUpgrades, openChoice, selectUpgrade } from "../src/web/game/upgrades";
import { broadScenarios, broadTargets, evasiveInput, median, pacingCommand, printReport, PRIORITIES, priorityKey, resolveChoice, runBroadMatrix, runMatrix, runScenario, SCENARIOS, selectCard, summarize, targets, under60, VIEWPORTS, type Result } from "./pacing";

test.each([
  { seed: 2070972806, viewport: [390, 844] as const },
  { seed: 2278550863, viewport: [844, 390] as const },
])("review idle regression stays within 18–40 seconds: %j", scenario => {
  const row = runScenario({ ...SCENARIOS[0], ...scenario, mode: "idle" });
  expect(row.dead).toBe(true);
  expect(row.elapsed).toBeGreaterThanOrEqual(18 - 1e-7);
  expect(row.elapsed).toBeLessThanOrEqual(40 + 1e-7);
});

test("default matrix keeps all five seeds, modes, shapes and distinct upgrade priorities", () => {
  const rows = runMatrix();
  expect(rows).toHaveLength(20);
  expect(targets(rows)).toEqual({ idle18to40: true, idle60: true, evasiveMedian60to180: true, allDead240: true, scoresPlausible: true });
  for (const seed of [1, 42, 12345, 7, 99]) for (const mode of ["idle", "evasive"] as const)
    for (const viewport of [[390, 844], [1280, 800]])
      expect(rows.filter(r => r.seed === seed && r.mode === mode && r.viewport[0] === viewport[0] && r.viewport[1] === viewport[1])).toHaveLength(1);
  const priorities = rows.filter(r => r.mode === "evasive" && r.viewport[0] === 390).map(r => r.priority);
  expect(new Set(priorities.map(p => p.join(","))).size).toBe(5);
  for (const priority of priorities) expect([...priority].sort()).toEqual([...UPGRADE_IDS].sort());
  expect(priorities.some(p => p[0] === TEST_SHIELD)).toBe(true);
  expect(priorities.some(p => p[0] === CI_DRONE && p[1] === REFACTOR_BOMB)).toBe(true);
});

test("broad enumeration crosses 100 seeds, five full priorities, both shapes and modes exactly once", () => {
  const cases = broadScenarios();
  expect(cases).toHaveLength(2000);
  expect(new Set(cases.map(s => `${s.seed}/${s.mode}/${s.viewport.join("x")}/${priorityKey(s.priority)}`)).size).toBe(2000);
  expect([...new Set(cases.map(s => s.seed))]).toEqual(Array.from({ length: 100 }, (_, i) => i));
  for (const mode of ["idle", "evasive"] as const) for (const viewport of VIEWPORTS) for (const priority of PRIORITIES)
    expect(cases.filter(s => s.mode === mode && s.viewport[0] === viewport[0] && s.viewport[1] === viewport[1] && priorityKey(s.priority) === priorityKey(priority))).toHaveLength(100);
  expect(PRIORITIES.filter(p => p[0] === REVIEW_LASER)).toHaveLength(1);
  expect(PRIORITIES.filter(p => p[0] === CI_DRONE)).toHaveLength(2);
});

test("ten-seed broad slice protects every build's evasive floor and idle, death and score ceilings", () => {
  const rows = runBroadMatrix(Array.from({ length: 10 }, (_, i) => i));
  expect(rows).toHaveLength(200);
  const gates = broadTargets(rows);
  expect(Object.entries(gates).filter(([name]) => name !== "evasiveMedian75to110").every(([, pass]) => pass)).toBe(true);
  // Replay both modes' seeded builds without reusing the harness's selector.
  const differsFromFirstCard = new Set<string>();
  for (const row of rows) {
    const expected = createUpgrades(row.seed);
    // A fatal contact at a choice boundary ends the run before that offer opens.
    for (let at = CHOICE_INTERVAL; at < row.elapsed - 1e-7; at += CHOICE_INTERVAL) {
      openChoice(expected);
      const chosen = row.priority.find(id => expected.offer!.includes(id))!;
      if (chosen !== expected.offer![0]) differsFromFirstCard.add(priorityKey(row.priority));
      selectUpgrade(expected, expected.choiceNumber, chosen);
    }
    expect(row.build).toEqual(acquiredUpgrades(expected));
  }
  expect([...differsFromFirstCard].sort()).toEqual(PRIORITIES.map(priorityKey).sort());
});

function broadFixture(evasive = 90): Result[] {
  return broadScenarios([0]).map(s => ({ ...reported(s.mode, s.viewport, s.mode === "idle" ? 30 : evasive), ...s }));
}
test.each([75, 110])("broad gates accept inclusive %i-second overall median, 30s idle and 240s maximum", duration => {
  const rows = broadFixture(duration);
  expect(Object.values(broadTargets(rows)).every(Boolean)).toBe(true);
  rows.find(r => r.mode === "evasive")!.elapsed = 240;
  expect(broadTargets(rows).allDead240).toBe(true);
});
test("broad report finds a weak priority hidden by a passing overall median", () => {
  const rows = broadFixture();
  for (const r of rows) if (r.mode === "evasive" && r.priority[0] === REVIEW_LASER) r.elapsed = 54.9;
  const gates = broadTargets(rows);
  expect(gates.evasiveMedian75to110).toBe(true);
  expect(gates[`evasiveMedian55:${priorityKey(SCENARIOS[3].priority)}`]).toBe(false);
  for (const r of rows) if (r.mode === "evasive" && r.priority[0] === REVIEW_LASER) r.elapsed = 55;
  expect(Object.values(broadTargets(rows)).every(Boolean)).toBe(true);
});
test.each([74.99, 110.01])("broad overall median rejects %f seconds", duration => {
  expect(broadTargets(broadFixture(duration)).evasiveMedian75to110).toBe(false);
});
test("broad gates reject missing and duplicate combinations, cutoffs, ceilings and invalid scores", () => {
  expect(Object.values(broadTargets([])).every(v => !v)).toBe(true);
  const missing = broadFixture().slice(1);
  expect(broadTargets(missing).completeGroups).toBe(false);
  missing.push(missing[0]!);
  expect(broadTargets(missing).completeGroups).toBe(false);
  const rows = broadFixture();
  rows[0]!.elapsed = 60.001;
  expect(broadTargets(rows).idle60).toBe(false);
  rows[0]!.elapsed = 60; rows[0]!.dead = false;
  expect(broadTargets(rows).idle60).toBe(false);
  expect(broadTargets(rows).allDead240).toBe(false);
  rows[0]!.dead = true;
  rows.find(r => r.mode === "evasive")!.elapsed = 240.001;
  expect(broadTargets(rows).allDead240).toBe(false);
  rows[0]!.validScore = false;
  expect(broadTargets(rows).scoresPlausible).toBe(false);
});
test("under-60 diagnostics use raw times, boundary tolerance and only evasive runs in the denominator", () => {
  const rows = broadFixture();
  const evasive = rows.filter(r => r.mode === "evasive");
  [59.999, 60, 60 - 1e-8, 60 + 1e-8].forEach((t, i) => evasive[i]!.elapsed = t);
  expect(under60(rows)).toEqual({ count: 1, total: 10, percent: 10 });
  evasive[0]!.dead = false;
  expect(under60(rows)).toEqual({ count: 0, total: 10, percent: 0 });
});
test("production command dispatch enumerates the requested workload and rejects unknown flags or failed gates", () => {
  let executions = 0;
  const reports: { broad: boolean; count: number }[] = [];
  const idlePriorities = new Set<string>();
  // Stub only combat execution, below the real dispatcher and both generators.
  const run: typeof runScenario = (scenario, _horizon, policy) => {
    executions++;
    // Exercise the actual broad idle callback
    // with an offer where first-card selection disagrees with named priorities.
    if (scenario.mode === "idle" && policy && !idlePriorities.has(priorityKey(scenario.priority))) {
      const offer: readonly UpgradeId[] = [REVIEW_LASER, REFACTOR_BOMB, CI_DRONE];
      expect(policy(offer, 1)).toBe(scenario.priority.find(id => offer.includes(id))!);
      idlePriorities.add(priorityKey(scenario.priority));
    }
    return { ...reported(scenario.mode, scenario.viewport, scenario.mode === "idle" ? 30 : 90), ...scenario };
  };
  const report = (rows: readonly Result[], broad = false) => { reports.push({ broad, count: rows.length }); };
  expect(pacingCommand([], run, report)).toBe(0);
  expect(pacingCommand(["--"], run, report)).toBe(0);
  expect(pacingCommand(["--broad"], run, report)).toBe(0);
  expect(pacingCommand(["--", "--broad"], run, report)).toBe(0);
  expect(reports).toEqual([{ broad: false, count: 20 }, { broad: false, count: 20 },
    { broad: true, count: 2000 }, { broad: true, count: 2000 }]);
  expect(executions).toBe(4040);
  expect([...idlePriorities].sort()).toEqual(PRIORITIES.map(priorityKey).sort());
  for (const args of [["--unknown"], ["--broad", "extra"], ["--broad", "--broad"]])
    expect(pacingCommand(args, run, report)).toBe(1);
  expect(executions).toBe(4040);
  expect(pacingCommand(["--broad"], scenario => ({ ...run(scenario), elapsed: scenario.mode === "idle" ? 30 : 74 }), report)).toBe(1);
});
test("broad output retains case records and every mode/shape/full-priority summary and gate", () => {
  const lines: string[] = [], log = spyOn(console, "log").mockImplementation(line => { lines.push(String(line)); });
  try { printReport(broadFixture(), true); } finally { log.mockRestore(); }
  expect(lines.filter(line => /seed=/.test(line))).toHaveLength(20);
  expect(lines).toContain("evasive overall: count=10 median=90.00s longest=90.00s cutoffs=0");
  for (const mode of ["idle", "evasive"]) for (const priority of PRIORITIES) {
    const label = `${mode} priority=${priorityKey(priority)}`;
    expect(lines.some(line => line.startsWith(`${label}: count=2 median=`))).toBe(true);
    for (const viewport of VIEWPORTS)
      expect(lines.some(line => line.startsWith(`${label} ${viewport.join("x")}: count=1 median=`))).toBe(true);
  }
  expect(lines).toContain("evasive under60: 0/10 (0.0%)");
  expect(lines.filter(line => line.startsWith("PASS evasiveMedian55:"))).toHaveLength(5);
  expect(lines.some(line => line.startsWith("FAIL"))).toBe(false);
});

test("two-seed upgraded pacing replays deterministically, ends idle by 60s and both priorities by 240s", () => {
  const rows = runMatrix([1, 42]);
  expect(rows).toHaveLength(8); expect(rows).toEqual(runMatrix([1, 42]));
  for (const r of rows) {
    expect(r.dead).toBe(true); expect(r.elapsed).toBeLessThanOrEqual(240 + 1e-7);
    if (r.mode === "idle") expect(r.elapsed).toBeLessThanOrEqual(60 + 1e-7);
    expect(r.validScore).toBe(true); expect(r.score).toBe(10 * r.squashes + r.seconds);
    expect(r.squashes).toBeLessThanOrEqual(r.spawned);
    expect(r.build.reduce((sum, u) => sum + u.count, 0)).toBe(Math.floor(r.seconds / 20));
  }
  expect(Object.values(targets(rows)).every(Boolean)).toBe(true);
});

test("idle first-card builds end by 60s across reported, consecutive and spread 32-bit seeds", () => {
  const seeds = [29514, ...Array.from({ length: 100 }, (_, i) => i),
    ...Array.from({ length: 100 }, (_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0)];
  for (const seed of seeds) for (const viewport of VIEWPORTS) {
    const r = runScenario({ ...SCENARIOS[0], seed, viewport, mode: "idle" });
    expect({ seed, viewport, dead: r.dead, within60: r.elapsed <= 60 + 1e-7, validScore: r.validScore })
      .toEqual({ seed, viewport, dead: true, within60: true, validScore: true });
  }
});

// Independent result fixtures exercise classification, without relying on today's balance.
function reported(mode: Result["mode"], viewport: Result["viewport"], elapsed: number): Result {
  return { mode, viewport, elapsed, seed: 1, priority: [TEST_SHIELD, CI_DRONE, REFACTOR_BOMB, REVIEW_LASER],
    dead: true, score: Math.floor(elapsed), seconds: Math.floor(elapsed), squashes: 0, spawned: 0, build: [], validScore: true };
}
function reportFixture(portrait: readonly number[], landscape = portrait, idle = 30): Result[] {
  return [reported("idle", [390, 844], idle),
    reported("idle", [1280, 800], idle),
    ...portrait.map(t => reported("evasive", [390, 844], t)),
    ...landscape.map(t => reported("evasive", [1280, 800], t))];
}

test.each([18, 40, 18 - 1e-8, 40 + 1e-8])("idle range accepts the inclusive raw boundary %f", elapsed => {
  expect(targets(reportFixture([90], [90], elapsed)).idle18to40).toBe(true);
  const broad = broadFixture();
  for (const row of broad) if (row.mode === "idle") row.elapsed = elapsed;
  expect(broadTargets(broad).idle18to40).toBe(true);
});

test.each([17.999, 40.001])("idle range rejects %f in gates and command exit codes", elapsed => {
  expect(targets(reportFixture([90], [90], elapsed)).idle18to40).toBe(false);
  const broad = broadFixture();
  for (const row of broad) if (row.mode === "idle") row.elapsed = elapsed;
  expect(broadTargets(broad).idle18to40).toBe(false);
  for (const mode of [false, true]) {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(pacingCommand(mode ? ["--broad"] : [], scenario =>
        ({ ...reported(scenario.mode, scenario.viewport, scenario.mode === "idle" ? elapsed : 90), ...scenario }))).toBe(1);
    } finally { log.mockRestore(); }
  }
});

test("idle range rejects an in-range survivor, missing idle mode or incomplete broad group", () => {
  for (const rows of [reportFixture([90]), broadFixture()]) {
    rows.find(r => r.mode === "idle")!.dead = false;
    expect(targets(rows).idle18to40).toBe(false); expect(broadTargets(rows).idle18to40).toBe(false);
    const missing = rows.filter(r => r.mode !== "idle");
    expect(targets(missing).idle18to40).toBe(false); expect(broadTargets(missing).idle18to40).toBe(false);
  }
  expect(broadTargets(broadFixture().slice(1)).idle18to40).toBe(false);
  expect(targets(reportFixture([90]).filter(r => r.mode !== "idle" || r.viewport[0] === 390)).idle18to40).toBe(false);
});
test.each([60, 180])("target report accepts the inclusive %i-second evasive boundary", duration => {
  expect(targets(reportFixture([duration]))).toEqual({ idle18to40: true, idle60: true, evasiveMedian60to180: true,
    allDead240: true, scoresPlausible: true });
});
test("idle target rejects a completed run beyond 60 seconds", () => {
  expect(targets(reportFixture([120], [120], 61))).toEqual({ idle18to40: false, idle60: false, evasiveMedian60to180: true,
    allDead240: true, scoresPlausible: true });
});
test("overall ceiling checks the longest run even when both medians are valid", () => {
  const atLimit = reportFixture([60, 120, 240]);
  expect(targets(atLimit)).toEqual({ idle18to40: true, idle60: true, evasiveMedian60to180: true, allDead240: true, scoresPlausible: true });
  const overLimit = reportFixture([60, 120, 241]);
  expect(targets(overLimit)).toEqual({ idle18to40: true, idle60: true, evasiveMedian60to180: true, allDead240: false, scoresPlausible: true });
});
test.each([59, 181])("evasive median rejects %i seconds overall and within either viewport", duration => {
  expect(targets(reportFixture([duration])).evasiveMedian60to180).toBe(false);
  // Combined medians are 89.5 or 150.5, so only the individual viewport is invalid.
  expect(targets(reportFixture([duration], [120])).evasiveMedian60to180).toBe(false);
  expect(targets(reportFixture([120], [duration])).evasiveMedian60to180).toBe(false);
});
test("target report rejects missing groups and invalid scores", () => {
  expect(targets([])).toEqual({ idle18to40: false, idle60: false, evasiveMedian60to180: false, allDead240: false, scoresPlausible: false });
  expect(targets(reportFixture([120], [])).evasiveMedian60to180).toBe(false);
  const rows = reportFixture([120]); rows[0]!.validScore = false;
  expect(targets(rows)).toEqual({ idle18to40: true, idle60: true, evasiveMedian60to180: true, allDead240: true, scoresPlausible: false });
});

test.each([
  { durations: [90, 10, 20], expectedMedian: 20, longest: 90 },
  { durations: [90, 10, 50, 20], expectedMedian: 35, longest: 90 },
])("median and longest use unequal odd/even durations: %j", ({ durations, expectedMedian, longest }) => {
  expect(median(durations)).toBe(expectedMedian);
  const fixture = runScenario({ ...SCENARIOS[0], mode: "idle", viewport: [390, 844] }, 0.025);
  const rows = durations.map((elapsed, i) => ({ ...fixture, elapsed, dead: i !== 0 }));
  expect(summarize(rows)).toEqual({ median: expectedMedian, longest, cutoffs: 1 });
});

test("idle takes the first card; evasive uses the first available priority", () => {
  const offer = [REVIEW_LASER, REFACTOR_BOMB, CI_DRONE];
  expect(selectCard("idle", offer, SCENARIOS[0].priority)).toBe(REVIEW_LASER);
  expect(selectCard("evasive", offer, SCENARIOS[0].priority)).toBe(CI_DRONE);
  expect(selectCard("evasive", [TEST_SHIELD, REVIEW_LASER, CI_DRONE], SCENARIOS[1].priority)).toBe(CI_DRONE);
});

test("harness resolves actual offers without advancing paused gameplay time", () => {
  const s = createSimulation(42); s.invulnerableUntil = Infinity;
  while (!s.upgrades.offer) step(s, IDLE, 1 / 60);
  const first = s.upgrades.offer![0]!;
  resolveChoice(s, offer => selectCard("idle", offer, SCENARIOS[1].priority));
  expect(s.time).toBe(20); expect(s.upgrades.offer).toBeNull(); expect(s.upgrades.counts[first]).toBe(1);
});

test("cutoff is a survivor even below a target ceiling and the horizon uses a shortened last step", () => {
  const r = runScenario({ ...SCENARIOS[0], mode: "idle", viewport: [390, 844] }, 0.025);
  expect(r.elapsed).toBeCloseTo(0.025, 12); expect(r.dead).toBe(false);
  expect(targets([r]).idle60).toBe(false); expect(targets([r]).allDead240).toBe(false);
  expect(() => runScenario({ ...SCENARIOS[0], mode: "idle", viewport: [390, 844] }, Infinity)).toThrow();
});

test("evasion combines centre drift and nearby repulsion, ignoring zero-distance bugs", () => {
  const s = createSimulation(1);
  s.robot.x += 80; s.robot.y -= 120;
  const drift = evasiveInput(s);
  expect(drift.x).toBeLessThan(0); expect(drift.y).toBeGreaterThan(0); expect(drift.target).toBeNull();
  s.bugs = [{ id: 1, kind: "base", ...s.robot },
    { id: 2, kind: "base", x: s.robot.x - 201, y: s.robot.y },
    { id: 3, kind: "base", x: s.robot.x, y: s.robot.y + 200 },
    { id: 4, kind: "base", x: s.robot.x, y: s.robot.y - 201 }];
  expect(evasiveInput(s)).toEqual(drift);
  for (const [dx, dy] of [[-100, 0], [100, 0], [0, -100], [0, 100]] as const) {
    s.bugs = [{ id: 4, kind: "fast", x: s.robot.x + dx, y: s.robot.y + dy }];
    const near = evasiveInput(s);
    if (dx < 0) expect(near.x).toBeGreaterThan(drift.x);
    if (dx > 0) expect(near.x).toBeLessThan(drift.x);
    if (dy < 0) expect(near.y).toBeGreaterThan(drift.y);
    if (dy > 0) expect(near.y).toBeLessThan(drift.y);
    const component = dx ? "x" : "y", other = dx ? "y" : "x";
    expect(near[other]).toBe(drift[other]);
    s.bugs[0]![component] = s.robot[component] + (dx || dy) / 2;
    expect(Math.abs(evasiveInput(s)[component] - drift[component])).toBeGreaterThan(Math.abs(near[component] - drift[component]));
  }
});
