// Developer-only Vite fixture: simultaneous collection bounds, independent of live play.
import { ArenaRenderer } from "../src/web/arena/draw";
import { ArenaInput } from "../src/web/arena/input";
import { createBug } from "../src/shared/arena/bugs/registry";
import { lifeDefaults } from "../src/shared/arena/types";
import { MAX_BUGS, MAX_SHOTS, MAX_EVENTS, MAX_PICKUPS, MAX_GLOBS } from "../src/shared/arena/constants";
import { cameraFor, worldView } from "../src/shared/arena/view";
const canvas = document.querySelector("canvas")!, ctx = canvas.getContext("2d")!, renderer = new ArenaRenderer(ctx), input = new ArenaInput();
const players = Array.from({ length: 20 }, (_, i) => ({ ...lifeDefaults(), id: String(i), name: `Pilot-${i}`, team: i % 2 ? "tabs" as const : "spaces" as const, x: 850 + i % 5 * 130, y: 900 + Math.floor(i / 5) * 130, vx: 0, vy: 0, facing: i }));
const windupOnly = new URLSearchParams(location.search).has("windup");
const hiveScene = new URLSearchParams(location.search).has("hive");
const bugs = Array.from({ length: MAX_BUGS }, (_, i) => {
  const b = createBug(i < 10 && !windupOnly ? "beetle" : i >= 10 && i < 22 ? "spitter" : i % 5 === 0 && !windupOnly ? "crawler" : "dasher", i, 650 + i % 15 * 70, 750 + Math.floor(i / 15) * 65);
  if (b.kind === "dasher") { b.phase = windupOnly ? "windup" : ["approach", "windup", "dash", "recovery"][i % 4]; b.phaseUntil = 700; b.facing = i * 0.7; }
  // Keep all ten armoured bodies inside even the narrow portrait camera.
  if (b.kind === "beetle") { b.hp = i % 5 + 1; b.facing = i * 0.6; b.x = 1040 + i % 5 * 80; b.y = 1090 + Math.floor(i / 5) * 120; }
  if (b.kind === "spitter") { b.phase = "swell"; b.phaseUntil = 500; }
  return b;
});
if (hiveScene) bugs[bugs.length - 1] = { ...createBug("hive", 149, 1100, 1100), ringAt: 500 };
const rescue = new URLSearchParams(location.search).has("revive");
if (rescue) for (let i = 1; i < players.length; i++) {
  const p = players[i]!; p.status = "downed"; p.hits = 0; p.reviveMs = i % 4 * 500; p.reviving = i % 2 === 0;
  // Both on-screen rings and off-screen indicators, bounded by room membership.
  if (i > 10) { p.x = i % 2 ? 100 : 2300; p.y = i % 3 ? 100 : 2300; }
}
const crowdedEdges = new URLSearchParams(location.search).has("edges");
const panelReview = new URLSearchParams(location.search).has("panel-review");
const localDown = new URLSearchParams(location.search).has("local-down");
const quiet = new URLSearchParams(location.search).has("quiet");
if (crowdedEdges) {
  for (let i = 1; i < players.length; i++) Object.assign(players[i]!, { status: "downed", hits: 0, x: 2300, y: 1200 });
  if (hiveScene) Object.assign(bugs[bugs.length - 1]!, { x: 2300, y: 1200 });
}
if (localDown) Object.assign(players[0]!, { x: 1200, y: 1200, status: "downed", hits: 0 });
if (panelReview) {
  players.length = 2;
  Object.assign(players[0]!, { x: 1200, y: 28, status: "downed", hits: 0 });
  Object.assign(players[1]!, { x: 1630, y: 20, status: "downed", hits: 0 });
  Object.assign(bugs[bugs.length - 1]!, { x: 1200, y: 120 });
}
// Keep the expanded projectile/effect bounds inside the world and desktop view.
const impactPosition = (i: number) => ({ x: 800 + i % 33 * 25, y: 950 + Math.floor(i / 33) * 25 });
const shots = Array.from({ length: MAX_SHOTS }, (_, i) => ({ id: 500 + i, owner: String(i % 20), life: 1, born: 0, ...impactPosition(i), vx: 900, vy: 0 }));
const globs = Array.from({ length: MAX_GLOBS }, (_, i) => ({ id: 1800 + i, born: 0, x: 850 + i % 4 * 160, y: 950 + Math.floor(i / 4) * 130, vx: i < 12 ? -320 : -180, vy: 0, ...(i < 12 ? {} : { source: "hive" as const }) }));
const pickups = Array.from({ length: MAX_PICKUPS }, (_, i) => ({ id: 2000 + i, kind: (["shield", "spread", "rapid"] as const)[i % 3]!, x: 900 + i * 90, y: 1100, expiresAt: 0 }));
if (quiet) { bugs.splice(0, bugs.length - (hiveScene ? 1 : 0)); shots.length = 0; globs.length = 0; pickups.length = 0; }
let showStats = false;
window.addEventListener("keydown", event => { if (event.code === "KeyF" && !event.repeat) showStats = !showStats; });
let baseline = new URLSearchParams(location.search).has("baseline");
let count = 0, start = performance.now(), cost = 0, lastBurst = 0, eventId = 1;
let samples = 0;
// Evidence can alternate the same warmed renderer without reloading or running two arenas at once.
Object.assign(window, { arenaBenchmark: {
  setPickups(enabled: boolean) {
    baseline = !enabled;
    for (const p of players) p.effects = {};
    count = cost = 0; start = performance.now();
  },
  population() { return { players: players.length, bugs: bugs.length, globs: globs.length, shots: shots.length,
    impactSlots: MAX_EVENTS, pickups: baseline ? 0 : pickups.length, effects: baseline ? 0 : players.filter(p => p.status === "active").length * 3 }; },
} });
function frame(now: number) {
  const begin = performance.now(), width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  if (!quiet && now - lastBurst > 650) { renderer.events(Array.from({ length: MAX_EVENTS }, (_, i) => ({ id: eventId++, tick: 1, ...impactPosition(i), ...(hiveScene && i === 0 ? { type: "kill" as const, kind: "hive" as const, points: 0, rewards: players.map(p => ({ playerId: p.id, life: 1, amount: 65, x: p.x, y: p.y })) } : i % 4 === 0 ? { type: "glob-pop" as const, points: 5 as const } : i % 4 === 1 ? { kind: "beetle" as const, type: "bounce" as const, points: 0 as const } : i % 4 === 2 ? { kind: "dasher" as const, type: "kill" as const, points: 30 } : { kind: "dasher" as const, type: "hit" as const, points: 0 as const }) })), now); lastBurst = now; }
  const view = worldView(width, height);
  if (rescue) for (const p of players) if (p.status === "downed") p.downedUntil = now + 10000 - now % 10000;
  for (const p of players) if (!baseline && p.status === "active") { p.effects.shield = now + 15000; p.effects.spread = p.effects.rapid = now + 6000; }
  for (const p of pickups) p.expiresAt = now + 12000;
  renderer.draw(width, height, panelReview ? cameraFor(1200, 28, width, height) : cameraFor(1200, 1200, view.width, view.height), players, players[0]!, input, bugs, shots, 6, now / 50, now, panelReview ? 1 : view.scale, undefined, now % 500, globs, baseline ? [] : pickups);
  if (showStats) { ctx.fillStyle = "#060b12dd"; ctx.fillRect(10, height - 40, 290, 30); ctx.font = "14px monospace"; ctx.fillStyle = "#e3eee8"; ctx.fillText(`${canvas.dataset.fps ?? ""} FPS · ${canvas.dataset.frameMs ?? ""} ms/frame`, 20, height - 20); }
  cost += performance.now() - begin; count++;
  if (now - start >= 1000) { canvas.dataset.fps = (count * 1000 / (now - start)).toFixed(1); canvas.dataset.frameMs = (cost / count).toFixed(3); canvas.dataset.sample = String(++samples); count = cost = 0; start = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
