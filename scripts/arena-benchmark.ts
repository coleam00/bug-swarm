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
const bugs = Array.from({ length: MAX_BUGS }, (_, i) => {
  const b = createBug(i < 12 ? "spitter" : i % 5 === 0 && !windupOnly ? "crawler" : "dasher", i, 650 + i % 15 * 70, 750 + Math.floor(i / 15) * 65);
  if (b.kind === "dasher") { b.phase = windupOnly ? "windup" : ["approach", "windup", "dash", "recovery"][i % 4]; b.phaseUntil = 700; b.facing = i * 0.7; }
  if (b.kind === "spitter") { b.phase = "swell"; b.phaseUntil = 500; }
  return b;
});
const rescue = new URLSearchParams(location.search).has("revive");
if (rescue) for (let i = 1; i < players.length; i++) {
  const p = players[i]!; p.status = "downed"; p.hits = 0; p.reviveMs = i % 4 * 500; p.reviving = i % 2 === 0;
  // Both on-screen rings and off-screen indicators, bounded by room membership.
  if (i > 10) { p.x = i % 2 ? 100 : 2300; p.y = i % 3 ? 100 : 2300; }
}
// Keep the expanded projectile/effect bounds inside the world and desktop view.
const impactPosition = (i: number) => ({ x: 800 + i % 33 * 25, y: 950 + Math.floor(i / 33) * 25 });
const shots = Array.from({ length: MAX_SHOTS }, (_, i) => ({ id: 500 + i, owner: String(i % 20), life: 1, born: 0, ...impactPosition(i), vx: 900, vy: 0 }));
const globs = Array.from({ length: MAX_GLOBS }, (_, i) => ({ id: 1800 + i, born: 0, x: 850 + i % 4 * 160, y: 950 + Math.floor(i / 4) * 130, vx: -320, vy: 0 }));
const pickups = Array.from({ length: MAX_PICKUPS }, (_, i) => ({ id: 2000 + i, kind: (["shield", "spread", "rapid"] as const)[i % 3]!, x: 900 + i * 90, y: 1100, expiresAt: 0 }));
const baseline = new URLSearchParams(location.search).has("baseline");
let count = 0, start = performance.now(), cost = 0, lastBurst = 0, eventId = 1;
function frame(now: number) {
  const begin = performance.now(), width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  if (now - lastBurst > 650) { renderer.events(Array.from({ length: MAX_EVENTS }, (_, i) => ({ id: eventId++, tick: 1, ...impactPosition(i), ...(i % 3 === 0 ? { type: "glob-pop" as const, points: 5 as const } : i % 2 ? { kind: "dasher" as const, type: "kill" as const, points: 30 } : { kind: "dasher" as const, type: "hit" as const, points: 0 as const }) })), now); lastBurst = now; }
  const view = worldView(width, height);
  if (rescue) for (const p of players) if (p.status === "downed") p.downedUntil = now + 10000 - now % 10000;
  for (const p of players) if (!baseline && p.status === "active") { p.effects.shield = now + 15000; p.effects.spread = p.effects.rapid = now + 6000; }
  for (const p of pickups) p.expiresAt = now + 12000;
  renderer.draw(width, height, cameraFor(1200, 1200, view.width, view.height), players, players[0]!, input, bugs, shots, 6, now / 50, now, view.scale, undefined, now % 500, globs, baseline ? [] : pickups);
  cost += performance.now() - begin; count++;
  if (now - start >= 1000) { canvas.dataset.fps = (count * 1000 / (now - start)).toFixed(1); canvas.dataset.frameMs = (cost / count).toFixed(3); count = cost = 0; start = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
