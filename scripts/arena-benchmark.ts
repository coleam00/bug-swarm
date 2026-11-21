// Developer-only Vite fixture: simultaneous collection bounds, independent of live play.
import { ArenaRenderer } from "../src/web/arena/draw";
import { ArenaInput } from "../src/web/arena/input";
import { lifeDefaults } from "../src/shared/arena/types";
import { MAX_BUGS, MAX_SHOTS, MAX_EVENTS } from "../src/shared/arena/constants";
import { cameraFor, worldView } from "../src/shared/arena/view";
const canvas = document.querySelector("canvas")!, ctx = canvas.getContext("2d")!, renderer = new ArenaRenderer(ctx), input = new ArenaInput();
const players = Array.from({ length: 20 }, (_, i) => ({ ...lifeDefaults(), id: String(i), name: `Pilot-${i}`, team: i % 2 ? "tabs" as const : "spaces" as const, x: 850 + i % 5 * 130, y: 900 + Math.floor(i / 5) * 130, vx: 0, vy: 0, facing: i }));
const rescue = new URLSearchParams(location.search).has("revive");
if (rescue) for (let i = 1; i < players.length; i++) {
  const p = players[i]!; p.status = "downed"; p.hits = 0; p.reviveMs = i % 4 * 500; p.reviving = i % 2 === 0;
  // Both on-screen rings and off-screen indicators, bounded by room membership.
  if (i > 10) { p.x = i % 2 ? 100 : 2300; p.y = i % 3 ? 100 : 2300; }
}
const bugs = Array.from({ length: MAX_BUGS }, (_, i) => ({ id: i, kind: "crawler" as const, x: 650 + i % 15 * 70, y: 750 + Math.floor(i / 15) * 65, vx: 140, vy: 0 }));
const shots = Array.from({ length: MAX_SHOTS }, (_, i) => ({ id: 500 + i, owner: String(i % 20), life: 1, born: 0, x: 700 + i % 14 * 70, y: 800 + Math.floor(i / 14) * 65, vx: 900, vy: 0 }));
let count = 0, start = performance.now(), cost = 0, lastBurst = 0, eventId = 1;
function frame(now: number) {
  const begin = performance.now(), width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  if (now - lastBurst > 650) { renderer.events(Array.from({ length: MAX_EVENTS }, (_, i) => ({ id: eventId++, tick: 1, x: 700 + i % 14 * 70, y: 800 + Math.floor(i / 14) * 65, points: 11 })), now); lastBurst = now; }
  const view = worldView(width, height);
  if (rescue) for (const p of players) if (p.status === "downed") p.downedUntil = now + 10000 - now % 10000;
  renderer.draw(width, height, cameraFor(1200, 1200, view.width, view.height), players, players[0]!, input, bugs, shots, 6, now / 50, now, view.scale);
  cost += performance.now() - begin; count++;
  if (now - start >= 1000) { canvas.dataset.fps = (count * 1000 / (now - start)).toFixed(1); canvas.dataset.frameMs = (cost / count).toFixed(3); count = cost = 0; start = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
