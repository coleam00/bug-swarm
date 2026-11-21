# Arena results and moderation validation (issue 69)

Earlier slice evidence below is historical. The game now runs at `/` through StartScreen; `/arena` redirects there. Current entry, HUD, minimap and touch validation: [cutover-validation.md](cutover-validation.md).

Validated 2026-11-20 with the production Vite bundle and the production
`createServer` boundary, bound to an owned ephemeral loopback port. SQLite,
scratch homes, browser profiles and logs stayed under `.evidence/69/`.
Chrome 157.0.8103.51 used separate desktop and touch storage contexts.

## Automated checks

- `bun run check`: 581 tests passed, including TypeScript checking.
- `bun run build`: passed.
- Mixed release 1/arena fixtures cover best, ranking/ties/next gap, team
  snapshots, hidden and unfinished exclusion, and unchanged rows after reopen.
- A 9,001-point authoritative life with zero kills in one second is immediately
  eligible and absent from the actual review CLI; release 1 finish plausibility,
  review thresholds and arena HTTP-finish refusal retain their existing tests.
- Mixed stats fixtures count four finishes across two players, including held
  and hidden history, duplicate finishes and finish-time bounds. Two touch lives
  produce `players: 2`, `finished_runs: 4`, `median_runs_per_player: 2.0`,
  `touch_share: 50%`.
- Deferred reads and a fake scheduler cover save transitions, independent
  failures/recovery, polling, slow and out-of-order replies, respawn, disposal
  and reconnects reusing life 1. React tests exercise the shared presentation
  and actual Arena effects/gestures; the release 1 App regression passes.
- The real-server moderation test invokes hide in another process and checks
  exact error wording, closure within five seconds, removal from peer snapshots
  and population, future joins under existing/new identities, and retained rows.

## Production Chrome and bots

Ran `bun run bots -- --url <owned-origin> --count 18 --seconds 60 --policy aimer`
with two Chrome identities in one full arena: 18 joins, zero errors, tick p95
**1.5213 ms** over 1,181 samples. At the full-arena readout the desktop reported
**60.0 FPS / 0.245 ms per frame**, and touch **60.0 FPS / 0.230 ms per frame**.
Measurements are from local headless Chrome. Results reads add no work to the
animation loop or server tick.

Natural deaths and successive lives showed the authoritative score, best,
ranking, gap and team race. HTTP responses matched the visible results after
the two-second polling cadence. Captured rank 1 (no gap), rank 2 (top-10
acknowledgement plus next gap), and ranks 19/20. The latter showed Tabs 4,139
and Spaces 3,927; `/board` displayed the arena top ten and team race.

Chrome two-point touch emulation exercised both sticks in 390 x 844 portrait
and 844 x 390 landscape. Results fit both layouts without horizontal overflow;
Play again measured 180 x 52 px. Held Space at death did not replay; fresh
Enter, Space and touch did. An injected standing HTTP 503 showed Ranking
unavailable while best and teams remained visible, and polling recovered when
the route returned. A 3.5-second best read still displayed across overlapping
polls. Focused Play again activation with Enter and Space each sent exactly
one respawn; Space replay worked while the best read was still pending.

The stats CLI began with zero players/finishes. After two natural browser lives
each and the bot session, it reported:

```text
players: 20
finished_runs: 22
median_runs_per_player: 1.0
touch_share: 9%
```

The contemporaneous database snapshot contained 22 finished arena rows, two
with touch (2 / 22 rounds to 9%). Later departures and moderation also save
lives, so the database after cleanup contains further finishes.

`bun run hide " desktop69 "` produced the exact error
`That name isn't allowed.` and close code 1008 in **336 ms** from invocation.
The player left the live arena, and a subsequent saved-identity join was refused.

## Evidence

The checkout-local `.evidence/69/` contains `check-final.log`, `build.log`,
`bots.json`, `production-validation.json` (HTTP/results, stats, frame readouts,
wire observations and hide timing), `keyboard.json`, and Chrome screenshots:
`desktop-results.png`, `desktop-second-life.png`, `touch-results-portrait.png`,
`touch-results-landscape.png`, `touch-second-life.png`, `ranking-failed.png`,
`slow-best-ready.png`, `board.png` and `live-hide.png`. The scratch probes are
`validate.ts` and `keyboard.ts`. All owned browsers, bot processes and servers
were closed after validation.

## Review follow-up

The entry regression now interleaves pointer-down, pending-to-saved/failed
acknowledgement and pointer-up through the actual Arena component. Each tap
must send one touch-attributed respawn. Replacement/removal (including a reused
life number), blur, visibility change, scrolling and cancellation still reject
stale gestures. Production Chrome repeated both acknowledgement interleavings
with two natural deaths, a held touch and controlled WebSocket delivery; each
tap advanced exactly one life.

The same component test checks the numerical life score, best, rank/population,
gap/target, both team totals and the player IDs requested by best and standing.
Mutations of score, best, rank, gap, Spaces total, request IDs and both tap
races fail the test; changing only the save-failure wording passes. Asynchronous ordering remains
covered in the results-controller tests. Follow-up logs, mutation results and
Chrome screenshots are under `.evidence/69/revision/`.
