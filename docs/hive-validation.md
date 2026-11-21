# Hive boss validation (issue 84)

Validated on Windows with Bun 1.4.2 and factory Chrome 157.0.8103.51. Evidence is gitignored under `.evidence/84/`; application databases, temporary directories, browser profiles and child-process homes stayed inside this checkout. Every HTTP/WebSocket origin belonged to a server started by the validation process; all servers, sockets and Chrome processes were closed afterward.

## Rules and bounds

Shipped tuning: radius 48, speed 80 units/s, cluster radius 300, frozen HP `120 + 60 * living players`, three crawlers every four seconds, and twelve 180-unit/s globs every six seconds. Active and downed lives count toward initial HP. Solo kills are allowed. A surviving encounter consumes later fifth-wave triggers. Ordinary spawning reserves one of the shared 150 bug slots; brood consumes available slots without debt. Twelve spitter globs plus twelve hive globs bound the collection at 24.

Placement checks every connected player's position. It evaluates clipped Voronoi candidates rather than relying on random sampling. When no point has 600 units of clearance, the best-clearance location receives a two-second harmless arrival warning. A fixed-step test covers the final warning interval and exact 600-unit activation boundary.

Rewards are **300 + 50N** for N eligible contributors, not a universal 500 points. Integer largest-remainder shares conserve the 300-point pool; ended lives leave the denominator. Tests prove four unequal contributors receive 80/110/140/170 (500 total), a solo receives 350, and a tiny contributor can receive the 50-point minimum. Downed credit survives; life termination, departure and replacement cannot inherit old credit. The existing authoritative life writer persists the awards and team attribution without a migration.

JSON combat events now use documented positional rows, expanded in shared validation used by both JSON entry paths. Canonical objects remain accepted. Binary transport uses existing extension cells for max HP, glob source and rewards. Maximum fixtures cover twenty long identities/names, 150 bugs including a maximum-HP hive and twelve spitters, 140 shots/events, 24 globs, twenty rewards, and every downed/out population split. JSON, binary keyframes and deltas fit the unchanged 65,536-byte cap. The active-population fixture measured 62,119 bytes as JSON and 17,555 bytes as a binary keyframe (`.evidence/84/payload.json`).

The initial 50-unit/s speed failed the full newcomer comparison: fresh aimer median 163.325 seconds versus late median 27.8 seconds (17.02%). All idle cohorts and the score gate passed. Traces showed long-lived hives changing incumbent clustering and the pressure encountered by isolated arrivals. Tuning speed to 80 (still below crawler speed 140 and player speed 180) restored the focused twenty-seed comparison: fresh median 159.7 seconds, late median at least 600 seconds (nine deaths / eleven cutoffs). HP, attacks, personal pressure, bot policies and all gates remain unchanged. Initial raw observations are retained in `.evidence/84/skill-50.json`; focused tuned observations are in `newcomers-80.json`.

## Production encounter and Chrome

Run `bun run build`, then `bun scripts/validate-hive.ts`. The harness starts an ephemeral loopback production server, two independent Chrome storage contexts and fifteen real aimer bots. The natural run never advances the wave clock artificially. `--scenes-only` repeats controlled presentation/touch fixtures without repeating the natural encounter and load measurement.

Primary run: `.evidence/84/chrome-AxvqPR/` (`report.json`, `natural-spawn.json`, `scenes.json`, `load.json`). Wave five appeared at snapshot tick 2401, after the scheduled 120,000 ms boundary. All seventeen players were connected; fifteen had active/downed lives, so the hive spawned with 1,020 HP. Its natural ring attacks were observed. The complete measured 17.95-second boss-active window contained 353 ticks: tick p50 **1.60 ms**, p95 **2.90 ms**, maximum **4.59 ms**. These include simulation, encoding and socket enqueueing. Scheduler lateness was measured separately: p95 **1.88 ms**, maximum **5.87 ms**.

Screenshots:

- `natural-wave-five.png`: natural encounter and global health bar.
- `controlled-boss-health-minimap.png`: procedural shell, pulse, top bar and minimap diamond.
- `controlled-ring.png`: twelve outward globs with visible gaps.
- `controlled-edge-arrow.png`, `390x844-boss-touch.png`, `844x390-boss-touch.png`: direction marker, boss HUD and simultaneous touch controls.
- `controlled-kill-banner.png`, `controlled-kill-banner-phone.png`: arena banner and large +200 award for each of two contributors.

Readable body/ring/kill captures deliberately use **controlled in-process fixtures** after the natural encounter: positions, attack deadline, HP and contribution setup are recorded in `scenes.json`. They exercise the production simulation, transport and renderer and introduce no debug route. They do not claim a natural bot kill. The same tuned run captures `390x844-downed-arrival.png` and `844x390-downed-arrival.png`, showing the warning marker, boss bar, minimap and downed countdown/name/rings without overlap.

## Frame and load measurements

The developer fixture `scripts/arena-benchmark.html?hive` draws twenty players, 150 bugs, 140 shots, 24 globs, combat effects and twenty reward effects. Seven one-second samples per layout measured:

| Chrome viewport | FPS in every sample | Average update/draw ms per sample |
| --- | --- | --- |
| 1280 x 720 | 60.0 | 1.062 to 1.325 |
| 390 x 844 | 60.0 | 0.958 to 1.263 |
| 844 x 390 | 60.0 | 1.023 to 1.208 |

These are factory desktop Chrome measurements with mobile emulation, not measurements on a physical phone. Production F-readout captures and two-point move/fire assertions accompany the fixture measurements. No browser console errors were recorded.

The owned production server then ran **200 aimer bots for 145 seconds**, long enough for wave-five bosses across ten rooms. Population remained exactly 200; all 200 connections closed normally. There were zero errors, premature disconnections, malformed/oversized/rate-limited messages, skipped snapshots or save errors. Tick p50 **1.48 ms**, p95 **2.66 ms**, maximum **14.49 ms**; scheduler lateness p95 **2.68 ms**, maximum **78.18 ms**. Maximum individual mean output was **35.91 KB/s**, below the existing 40 KB/s/player gate. The observer recorded one hive per room and hive globs; combined live globs reached 23. All existing tick/bandwidth gates passed.

## Automated checks

`bun install --frozen-lockfile`, `bun run check` and `bun run build` passed. The check runs strict TypeScript and 463 tests, including the real-server JSON/binary hive encounter and idempotent persistence/team totals. Focused simulation, protocol, codec and renderer checks also passed. The tuned twenty-seed newcomer comparison passes; the complete tuned skill/fairness command is running and its result will be appended before delivery.
