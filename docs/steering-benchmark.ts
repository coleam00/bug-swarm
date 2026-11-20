// Fixture only: actual mountGame observer path; no API, storage or database.
import { mountGame } from "../src/web/game/engine";
import { Session } from "../src/web/game/session";
import { SteeringHint, SteeringHintMemory } from "../src/web/game/steering-hint";
import { arenaForViewport } from "../src/web/game/arena";

const session = new Session({ playerId: crypto.randomUUID(), name: "Benchmark" }, {
  start: async () => ({ runId: "fixture" }), finish: async () => ({ saved: true }),
  best: async () => ({ best: null }), leaders: async () => [], teams: async () => ({ tabs: 0, spaces: 0 }),
}, () => 73, console.error, () => arenaForViewport(innerWidth, innerHeight));
session.start();
// Hold the hint clock while sampling the unchanged observer for a full minute.
const hint = new SteeringHint(new SteeringHintMemory(() => ({ getItem: () => null, setItem: () => {} })),
  { now: () => 0, schedule: () => 1, cancel: () => {} });
const detach = hint.attach(session, () => {});
const state = session.current!.simulation;
state.spawnIn = state.fireIn = state.invulnerableUntil = state.upgrades.nextChoiceAt = Infinity;
for (let i = 0; i < 150; i++) state.bugs.push({ id: i + 1, kind: i % 4 === 0 ? "fast" : "base", x: 0, y: 0 });
const phases: { name: string; fps: number; updateMeanMs: number; drawMeanMs: number; minBugs: number; maxBugs: number }[] = [];
let watching = true, pendingChecks = 0, dismissedChecks = 0;
let start: number | undefined, previous: number | undefined, phase = 0, frames = 0, ms = 0, minBugs = 150, maxBugs = 150;
const updates: number[] = [], draws: number[] = [];
const raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = callback => raf(timestamp => {
  start ??= timestamp;
  // Reposition before the production callback, outside its measured update/draw.
  for (let i = 0; i < 150; i++) {
    const bug = state.bugs[i]!, angle = i * 2.3999632297;
    bug.x = state.arena.width * (0.5 + Math.cos(angle) * 0.46);
    bug.y = state.arena.height * (0.5 + Math.sin(angle) * 0.46);
  }
  const elapsed = timestamp - start, nextPhase = Math.floor(elapsed / 70000);
  (window as any).steeringProgress = { elapsed, phase, frames, checks: pendingChecks, hidden: document.hidden };
  if (nextPhase > phase) {
    phases.push({ name: watching ? "watching" : "dismissed", fps: 1000 * frames / ms,
      updateMeanMs: updates.reduce((a, b) => a + b, 0) / updates.length,
      drawMeanMs: draws.reduce((a, b) => a + b, 0) / draws.length, minBugs, maxBugs });
    if (nextPhase === 2) {
      unmount(); detach(); (window as any).steeringBenchmark = { done: true, phases, pendingChecks, dismissedChecks }; return;
    }
    watching = false; hint.moved(session.view.token); phase = nextPhase;
    frames = ms = 0; updates.length = draws.length = 0;
  }
  if (elapsed % 70000 >= 10000 && previous !== undefined) {
    frames++; ms += timestamp - previous;
    minBugs = Math.min(minBugs, state.bugs.length); maxBugs = Math.max(maxBugs, state.bugs.length);
  }
  previous = timestamp; callback(timestamp);
});
const unmount = mountGame(document.querySelector("canvas")!, session, () => {}, text => {
  if (!start || (performance.now() - start) % 70000 < 11000) return;
  const match = /update ([\d.]+) ms.*draw ([\d.]+) ms/.exec(text);
  if (match) { updates.push(Number(match[1])); draws.push(Number(match[2])); }
}, { pending: token => { if (watching) pendingChecks++; else dismissedChecks++; return hint.pending(token); }, moved: token => hint.moved(token) });
window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
