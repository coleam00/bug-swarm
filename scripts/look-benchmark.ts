// Developer-only Vite page. No API client, identity storage, server or score submission.
import { Renderer } from "../src/web/game/draw";
import { Effects } from "../src/web/game/fx";
import { Feedback } from "../src/web/game/fx/feedback";
import { FixedStepper } from "../src/web/game/loop";
import { REVIEW_LASER, TEST_SHIELD, REFACTOR_BOMB, CI_DRONE, UPGRADE_IDS } from "../src/shared/upgrades";
import { openChoice } from "../src/web/game/upgrades";
import { chooseUpgrade, createSimulation } from "../src/web/game/simulation";
import { arenaForViewport } from "../src/web/game/arena";
import { FrameAudit } from "./frame-audit";

const canvas = document.querySelector("canvas")!, ctx = canvas.getContext("2d")!;
const readout = document.querySelector("pre")!;
const renderer = new Renderer(ctx), fx = new Effects(), feedback = new Feedback(fx), loop = new FixedStepper(feedback);
const state = createSimulation(73, arenaForViewport(innerWidth, innerHeight)), input = { x: 0, y: 0, target: null };
const profile = new URLSearchParams(location.search).get("profile") ?? "normal";
function acquire(id: typeof UPGRADE_IDS[number], count: number) {
  for (let i = 0; i < count; i++) {
    do { state.upgrades.offer = null; openChoice(state.upgrades); } while (!state.upgrades.offer!.includes(id));
    chooseUpgrade(state, state.upgrades.choiceNumber, id);
  }
}
if (profile === "laser") acquire(REVIEW_LASER, 2);
if (profile === "shield") acquire(TEST_SHIELD, 2);
if (profile === "bomb") acquire(REFACTOR_BOMB, 2);
if (profile === "drone") acquire(CI_DRONE, 2);
if (["first", "double", "stress"].includes(profile)) {
  for (const id of UPGRADE_IDS) acquire(id, profile === "first" ? 1 : profile === "double" ? 2 : id === CI_DRONE ? 9 : 4);
}
// Fixture-only: measurement must continue without a modal choice.
state.upgrades.nextChoiceAt = Infinity;
const burst = new URLSearchParams(location.search).has("burst");
const warmup = 10000, duration = 60000;
const updates: number[] = [], draws: number[] = [], fixtures: number[] = [], intervals: number[] = [];
const audit = new FrameAudit();
let start: number | null = null, previous: number | null = null, sampleStart: number | null = null;
let lastShot = 0, lastHit = 0, lastBurst = 0, lastReadout = 0;
let peakParticles = 0, peakTrails = 0, peakLabels = 0, minBugs = Infinity, maxBugs = 0;
let minFastBugs = Infinity, maxFastBugs = 0;
let stopped = false;
let blocks = 0, detonations = 0, laserKills = 0, droneShots = 0, peakRings = 0;
const droneCooldowns = new Float64Array(state.drones.length);
let frame = 0;
function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * ratio); canvas.height = Math.round(innerHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); renderer.resize(innerWidth, innerHeight, ratio, state.arena);
  loop.reset(); fx.resetClock();
}
function replenish() {
  while (state.bugs.length < 150) {
    const id = state.nextId++, angle = id * 2.3999632297;
    state.bugs.push({ id, kind: id % 4 === 0 ? "fast" : "base",
      x: state.arena.width * (0.5 + Math.cos(angle) * 0.46), y: state.arena.height * (0.5 + Math.sin(angle) * 0.46) });
  }
}
function fixture(timestamp: number) {
  state.dead = false; state.hits = 0; state.spawnIn = 100;
  replenish();
  if (timestamp - lastShot >= 200) {
    const bug = state.bugs[0]!;
    state.shots.push({ x: bug.x, y: bug.y, vx: 30, vy: 0, life: 1, remaining: 1 + state.upgrades.counts[REVIEW_LASER], laser: state.upgrades.counts[REVIEW_LASER] > 0 }); lastShot = timestamp;
  }
  if (timestamp - lastHit >= 2000) {
    const bug = state.bugs[state.bugs.length - 1]!; bug.x = state.robot.x; bug.y = state.robot.y;
    if (state.upgrades.counts[TEST_SHIELD]) state.shieldCharges = state.upgrades.counts[TEST_SHIELD];
    state.invulnerableUntil = 0; lastHit = timestamp;
  }
  if (burst && timestamp - lastBurst >= 1000) {
    for (let i = 0; i < 300; i++) fx.squash(state.arena.width * (0.2 + i % 20 * 0.03), state.arena.height * (0.2 + Math.floor(i / 20) * 0.04));
    lastBurst = timestamp;
  }
}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}
function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / (values.length || 1); }
function report() {
  return { profile, mode: burst ? "burst" : "normal", sampleMs: intervals.reduce((a, b) => a + b, 0), frames: intervals.length,
    meanFps: 1000 / mean(intervals), lowestRollingFps: Math.min(...audit.windows.map(window => window.fps)), frameAudit: audit.report(),
    updateMeanMs: mean(updates), updateP95Ms: percentile(updates, 0.95),
    drawMeanMs: mean(draws), drawP95Ms: percentile(draws, 0.95),
    fixtureMeanMs: mean(fixtures), fixtureP95Ms: percentile(fixtures, 0.95),
    blocks, detonations, laserKills, droneShots, peakRings, peakParticles, peakTrails, peakLabels, minBugs, maxBugs, minFastBugs, maxFastBugs,
    worldWidth: state.arena.width, worldHeight: state.arena.height,
    viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, renderDpr: Math.min(devicePixelRatio || 1, 2), userAgent: navigator.userAgent };
}
function tick(timestamp: number) {
  if (stopped) return;
  start ??= timestamp;
  const elapsed = timestamp - start, begin = performance.now();
  fixture(elapsed);
  const prepared = performance.now();
  fx.advance(timestamp);
  input.x = Math.cos(state.time * 0.8); input.y = Math.sin(state.time * 0.8);
  const charges = state.shieldCharges, bombs = state.bombDetonations, kills = state.squashes;
  for (let i = 0; i < state.drones.length; i++) droneCooldowns[i] = state.drones[i]!.fireIn;
  loop.advance(timestamp, state, input);
  blocks += Math.max(0, charges - state.shieldCharges); detonations += state.bombDetonations - bombs;
  if (state.bombDetonations === bombs && state.upgrades.counts[REVIEW_LASER]) laserKills += state.squashes - kills;
  // Cooldowns reset only after real simulation firing. Count those transitions.
  for (let i = 0; i < state.drones.length; i++) if (state.drones[i]!.fireIn > droneCooldowns[i]!) droneShots++;
  const updated = performance.now();
  replenish();
  const replenished = performance.now();
  renderer.draw(state, fx);
  const rendered = performance.now();
  if (elapsed >= warmup && sampleStart === null) sampleStart = timestamp;
  else if (sampleStart !== null && previous !== null) {
    intervals.push(timestamp - previous); updates.push(updated - prepared); draws.push(rendered - replenished);
    fixtures.push(prepared - begin + replenished - updated);
    minBugs = Math.min(minBugs, state.bugs.length); maxBugs = Math.max(maxBugs, state.bugs.length);
    let fastBugs = 0;
    for (const bug of state.bugs) if (bug.kind === "fast") fastBugs++;
    minFastBugs = Math.min(minFastBugs, fastBugs); maxFastBugs = Math.max(maxFastBugs, fastBugs);
    peakRings = Math.max(peakRings, fx.ring.life > 0 ? 1 : 0);
    peakParticles = Math.max(peakParticles, fx.particles.count); peakTrails = Math.max(peakTrails, fx.trails.count); peakLabels = Math.max(peakLabels, fx.labels.count);
  }
  previous = timestamp;
  if (elapsed - lastReadout >= 500) {
    readout.textContent = sampleStart === null ? `150 bugs · ${burst ? "burst" : "normal"}\nWarmup ${Math.floor(elapsed / 1000)} / 10s` :
      `150 bugs · ${burst ? "burst" : "normal"}\n${(1000 / mean(intervals)).toFixed(1)} FPS · ${Math.min(60, Math.floor((timestamp - sampleStart) / 1000))} / 60s\nupdate ${mean(updates).toFixed(2)} ms · draw ${mean(draws).toFixed(2)} ms\nparticles ${fx.particles.count}/1024 · labels ${fx.labels.count}/256`;
    lastReadout = elapsed;
  }
  if (sampleStart !== null) audit.record(timestamp, begin, performance.now(), updated - prepared, rendered - replenished, prepared - begin + replenished - updated);
  if (sampleStart !== null && timestamp - sampleStart >= duration) {
    stopped = true; benchmark.result = report(); readout.textContent = JSON.stringify(benchmark.result, null, 2);
  } else frame = requestAnimationFrame(tick);
}
const benchmark = { result: null as ReturnType<typeof report> | null, state, fx,
  stop() { stopped = true; cancelAnimationFrame(frame); },
  dispose() { this.stop(); renderer.dispose(); removeEventListener("resize", resize); },
};
declare global { interface Window { lookBenchmark: typeof benchmark } }
window.lookBenchmark = benchmark;
addEventListener("resize", resize); resize(); frame = requestAnimationFrame(tick);
