# Architecture

## Stack
- Bun (runtime, package manager, test runner), TypeScript strict, Vite for the browser build, Canvas 2D for the game, Hono on Bun for a small API, SQLite through `bun:sqlite` for runs and scores.
- Why: the bootcamp's supported stack, with the same commands on Windows, macOS and Linux. A game loop needs no UI framework; the server exists for the shared leaderboard and the bet.
- The scaffolded React screen stays only as a thin shell for name entry and the game-over screen around the canvas. No React in the game loop.

## How it runs
- Install: `bun install`
- Develop: `bun run dev` (Vite dev server for the game, with the API server beside it)
- Start (production mode): `bun run build` then `bun run start`: one Bun process serves the API and built game from `dist/` on `0.0.0.0` and `PORT` (default 3000). `bun run dev` keeps the API on `127.0.0.1`. `/board` arrives in Phase 3.
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
- `src/web/App.tsx`: name entry, the canvas/HUD, the game-over screen. Team entry arrives in Phase 3.
- `src/web/game/`: the game in plain TypeScript.
  - The simulation (robot, bugs, shots, hits) is pure: it advances by a time step from input and seeded state, with no canvas, DOM or clock access, so `bun test` covers it. Phase 1 uses a steady spawn rate and placeholder circles; ramp, upgrades and effects arrive in Phase 2.
  - The loop runs on `requestAnimationFrame` with a fixed time step and draws the state to the canvas, scaled to the screen in portrait or landscape.
  - Input: touch drag (the robot moves toward the finger), WASD and arrow keys, mouse steering, F for the rolling FPS and update/draw-time readout. Keys take priority over the mouse. Each run samples the browser viewport at start: its arena keeps 360,000 logical units squared and follows the viewport aspect ratio, clamped to 9:16 through 16:9. Rotation only rescales the active arena; the next run adopts the new shape.
  - The API client starts a run and submits its score without blocking the loop; failures are logged and the game-over screen says the score wasn't saved.
- `src/web/game/session.ts`: asynchronous run lifecycle, immutable finish payloads, save/read status and polling. Late responses stay attached to their original local run. Requests time out after five seconds; no offline submission queue.
- `src/web/board/`: planned Phase 3 stream page (top 10 and team totals).
- `src/server/app.ts`: `/health`, `POST /api/runs`, `POST /api/runs/:runId/finish`, `GET /api/leaderboard`, `GET /api/players/:playerId/best`, and the legacy `GET /api/events/count`. Teams arrive in Phase 3.
- `src/server/db.ts`: the SQLite file, its tables, `EVENT_TYPES` (`run_started`, `run_ended`) and `TEAMS` (`tabs`, `spaces`). Schema changes are additive.
- `src/server/rules.ts`: name rules and score plausibility (max points per second of real elapsed time), both pure and tested.
- `src/server/blocked-words.ts`: the blocked-word list.
- `src/server/main.ts`: production entry; reads `PORT` and `DATA_DIR` (default `data/`).
- `scripts/stats.ts`, `scripts/hide.ts`; `scripts/load.ts` arrives in Phase 3.
- Tests are `*.test.ts` beside the code.

## Data
- **Player:** a random UUID the browser creates on first visit and keeps in local storage, with a validated name and (Phase 3) a team. No account. Names are fixed for an id; clearing storage creates a new player. Storage failures retain identity for the visit.
- **Run:** `run_started` (run id, player id, server time) and `run_ended` (run id, score, squashes, seconds, upgrades, touch or not). A run with no `run_ended` was abandoned.
- **Hidden names:** a table the top 10 and the board filter on; `bun run hide` adds to it.
- **Top 10:** one best accepted score per player, excluding hidden names and names that fail current validation. Ties go to the earliest finish achieving that best, then player id. Cached for one second and invalidated after a finish; game-over clients poll every two seconds. Best scores and bet stats include hidden players.
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
- Spawn rates, bug speed and upgrade strength: start from the PRD's targets (idle player loses within 60 s, typical run 1 to 3 minutes) and tune after Phase 2.
- Art: drawn in code on the canvas (see `direction.md`, "The look"). Effects live in `src/web/game/fx/` (particles, trails, screen shake, floating text), pooled so they allocate nothing per frame.
