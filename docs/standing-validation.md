# Personal standing validation (issue 42)

Validated on Windows with Bun 1.4.2 and headless Chrome 157.0.8103.51, using the actual production build and React game/board screens. No gameplay or frame-loop code changed.

The API servers, SQLite files, homes and Chrome profiles were scratch-owned. Servers listened only on Unix sockets inside the scratch directory, never an existing TCP listener. A fetch preload mapped the load harness's `http://swarm.test` origin to its owned socket; Playwright forwarded browser requests to that same socket through a Bun bridge. This measures local HTTP/application latency, not deployment or internet latency. All started processes were stopped after validation.

## Automated checks

- `bun install --frozen-lockfile`: passed without lockfile changes.
- `bun run check`: TypeScript and 444 tests passed.
- `bun run pacing`: the default 20-run matrix passed idle60, evasiveMedian60to180, allDead240 and scoresPlausible; zero score failures. Evasive median 78.69 seconds, longest 136.87 seconds.
- `bun run build`: passed.
- Database/API tests cover earliest-best and id tie breaks, repeated bests, ties needing one point, rank 10/11, zero scores, teamless history, duplicate names, hidden/blocked/reserved names, unfinished/unknown players and retained private bests. Query instrumentation proves 500 different standing reads plus leaderboard reads use one ranking scan per cache generation, including exact expiry, backwards time and finish invalidation.
- Session and React tests cover independent failures/recovery, death/save/poll reads, 2.5-second responses across 2-second polling, newer-applied ordering, late success/failure after restart, cleanup, ranks 1/10/11/37, singular gaps, formatting and highlighting by id despite duplicate names.

## Chrome layouts and replay

For layout, seed twelve finished players in scratch SQLite, ten named `WWWWWWWWWWWWWWWW`, with scores 466,548 downwards. Store the tenth player's identity in `bug-swarm-player`. Load the built game, end its real Session with a synthetic 466,548 score, and inspect the actual rendered overlay. Finish acknowledgements and equal 466,548 team totals are browser fixtures for this layout probe; API persistence and plausibility are covered separately by tests and the real load run. The outside-top-ten screenshot supplies standing #37 of 214 with a 120-point target at #36 and excludes the current id from the top ten.

Measurements and accessibility snapshots: [measurements.json](standing-validation/measurements.json). Every name has one text-line y coordinate and CSS `nowrap`/`hidden`/`ellipsis`; the full validated text stays in the DOM and Chrome accessibility tree. Scores remain visible in their separate column, and team numerals never break. Portrait results scroll vertically; replay stays visible without scrolling. Landscape results retain the existing two-column layout.

| Viewport | Name column / text width (px) | Replay size (px) | Horizontal overflow |
| --- | --- | --- | --- |
| 360 x 800 | 201 / 269 (ellipsis) | 115 x 48 | none |
| 390 x 844 | 231 / 269 (ellipsis) | 115 x 48 | none |
| 667 x 375 | 255 / 255 (fits) | 105 x 48 | none |
| 844 x 390 | 316 / 316 (fits) | 105 x 48 | none |

Screenshots: [360 portrait](standing-validation/game-360.png), [390 portrait](standing-validation/game-390.png), [667 landscape](standing-validation/game-667.png), [844 landscape](standing-validation/game-844.png), [personal target](standing-validation/game-standing-360.png).

Hold both death/save standing reads pending, then repeat with HTTP 503. In both cases an immediate native button activation was rejected by the guard; after readiness, the accessible Play again button started another run while the ranking was still loading or unavailable. Releasing the old responses after restart left the new run's standing empty. Chrome logged the injected failures as expected.

## Board alignment and moderation

The actual `/board` already has a fixed `2ch` rank column, so its CSS stays unchanged. Ranks 9 and 10 had identical widths and name starts at every tested width:

| Width | Rank width (px), both rows | Name x (px), both rows |
| --- | --- | --- |
| 360 / 390 | 23.4375 | 49.4375 |
| 667 / 844 | 32.8125 | 66.8125 |
| 1280 | 32.8125 | 662 |

Screenshots: [phone board](standing-validation/board-360.png), [desktop board](standing-validation/board-1280.png). Board names keep their existing wrapping behavior.

With healthy real reads, run `bun run hide "WWWWWWWWWWWWWWWW"` against the UI server's scratch `DATA_DIR`. All ten duplicate-name players disappeared from game over and `/board`, and the current-player highlight disappeared. The current player changed from #10 of 12 to `{ rank: null, total: 2, next: null }`; the last player changed from #12 targeting #11 to #2 targeting #1, needing two points. Both views observed moderation within 1,974 ms, including bringing each page to the foreground. The independent best remained available.

## Capacity

Run a five-player/six-second smoke workload, stop its server, then use a fresh database and server for the default 500-player/60-second workload. The dedicated scratch server used the documented 10,000 start limit (`LOAD_TEST_START_LIMIT=10000`, passed as the equivalent `createApp` startLimit option). The real `scripts/load.ts` workload, validation, deadlines and thresholds ran unchanged except for the socket transport preload. Ordinary TCP reproduction commands remain in [load-validation.md](load-validation.md).

Smoke: 5 accepted starts/finishes, 69 requests, zero failures, 100% under 200 ms. Measured run: **500 accepted starts and finishes**, 41,456 requests, **zero failed requests or 5xx**, **99.03% successful under 200 ms**. Scheduling 60.001 s; drain 0.032 s. Every required read route succeeded.

| Route | Requests | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- |
| POST start | 500 | 463.26 | 867.68 | 902.70 |
| POST finish | 500 | 1.97 | 3.86 | 23.04 |
| GET best | 1,000 | 2.25 | 10.91 | 23.11 |
| GET standing | 13,144 | 0.20 | 6.32 | 11.09 |
| GET leaderboard | 13,156 | 0.32 | 6.52 | 11.31 |
| GET teams | 13,156 | 0.32 | 7.94 | 12.90 |
| Overall | 41,456 | 0.30 | 8.07 | 179.16 |

The simultaneous start burst exceeds 200 ms for many starts; the unchanged overall 95% threshold passes. Standing requests are included on death, acknowledged save and each two-second player poll. The five-second stream observer still reads leaderboard and teams only.
