import { arenaForViewport } from "../src/web/game/arena";
import { STEP } from "../src/web/game/config";
import { chooseUpgrade, createSimulation, IDLE, step, type Input, type Simulation } from "../src/web/game/simulation";
import { acquiredUpgrades } from "../src/web/game/upgrades";
import { CI_DRONE as D, REFACTOR_BOMB as B, REVIEW_LASER as L, TEST_SHIELD as S, type UpgradeId } from "../src/shared/upgrades";
import { parseFinish, plausible } from "../src/server/rules";

export const SCENARIOS = [
  { seed: 1, priority: [S, D, B, L] }, { seed: 42, priority: [D, B, S, L] },
  { seed: 12345, priority: [B, D, L, S] }, { seed: 7, priority: [L, S, D, B] },
  { seed: 99, priority: [D, L, B, S] },
] as const;
export const VIEWPORTS = [[390, 844], [1280, 800]] as const;
export type Mode = "idle" | "evasive";
export interface Scenario {
  seed: number; priority: readonly UpgradeId[]; mode: Mode; viewport: readonly [number, number];
}
export type ChoicePolicy = (offer: readonly UpgradeId[], pick: number) => UpgradeId;
export function selectCard(mode: Mode, offer: readonly UpgradeId[], priority: readonly UpgradeId[]): UpgradeId {
  const id = mode === "idle" ? offer[0] : priority.find(id => offer.includes(id));
  if (!id) throw new Error("No preferred card in offer");
  return id;
}
export function resolveChoice(state: Simulation, policy: ChoicePolicy): void {
  if (state.upgrades.offer && !chooseUpgrade(state, state.upgrades.choiceNumber,
    policy(state.upgrades.offer, state.upgrades.choiceNumber))) throw new Error("Choice rejected");
}
export function evasiveInput(state: Readonly<Simulation>): Input {
  let x = 0.15 * (state.arena.width / 2 - state.robot.x) / state.arena.width;
  let y = 0.15 * (state.arena.height / 2 - state.robot.y) / state.arena.height;
  for (const bug of state.bugs) {
    const dx = state.robot.x - bug.x, dy = state.robot.y - bug.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < 200) { const strength = (1 - d / 200) / d; x += dx * strength; y += dy * strength; }
  }
  return { x, y, target: null };
}
export function runScenario(scenario: Scenario, horizon = 600, policy?: ChoicePolicy) {
  if (!Number.isFinite(horizon) || horizon <= 0) throw new Error("Horizon must be finite and positive");
  const state = createSimulation(scenario.seed, arenaForViewport(...scenario.viewport));
  const choose = policy ?? ((offer) => selectCard(scenario.mode, offer, scenario.priority));
  while (!state.dead && state.time < horizon - 1e-9) {
    if (state.upgrades.offer) { resolveChoice(state, choose); continue; }
    step(state, scenario.mode === "idle" ? IDLE : evasiveInput(state), Math.min(STEP, horizon - state.time));
  }
  const build = acquiredUpgrades(state.upgrades);
  const finish = parseFinish({ playerId: "00000000-0000-4000-8000-000000000021", score: state.score,
    squashes: state.squashes, seconds: state.seconds, touch: false, upgrades: build });
  return { ...scenario, elapsed: state.time, dead: state.dead, score: state.score, squashes: state.squashes,
    seconds: state.seconds, build, spawned: state.nextId - 1,
    validScore: finish !== null && plausible(finish, 0, state.time * 1000) && state.squashes <= state.nextId - 1 };
}
export type Result = ReturnType<typeof runScenario>;
export function runMatrix(seeds: readonly number[] = SCENARIOS.map(s => s.seed)): Result[] {
  return (["idle", "evasive"] as const).flatMap(mode => VIEWPORTS.flatMap(viewport =>
    SCENARIOS.filter(s => seeds.includes(s.seed)).map(s => runScenario({ ...s, mode, viewport }))));
}
export const BROAD_SEEDS = Array.from({ length: 100 }, (_, seed) => seed);
export const PRIORITIES = SCENARIOS.map(s => s.priority);
const TOLERANCE = 1e-7;
const sameViewport = (a: Scenario["viewport"], b: Scenario["viewport"]) => a[0] === b[0] && a[1] === b[1];
export const priorityKey = (priority: readonly UpgradeId[]) => priority.join(",");
export function broadScenarios(seeds: readonly number[] = BROAD_SEEDS): Scenario[] {
  return seeds.flatMap(seed => PRIORITIES.flatMap(priority => VIEWPORTS.flatMap(viewport =>
    (["idle", "evasive"] as const).map(mode => ({ seed, priority, viewport, mode })))));
}
export function runBroadMatrix(seeds: readonly number[] = BROAD_SEEDS): Result[] {
  return broadScenarios(seeds).map(s => runScenario(s, 600,
    offer => selectCard("evasive", offer, s.priority)));
}
export function under60(rows: readonly Result[]) {
  const evasive = rows.filter(r => r.mode === "evasive");
  const count = evasive.filter(r => r.dead && r.elapsed < 60 - TOLERANCE).length;
  return { count, total: evasive.length, percent: evasive.length ? 100 * count / evasive.length : NaN };
}
export function broadTargets(rows: readonly Result[]): Record<string, boolean> {
  const seeds = [...new Set(rows.map(r => r.seed))];
  const key = (r: Scenario) => `${r.seed}/${r.mode}/${r.viewport.join("x")}/${priorityKey(r.priority)}`;
  const actual = new Set(rows.map(key));
  const expected = broadScenarios(seeds);
  const completeGroups = rows.length > 0 && rows.length === expected.length && actual.size === rows.length &&
    expected.every(s => actual.has(key(s)));
  const evasive = rows.filter(r => r.mode === "evasive");
  const m = median(evasive.map(r => r.elapsed));
  return { completeGroups,
    evasiveMedian75to110: completeGroups && m >= 75 - TOLERANCE && m <= 110 + TOLERANCE,
    ...Object.fromEntries(PRIORITIES.map(priority => {
      const group = evasive.filter(r => priorityKey(r.priority) === priorityKey(priority));
      return [`evasiveMedian55:${priorityKey(priority)}`, completeGroups &&
        median(group.map(r => r.elapsed)) >= 55 - TOLERANCE];
    })),
    idle60: completeGroups && rows.filter(r => r.mode === "idle").every(r => r.dead && r.elapsed <= 60 + TOLERANCE),
    allDead240: completeGroups && rows.every(r => r.dead && r.elapsed <= 240 + TOLERANCE),
    scoresPlausible: completeGroups && rows.every(r => r.validScore) };
}
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle]! + sorted[Math.ceil(sorted.length / 2) - 1]!) / 2 : NaN;
}
export function summarize(rows: readonly Result[]) {
  return { median: median(rows.map(r => r.elapsed)), longest: Math.max(...rows.map(r => r.elapsed)),
    cutoffs: rows.filter(r => !r.dead).length };
}
export function targets(rows: readonly Result[]) {
  const within = (row: Result, ceiling: number) => row.dead && row.elapsed <= ceiling + 1e-7;
  const idle = rows.filter(r => r.mode === "idle"), evasive = rows.filter(r => r.mode === "evasive");
  const medianInRange = (group: readonly Result[]) => {
    const m = median(group.map(r => r.elapsed)); return m >= 60 - 1e-7 && m <= 180 + 1e-7;
  };
  return { idle60: idle.length > 0 && idle.every(r => within(r, 60)),
    evasiveMedian60to180: medianInRange(evasive) && VIEWPORTS.every(v =>
      medianInRange(evasive.filter(r => r.viewport[0] === v[0] && r.viewport[1] === v[1]))),
    allDead240: rows.length > 0 && rows.every(r => within(r, 240)),
    scoresPlausible: rows.length > 0 && rows.every(r => r.validScore) };
}
export function printReport(rows: readonly Result[], broad = false): void {
  for (const r of rows) console.log(`${r.mode} ${r.viewport.join("x")} seed=${r.seed} priority=${r.mode === "idle" && !broad ? "first-card" : r.priority.join(",")} seconds=${r.dead ? "" : ">="}${r.elapsed.toFixed(2)} ${r.dead ? "death" : "CUTOFF"} score=${r.score} build=${JSON.stringify(r.build)}`);
  for (const mode of ["idle", "evasive"] as const) {
    for (const viewport of VIEWPORTS) printSummary(`${mode} ${viewport.join("x")}`, rows.filter(r => r.mode === mode && sameViewport(r.viewport, viewport)));
    printSummary(`${mode} overall`, rows.filter(r => r.mode === mode));
    if (broad) for (const priority of PRIORITIES) {
      const group = rows.filter(r => r.mode === mode && priorityKey(r.priority) === priorityKey(priority));
      printSummary(`${mode} priority=${priorityKey(priority)}`, group);
      for (const viewport of VIEWPORTS) printSummary(`${mode} priority=${priorityKey(priority)} ${viewport.join("x")}`,
        group.filter(r => sameViewport(r.viewport, viewport)));
    }
  }
  printSummary("overall", rows);
  if (broad) {
    const share = under60(rows);
    console.log(`evasive under60: ${share.count}/${share.total} (${share.percent.toFixed(1)}%)`);
  }
  console.log(`score failures: ${rows.filter(r => !r.validScore).length}`);
  for (const [name, pass] of Object.entries(broad ? broadTargets(rows) : targets(rows))) console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
}
function printSummary(label: string, rows: readonly Result[]): void {
  const s = summarize(rows);
  console.log(`${label}: count=${rows.length} median=${s.cutoffs >= Math.ceil(rows.length / 2) ? ">=" : ""}${s.median.toFixed(2)}s longest=${s.cutoffs ? ">=" : ""}${s.longest.toFixed(2)}s cutoffs=${s.cutoffs}`);
}
export function pacingCommand(args: readonly string[], run = (broad: boolean) => broad ? runBroadMatrix() : runMatrix(),
  report = printReport): number {
  const flags = args[0] === "--" ? args.slice(1) : args;
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== "--broad")) {
    console.error("Usage: bun run pacing [--] [--broad]"); return 1;
  }
  const broad = flags[0] === "--broad", rows = run(broad);
  report(rows, broad);
  return Object.values(broad ? broadTargets(rows) : targets(rows)).every(Boolean) ? 0 : 1;
}
if (import.meta.main) process.exitCode = pacingCommand(process.argv.slice(2));
