# Architecture

## Stack
- Bun (runtime, package manager, test runner), TypeScript strict, Vite for the browser build, Canvas 2D for the game, Hono on Bun for a small API, SQLite through `bun:sqlite` for runs and scores.
- Why: the bootcamp's supported stack, with the same commands on Windows, macOS and Linux. A game loop needs no UI framework; the server exists for the shared leaderboard and the bet.
- The scaffolded React screen stays only as a thin shell for name entry, upgrade choices and the game-over screen around the canvas. No React in the game loop.

## How it runs
- Install: `bun install`
- Develop: `bun run dev` (Vite dev server for the game, with the API server beside it)
- Start (production mode): `bun run build` then `bun run start`: one Bun process serves the API and built UI from `dist/` on `0.0.0.0` and `PORT` (default 3000). `bun run dev` keeps the API on `127.0.0.1`. `/board` (also `/board/`) is the stream display in both modes.
- Container: `Dockerfile` builds the game and runs `bun run start`; `DATA_DIR` must be a persistent volume.
- Health: `GET /health` answers `200 ok` once the app is ready.
- Test everything: `bun run check` (`tsc --noEmit`, then `bun test`). CI runs exactly this.
- The bet's command: `bun run stats`. Moderation: `bun run hide "<name>"`. Load test (Phase 3): `bun run load`.

### Container

Build and run with a persistent data directory:

```sh
docker build -t bug-swarm .
docker volume create bug-swarm-data
docker run --rm --name bug-swarm-smoke -e PORT=8080 -e DATA_DIR=/data -p 8080:8080 -v bug-swarm-data:/data bug-swarm
```

Open `http://localhost:8080/`; `http://localhost:8080/health` answers `200 ok`.
The image builds the web bundle and runs `bun run start` in production mode.
Without `DATA_DIR`, the default relative `data/` directory resolves to `/app/data` in the image.
Persistent deployments should mount their chosen `DATA_DIR`; the example stores `/data/app.db` in the named volume and reuses it across restarts.

## Shape
- Browser game -> HTTP API -> one SQLite file.
- `src/web/App.tsx`: name and permanent team entry, the canvas/HUD, the game-over screen with the team race directly under the score. Play again precedes the upgrade summary and top 10.
- `src/web/game/`: the game in plain TypeScript.
  - The simulation (robot, bugs, shots, hits) is pure: it advances by a time step from input and seeded state, with no canvas, DOM or clock access, so `bun test` covers it. Spawn intervals interpolate from 1 second at start to 0.8 at 30 seconds, 0.4 at 60 and 0.2 at 120, then hold. The first scheduled spawn at or after 30 seconds is fast, followed by every fourth eligible spawn. Bug definitions (speed, radius, color and unlock time) and pacing constants live in `src/web/game/config.ts`. Both bug kinds die in one shot. Four upgrade rules extend this same simulation; see the upgrade lifecycle below.
  - `draw.ts` owns the procedural renderer; `assets.ts` caches the full rectangular world's grid and vignette, glows and score glyph on detached canvases. Cache keys include canvas size, DPR and run geometry. `styles.ts` holds the beetle colours, dimensions and gait for both base and fast kinds; the fast beetle is smaller, brighter and quicker. Collision radii still come from `config.ts`.
  - `fx/` owns fixed-capacity particles (1024), trail samples (128), floating labels (256), hit flash and shake. Full pools drop new emissions and reuse expired slots. The read-only scored-kill checkpoints and fixed-step comparisons in `fx/feedback.ts` distinguish shot squashes from contact removals without changing simulation rules or its random seed. Visual time freezes during upgrade choices, continues after death and resets with focus/run lifecycle.
  - The loop runs on `requestAnimationFrame` with a fixed time step and draws the state to the canvas, scaled to the screen in portrait or landscape.
  - Input: touch drag (the robot moves toward the finger), WASD and arrow keys, mouse steering, F for the rolling FPS and update/draw-time readout. Keys take priority over the mouse. Each run samples the browser viewport at start: its arena keeps 360,000 logical units squared and follows the viewport aspect ratio, clamped to 9:16 through 16:9. Rotation only rescales the active arena; the next run adopts the new shape.
  - The API client starts a run and submits its score without blocking the loop; failures are logged and the game-over screen says the score wasn't saved.
- `src/web/game/session.ts`: asynchronous run lifecycle, immutable finish payloads, save/read status and polling. Best, leaderboard and team totals refresh independently on death and acknowledged save; leaderboard and teams poll every two seconds while subscribed on game over. Late responses stay attached to their original local run, and only a newer applied response supersedes an older response. Restart and detachment stop polling. Requests time out after five seconds; no offline submission queue.
- `src/web/route.ts`: dynamically loads the stream board for `/board` and `/board/`, or the game elsewhere. The board never imports the game screen, engine, identity storage or game CSS.
- `src/web/board/`: read-only React stream page with the server's top 10 and Tabs vs Spaces totals. `model.ts` validates snapshots, preserves returned ordering, maps proportional race bars and owns three-second arrival/overtake highlights. `polling.ts` reads both endpoints immediately and every two seconds, independently; the shared API client's five-second deadline bounds overlapping reads. Only newer applied responses supersede older results. Failures retain that endpoint's last successful snapshot and retry after 2, 4, then 8 seconds (capped), with a small reconnecting note; recovery resets the cadence. Missing data shows waiting placeholders, distinct from successful empty/zero data. Cleanup invalidates pending responses and clears timers. The join link uses the page's own origin. Desktop uses two ordered columns with 40 px names/scores and 64 px totals; phones use a scrolling column. Evidence and isolation limitations: [docs/board-validation.md](docs/board-validation.md).
- `src/server/app.ts`: `/health`, `POST /api/runs`, `POST /api/runs/:runId/finish`, `GET /api/leaderboard`, `GET /api/teams` (`{ tabs, spaces }` numeric totals), `GET /api/players/:playerId/best`, and the legacy `GET /api/events/count`.
- `src/server/db.ts`: the SQLite file, its tables and `EVENT_TYPES` (`run_started`, `run_ended`). It re-exports `TEAMS` from `src/shared/teams.ts`, the browser-safe registry of ids, names and colours (Tabs orange `#ff9f43`, Spaces teal `#2ed3c6`). Schema changes are additive.
- `src/server/rules.ts`: name rules and score plausibility (max points per second of real elapsed time), both pure and tested.
- `src/server/blocked-words.ts`: the blocked-word list.
- `src/server/main.ts`: production entry; reads `PORT` and `DATA_DIR` (default `data/`).
- `scripts/stats.ts`, `scripts/hide.ts`; `scripts/load.ts` arrives in Phase 3.
- Tests are `*.test.ts` beside the code.

## Data
- **Player:** a random UUID the browser creates on first visit and keeps in local storage, with a validated name and a permanent team. No account. Names are fixed for an id; clearing storage creates a new player. Legacy identities keep their UUID/name and choose a team once on next entry; invalid stored teams also require selection. Choosing stores locally and starts immediately, even offline or when storage fails. Every start sends the saved team so an offline selection can reach the server later.
- **Start:** an immediate transaction validates the fixed name, assigns membership, snapshots the team on the run and records its event. New server players require a team (400 if absent); supplied invalid values including null return 400. Existing teamless players may omit it and still play, or assign it once. Assigned players may omit or repeat their team; name or team changes return 409. Failed starts roll back membership, run and event together.
- **Conflicting browser selections:** a team conflict returns 409 with `code: "team-conflict"` and the stored `team`. Session adopts that authoritative team, updates the browser identity without changing UUID/name, and retries the same local run's start once. This repairs stale entry tabs and already-conflicted saved identities, including on reload. Other start errors are not retried. Simulation starts immediately throughout; offline play and in-memory identity retention on storage failure still apply. The server never switches membership.
- **Run:** `run_started` (run id, player id, server time, nullable team snapshot) and `run_ended` (run id, score, squashes, seconds, upgrades, touch or not). A run with no `run_ended` was abandoned. Additive nullable `players.team` and `runs.team` columns restrict values to the shared registry. Existing rows stay null with no backfill: historical runs and runs started while teamless never count, even if finished after assignment. Finish cannot supply team attribution.
- **Hidden names:** a table the top 10 and the board filter on; `bun run hide` adds to it.
- **Top 10:** one best accepted score per player, excluding hidden names and names that fail current validation. Ties go to the earliest finish achieving that best, then player id. Cached for one second and invalidated after a finish; game-over clients poll every two seconds. Best scores and bet stats include hidden players.
- **Team race:** sums every finished run with an eligible team snapshot, excluding hidden names (including duplicate names). It includes all scores, rather than personal bests or only ten players. Both keys appear as zero for an empty database. Totals have their own one-second cache, also expiring on backwards clock movement and invalidated on finish; all API reads use `Cache-Control: no-store`. Separate-process moderation appears through expiry and foreground polling within five seconds while reads succeed. On game over, team read failures clear the race and show unavailable text without affecting saves or restart. The stream board retains last-good totals during outages. Zero totals show a neutral equal split; positive totals use proportional bars with labels outside the segments. Chrome phone layout and moderation evidence: [docs/team-validation.md](docs/team-validation.md).
- **Persistence:** additive `players`, `runs`, `hidden_names` tables plus linked `events`, retaining legacy `opened` events. Start and finish each transact the run and its event together. Identical finish retries succeed; conflicting retries return 409. WAL and a five-second busy timeout support the owner commands alongside the server.

### Owner commands

Both commands use `DATA_DIR/app.db` (default `data/app.db`). Stats count accepted finishes only, never abandoned starts or legacy opens:

```sh
bun run stats
bun run stats -- --since 2026-11-28T09:00:00-06:00 --until 2026-11-28T10:15:00-06:00
bun run hide "Test Robot"
```

Filters may be used independently and require ISO timestamps with a timezone. Finish time is server time; since is inclusive and until is exclusive. The four stdout lines are `players`, `finished_runs`, `median_runs_per_player` (one decimal, over players with a finish), and `touch_share` (rounded whole percent). A missing database prints zeros without creating it. Bad flags fail to stderr with no partial report.

Hide trims and lowercases the name, hides all players using it, and is idempotent. It accepts now-blocked names and never deletes history. A foreground game-over board observes it within five seconds through cache expiry and polling. Blocked-word matching separately ignores case and the substitutions 0/o, 1/i, 3/e, 4/a, 5/s.

## Hosting
- Railway, from the `Dockerfile`, with a volume mounted at `DATA_DIR` and GitHub auto-deploy on `main`, so a merged change reaches players within minutes. One instance (SQLite needs one long-running process with a disk). The owner sets up the Railway project; the app only has to honor `PORT` and `DATA_DIR`.

## Boundaries
- No API keys and no outside services. The app starts and `bun run check` passes with no `.env`.
- Public on the internet during the stream: the API accepts only well-formed requests with capped sizes, at most one score per run id, scores that pass the plausibility check, and at most 30 run starts per IP per 10 minutes.
- JSON bodies are capped at 4 KiB. Scores must equal `10 * squashes + seconds`. Server elapsed time permits at most six squashes per second and two seconds of slack for survival seconds. Constants live in `rules.ts`.
- Peer IPs come from Bun; forwarded headers are ignored by default. Behind a reverse proxy, set `TRUSTED_PROXIES` to a comma-separated list of exact trusted peer addresses. Only those peers may supply `X-Forwarded-For`, walked from the trusted end. Configure the proxy to append the actual client address and avoid trusting public client addresses. Limits are in memory and reset on process restart.
- Nothing the player does depends on a server response; a run plays with the API down.

## Decisions deferred
- Human pacing and upgrade strength: current swarm tuning targets idle death in 30–60 seconds and moving survival in 60–180 seconds, checked with deterministic seed/arena matrices. Scripted dodging is a regression aid; the owner's five human runs with upgrades remain the Phase 2 pacing validation.

## Rendering validation

`scripts/look-benchmark.html` is a developer-only Vite page using the production renderer, fixed stepper and effects. It keeps 150 bugs present without an API or database. It is excluded from the production entry points. Reproduction steps, measurements and device limitations are in [docs/look-validation.md](docs/look-validation.md).

## Upgrade contract and choices

`src/shared/upgrades.ts` owns the four ids, names and 20-second interval. Finish requests carry acquired upgrades as `{ id, count }` entries, once each in registry order. Counts record picks, independent of remaining combat resources. The server accepts legacy omitted upgrades as `[]`, validates total picks against survival seconds, normalizes ordering and includes the normalized build in identical-retry comparisons. The existing `runs.upgrades` JSON column and its linked `run_ended` event commit together. No additional event payload or migration is needed. Choice pauses need no server-clock change: elapsed time is an upper bound.

`game/upgrades.ts` maintains counts and three distinct seeded offers. Its independent LCG starts at `seed XOR 0x9e3779b9`, leaving spawn randomness untouched. Choice numbers reject delayed selections. The simulation clamps steps at each 20-second gameplay boundary, resolves that interval, and offers a choice only if still alive. Pending choices freeze all gameplay and cooldowns. Selection applies the upgrade synchronously, increments the next boundary and rejects stale run tokens and choice numbers. There is no run cutoff.

The fixed stepper drops catch-up accumulation at choices and resets its timestamp on resume. Feedback receives the actual shortened active duration. The engine clears steering and pointer capture on either transition, freezes visual time during choices and resets the effects clock on resume. Blur/visibility/rotation preserve the pending choice. Session subscriptions publish only transitions, not combat frames.

React displays a native modal dialog with three large button cards, no countdown or dismissal, focus containment and focus restoration to the canvas. Fresh 1-3 keys and touch cards share Session.choose; touch selections mark input attribution. Finish and game-over use the same deeply frozen count summary, isolated from restarts and late API responses.

Review laser gives new shots `1 + picks` penetrations and a longer procedural streak. Swept collisions resolve by segment entry time, then bug id; victims are removed once, preserving survivor ordering for feedback. Shots retain their creation-time budget and lifetime. The benchmark accepts `?profile=laser` to exercise this path with two picks.

Test shield refills available charges to its pick count. A would-be damaging contact consumes one charge instead of health and starts the existing one-second invulnerability period; grouped or invulnerable contacts consume nothing further and never score. A translucent bubble shows remaining protection, with a second outline for multiple charges. `?profile=shield` exercises blocks with two picks.

Refactor bomb arms on acquisition, detonates automatically on the next active step with bugs, and recharges after `30 / picks` gameplay seconds. A repeat pick recalculates readiness from the last detonation. It clears before projectile collisions and contacts, with one squash per victim. `KillObserver.beforeKills/afterKills` bracket all scored removals after spawn/movement and before unscored contacts. Feedback compares bounded scratch slots without a gameplay event queue, and observes a detonation counter/origin to start one reusable half-second expanding ring; a new detonation replaces that cosmetic slot. `?profile=bomb` exercises two-pick clears.

Each CI drone pick adds an invulnerable firing drone, ready on the next active step. Drones orbit at radius 36 and 2 radians/second, evenly spaced using gameplay time. A shared orbit calculation drives rendering and firing; each drone keeps its own one-second timer and targets the nearest bug from its own position, with stable id ties. Drone shots share robot shot speed, lifetime and piercing. Rendering reuses the cached core glow at a smaller size. `?profile=drone` exercises two firing drones.
