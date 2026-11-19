# Tabs vs Spaces validation

Recorded on 2026-11-19 on the factory Windows desktop, Bun 1.4.2 and headless Chrome for Testing 156.0.8078.4. The production Vite bundle ran with touch emulation at 390×844 and 844×390 CSS pixels. No simulation or frame-loop code changed, so no frame-rate benchmark was required.

`bun install`, the adjacent persistence/API/identity/Session/React/owner-command tests, `bun run build`, and `bun run check` passed. The check ran TypeScript and all 141 tests across 24 files (13,409 assertions), including production startup and browser bundle coverage.

## Phone measurements

The [raw rectangles and timings](team-evidence/measurements.json) accompany the screenshots. All measured screens had zero horizontal overflow.

| Screen | Control | Size | Bottom edge in portrait |
| --- | --- | --- | --- |
| First / legacy entry | Each team choice | 165×48 px | 465.4 px |
| Accepted finish with team total | Play again | 115×48 px | 364 px |
| Two zero totals | Play again | 115×48 px | 396 px |
| Loading totals, all four upgrades | Play again | 115×48 px | 336 px |
| Populated totals, all four upgrades | Play again | 115×48 px | 364 px |
| Save, best, leaderboard and totals failures, all four upgrades | Play again | 115×48 px | 336 px |

Play again is fully visible in every portrait case and remains operable in landscape. The upgrade summary and top 10 scroll below it in the short landscape panel. Labels remain visible outside a zero-width segment. The React integration separately checks 75/25 and 0/100 proportions, loading, unavailable and empty states, one-tap restart without duplicate starts, and scroll protection.

Screenshots: [first entry](team-evidence/entry.png), [legacy entry](team-evidence/legacy-entry.png), [landscape entry](team-evidence/landscape-entry.png), [accepted finish](team-evidence/real-finish.png), [empty race after hide](team-evidence/hidden-zero.png), [loading](team-evidence/loading-upgrades.png), [populated race](team-evidence/populated-upgrades.png), [all failures](team-evidence/failed-upgrades.png), [landscape failures](team-evidence/landscape-failed.png).

Automated entry took 224 ms from navigation through name fill, layout screenshots and tapping Tabs to a mounted canvas; returning entry took 42 ms. With every API request aborted, a fresh player selected Spaces and mounted the canvas in 48 ms. These are local automated timings, not measurements of human typing or deployed network latency. Both team choices were exercised. Legacy entry preserved its UUID and fixed name; reload started directly without another prompt. The isolated React integration additionally exercised unavailable browser storage and offline selection across restarts/reloads.

## Real finish and moderation

The browser created and finished a real server run in a fresh SQLite database using the production API and Session. Its saved score appeared in Tabs. The probe then ran the actual `bun run hide "Team Robot"` command through a separate process against that same scratch `DATA_DIR`. Foreground game-over polling replaced the race with zero totals in **2,360 ms**, below five seconds. A touch on Play again produced exactly one new start.

Loading/populated/failure screenshots use controlled read responses and a forced Session death with all four upgrade counts. Those synthetic 80-second finishes are deliberately rejected by the real elapsed-time check, which also supplies the save-failure screenshot. They are layout evidence; the preceding accepted finish and hide measurement use real responses. No uncaught browser errors occurred in the completed probe.

## Conflict recovery after review

The real-API React integration now opens two entry screens backed by shared storage and one existing teamless SQLite player. Choosing Tabs followed by Spaces originally reproduced a failed start; it now preserves the UUID/name, restores Tabs in memory and storage, and saves the run. It also covers an already-conflicted identity on an online reload and an offline reload followed by the next online start. Those saves add to Tabs; permanent server membership stays unchanged.

Repeated the production-build Chrome probe in scratch storage, extending it with two actual tabs sharing a legacy identity. The second tab's starts returned **409, 201** after its conflicting choice, and **409, 201** after reloading an intentionally conflicted saved identity. Both finishes were accepted and credited to Tabs, the saved UUID was preserved, and reload required no selection. The original portrait/landscape, offline, restart and moderation checks still passed; hide appeared after 2,359 ms. Browser and database handles were closed, with no HTTP listener or existing service involved.

Mutation checks confirmed that accepting a blocked name, moving the race below the leaderboard, or swapping the required team colours each fails the adjacent tests. Equivalent entry/status feedback and failure-log wording still passes; assertions check feedback presence, the logged error/run id, race placement and each named team's actual colour.

## Reproduce

Build with `bun run build`. In a fresh scratch directory, install `playwright-core` (validation tooling only; it is not a project dependency). Set `SCRATCH` to that directory and optionally `CHROME` to a Chrome for Testing executable, then run `bun docs/team-validation.probe.ts` from the repository. The script writes evidence under `docs/team-evidence/`.

The [probe](team-validation.probe.ts) creates a fresh database directory for each run and gives Chrome and the hide command a scratch home. It opens no HTTP listener: Playwright intercepts the synthetic HTTPS origin and dispatches API requests directly through the real Hono app; static requests read the built bundle. Chrome uses Playwright's temporary profile and debugging pipe. Every request is intercepted, and the browser and SQLite handle close before exit. No existing service or operator database is used. On this machine the system Chrome channel rejected debugging startup; the completed run used the Chrome for Testing executable instead.
