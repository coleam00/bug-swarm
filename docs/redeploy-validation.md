# Redeploy validation (issue 66)

Validated on Windows with Bun 1.4.2 and the machine's installed Chrome 157.0.8103.51 (headless, CDP). All servers, SQLite files, homes, browser profiles, logs and the disposable changed-build clone stayed under `.evidence/66/` in this checkout. All owned processes were stopped afterward.

The production Vite artifacts were served through `src/server/main.ts`, without Vite's development server. `NODE_ENV=development` selected the loopback listener for this isolated run; it did not change the packaged build identity. Windows Bun's external process kill does not deliver graceful SIGTERM, so an stdin harness imported the production entry and emitted its registered signal. This is handler evidence, not Windows OS-signal evidence. The subprocess tests use actual SIGTERM/SIGINT on Linux; that branch runs in CI and was not executed locally.

## Production restart evidence

Original packaged commit: `82e278008ee37d2869ef770af1988c2134a13f4d`.
Changed packaged commit: `f0fb49c59d5affc4de5672d23ee692ce92e0f412`, committed and built in `.evidence/66/changed/`. The changed artifact includes a harmless build-config comment; neither build used a runtime build-id override.

One Chrome tab and ten aimer bots were alive before each stop. Each scenario used a fresh bot cohort, the same origin and the same SQLite database. Browser WebSocket events verified unchanged UUID, name and team. Build ids agreed between the browser's hello, server welcome and stats. Times below are monotonic measurements from the signal request, including process exit or receipt of the playable snapshot, respectively.

| Scenario | Process exited | Playable again | Automatic navigations | Active lives saved |
| --- | ---: | ---: | ---: | ---: |
| Same artifact | 38.2 ms | 541.9 ms | 0 | 11/11 |
| Changed commit | 31.8 ms | 572.1 ms | 1 | 11/11 |

Both stops displayed `Score saved: 0. Rejoining...` for the living Chrome player, with the canvas visible and no life-over dialog. The same-build cohort included nonzero bot scores. Per-run SQL checks verified all previously active run ids ended with `end_reason='restart'`, score at least the last observed snapshot score, and exactly one linked `run_ended` event. The terminal packet's confirmed score matched the browser banner. No browser exceptions occurred.

`bun run stats` against that scratch DATA_DIR reported:

| After stop | players | finished_runs | median_runs_per_player | touch_share |
| --- | ---: | ---: | ---: | ---: |
| Same artifact | 11 | 11 | 1.0 | 0% |
| Changed commit | 21 | 22 | 1.0 | 0% |

An additional nineteen-bot cohort filled the arena to twenty players. Chrome's F readout measured 60.0 FPS and 0.383 ms/frame; arena stats measured 1.949 ms tick p95 over 53 ticks. The frame-path addition is a paused-scene check, and the tick-path addition is an admission/shutdown boolean check; persistence remains between ticks. Portrait 390×844 and landscape 844×390 screenshots verified readable, nonmodal saved-score banners. Two simultaneous touch points moved and aimed before another restart, and the subsequent hello retained touch attribution. `/` still displayed the returning-player entry and started release 1 gameplay.

## Checks and reproduction

`bun run check`: **570 passed, zero failed**, 116,535 assertions (44.58 s). `bun run build`: passed. Focused lifecycle, protocol, connection, engine, entry and real-process tests passed. They cover idempotence, multiple rooms, pending starts, dead players, close during drain, rejected joins/respawns, notification ordering, transient and permanent failures, lock release/deadline, repeated signals, exact retry delays, changed-build reload guards, stale sockets, automatic resume and storage fallback. The held-lock subprocess case completed in 4.41 s including startup and assertions, with a failed acknowledgement, logged run ids and exit status 1. Docker and Railway deployment were not run locally.

From a fresh checkout, install dependencies and run the committed harness:

```text
bun install --frozen-lockfile
bun scripts/validate-redeploy.ts
bun run check
```

Run from a clean committed checkout with Bun, Git and Chrome installed. The harness builds both artifacts itself; the standalone build command is optional. If Chrome is not at a conventional installation path, set `CHROME_PATH` to its executable (`$env:CHROME_PATH = 'C:/path/to/chrome.exe'` in PowerShell, or `export CHROME_PATH='/path/to/chrome'` in a POSIX shell).

`scripts/validate-redeploy.ts` creates and prints a unique `.evidence/66/redeploy-*` directory, including a scratch home, temporary directory, database and Chrome profile. It builds this commit, creates a disposable clone with a comment-only commit, and builds that clone using the installed dependencies. It starts only its own loopback servers on an ephemeral port, starts Chrome through CDP and launches ten aimer bots for each restart. It exercises same-build reconnect, changed-build reload, rollback, redeploy to the previously visited build, and a save held by a 3.5-second SQLite lock. It checks navigation counts, identity, saved feedback, per-run restart reasons/events, and stats; then checks full-room timing, phone layouts, two-touch input and release 1. It stops all processes it started even when an assertion fails. All generated outputs remain under the printed evidence directory; no preexisting `.evidence` files or server are needed.

On Windows the harness emits the production entry's registered SIGTERM handler through child stdin; on Linux/macOS it sends OS SIGTERM. Bot CLI disconnect failures at an intentional restart are expected; it does not reconnect. The application uses graceful socket acknowledgements, without persistent receipt replay: a missed acknowledgement produces reconnect feedback without claiming the score was saved.

Evidence files (gitignored):

- `browser-validation.json`, `browser-events.json`, `browser-validation.log`: per-run rows, snapshots, identities and timestamped navigation/socket/overlay events. The original run used a local harness; its reusable replacement is committed at `scripts/validate-redeploy.ts`.
- `same-server.log`, `changed-server.log`, `same-bots.log`, `changed-bots.log`, `same-stats.txt`, `changed-stats.txt`.
- `before-*-restart.png`, `*-saved-overlay.png`, `*-rejoined.png`, `full-room-frame-timing.png`, `portrait-play.png`, `release1-entry.png`, `release1-playing.png`.
- `check-final.log`, `build.log`, `changed-build.log`, `shutdown-tests-2.log`, `storage-tests.log`.
