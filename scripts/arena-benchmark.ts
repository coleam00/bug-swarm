// Developer-only Vite fixture: simultaneous collection bounds, independent of live play.
import { ArenaRenderer } from "../src/web/arena/draw";
import { ArenaInput } from "../src/web/arena/input";
import { createBug } from "../src/shared/arena/bugs/registry";
import { lifeDefaults } from "../src/shared/arena/types";
import { MAX_BUGS, MAX_SHOTS, MAX_EVENTS, MAX_GLOBS } from "../src/shared/arena/constants";
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
const quiet = new URLSearchParams(location.search).has("quiet");
if (crowdedEdges) {
  for (let i = 1; i < players.length; i++) Object.assign(players[i]!, { status: "downed", hits: 0, x: 2300, y: 1200 });
  if (hiveScene) Object.assign(bugs[bugs.length - 1]!, { x: 2300, y: 1200 });
}
const shots = Array.from({ length: MAX_SHOTS }, (_, i) => ({ id: 500 + i, owner: String(i % 20), life: 1, born: 0, x: 700 + i % 14 * 70, y: 800 + Math.floor(i / 14) * 65, vx: 900, vy: 0 }));
const globs = Array.from({ length: MAX_GLOBS }, (_, i) => ({ id: 800 + i, born: 0, x: 850 + i % 4 * 160, y: 950 + Math.floor(i / 4) * 130, vx: i < 12 ? -320 : -180, vy: 0, ...(i < 12 ? {} : { source: "hive" as const }) }));
if (quiet) { bugs.splice(0, bugs.length - (hiveScene ? 1 : 0)); shots.length = 0; globs.length = 0; }
let count = 0, start = performance.now(), cost = 0, lastBurst = 0, eventId = 1;
let showStats = false;
window.addEventListener("keydown", event => { if (event.code === "KeyF" && !event.repeat) showStats = !showStats; });
function frame(now: number) {
  const begin = performance.now(), width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  if (!quiet && now - lastBurst > 650) { renderer.events(Array.from({ length: MAX_EVENTS }, (_, i) => ({ id: eventId++, tick: 1, x: 700 + i % 14 * 70, y: 800 + Math.floor(i / 14) * 65, ...(hiveScene && i === 0 ? { type: "kill" as const, kind: "hive" as const, points: 0, rewards: players.map(p => ({ playerId: p.id, life: 1, amount: 65, x: p.x, y: p.y })) } : i % 5 === 0 ? { kind: "beetle" as const, type: "bounce" as const, points: 0 as const } : i % 3 === 0 ? { type: "glob-pop" as const, points: 5 as const } : i % 2 ? { kind: "dasher" as const, type: "kill" as const, points: 30 } : { kind: "dasher" as const, type: "hit" as const, points: 0 as const }) })), now); lastBurst = now; }
  const view = worldView(width, height);
  if (rescue) for (const p of players) if (p.status === "downed") p.downedUntil = now + 10000 - now % 10000;
  renderer.draw(width, height, cameraFor(1200, 1200, view.width, view.height), players, players[0]!, input, bugs, shots, 6, now / 50, now, view.scale, undefined, now % 500, globs);
  if (showStats) { ctx.fillStyle = "#060b12dd"; ctx.fillRect(10, height - 40, 290, 30); ctx.font = "14px monospace"; ctx.fillStyle = "#e3eee8"; ctx.fillText(`${canvas.dataset.fps ?? ""} FPS · ${canvas.dataset.frameMs ?? ""} ms/frame`, 20, height - 20); }
  cost += performance.now() - begin; count++;
  if (now - start >= 1000) { canvas.dataset.fps = (count * 1000 / (now - start)).toFixed(1); canvas.dataset.frameMs = (cost / count).toFixed(3); count = cost = 0; start = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
