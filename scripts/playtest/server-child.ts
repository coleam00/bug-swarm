import { createInterface } from "node:readline";
import { createServer } from "../../src/server/server";
import { registerShutdown } from "../../src/server/shutdown";
import { botDriver, validateWarmup, warmRoom } from "./warmup";
import type { LifeObservation, ServerObservation } from "./types";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.ARENA_PLAYTEST !== "1") throw Error("Private playtest child requires ARENA_PLAYTEST=1");
const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
// stdout belongs solely to private control replies; production logs go to evidence.
console.log = (...args: unknown[]) => console.error(...args);
const seconds = Number(process.env.PLAYTEST_WARMUP ?? 0); validateWarmup(seconds, process.env);
let warming = true, clock = performance.now(), offset = 0;
const seed = Number(process.env.PLAYTEST_SEED), generation = Number(process.env.PLAYTEST_GENERATION);
const snapshots: ServerObservation["snapshots"] = [], lives: LifeObservation[] = [];
let app: ReturnType<typeof createServer>;
app = createServer({ port: Number(process.env.PLAYTEST_PORT), hostname: "127.0.0.1", dataDir: process.env.PLAYTEST_DATA!, assets: process.env.PLAYTEST_ASSETS!, playtest: {
  seed: () => seed, now: () => warming ? clock : performance.now() + offset, wallNow: () => Date.now() + (warming ? clock - performance.now() : offset),
  schedule: fn => setInterval(() => { if (!warming) fn(); }, 50),
  observe(snapshot) {
    const copy = structuredClone({ ...snapshot, observedAt: performance.timeOrigin + performance.now() });
    snapshots.push(copy);
    if (snapshots.length > 80) snapshots.shift();
  },
  life(record, arenaId, player) {
    const room = app?.arenas.rooms.get(arenaId);
    const clearance = room?.state.bugs.length ? Math.min(...room.state.bugs.map(b => Math.hypot(b.x - player.x, b.y - player.y))) : null;
    lives.push(structuredClone({ record, arenaId, player, clearance }));
    if (lives.length > 2048) lives.shift();
  },
} });
let warmup: ServerObservation["warmup"], driver: ReturnType<typeof botDriver> | undefined;
if (seconds) { driver = botDriver(app.arenas, Number(process.env.PLAYTEST_BOTS), seed); warmup = await warmRoom(app.arenas, driver, seconds, () => { clock += 50; }, process.env); }
offset = clock - performance.now(); warming = false;
const botTimer = driver ? setInterval(() => driver!.input(), 50) : undefined;
const shutdown = registerShutdown(app, () => writeFileSync(join(process.env.PLAYTEST_ROOT!, `shutdown-${generation}.json`), JSON.stringify(lives)));
createInterface({ input: process.stdin }).on("line", line => {
  try {
    const command = JSON.parse(line);
    if (command.method === "stop") { clearInterval(botTimer); shutdown(); return; }
    if (command.method !== "observe") throw Error("Unknown private command");
    emit({ id: command.id, value: { generation, snapshots, lives, stats: app.arenas.stats(), warmup } satisfies ServerObservation });
  } catch (error) { console.error(error); process.exitCode = 1; }
});
emit({ ready: true, origin: app.server.url.origin, warmup });
