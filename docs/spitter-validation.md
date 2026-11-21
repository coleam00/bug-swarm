# Spitter validation (issue 78)

The spitter is a third registered bug kind: 2 HP, 30 base points, radius 18. Initial and final gameplay tuning match the plan: desired distance 400 (within 350-450), radial correction 1.4 capped at 140 units/s, tangent strafe 35 units/s, 1,700 ms movement followed by 500 ms swelling, and 2,200 ms between emissions. New sources receive the full first delay. Glob radius is 9, speed 320 units/s, lifetime 2,000 ms and muzzle offset 28. Pop reward is a fixed 5 points, one accuracy hit and no kill. Spitters unlock at wave four with a constant 1/8 share and a twelve-source live cap. Personal spawn volume is unchanged.

The server-only boundary attack hook is separate from movement/phase interpolation. Globs persist after source death. Swept shot/glob collisions cannot intercept after the glob's earliest player contact; an exact tie intercepts. Shared damage preserves spawn protection, immunity, downing and revival ordering. Expiry and world exit bound both simulation and delayed rendering. Tests cover the actual two-movement-calls-per-step path, current-position aim, interrupted/targetless tells, spacing, both damage phases, moving-player escape, grazing, competing shots, nearer bug blockers, stale owners, fixed scoring, cap replacement, malformed snapshots and two real clients receiving the same tell/glob/pop/score.

## Transport and checks

The original verbose ownership format exceeded the cap when the full fixture used long entity ids. Player shots now send an owner index into the full snapshot's player array; receipt expands this back to the player's UUID before validation and consumption. No authoritative entities are dropped. Client/server continue deploying together through the existing v1/build-id reload flow. The maximum fixture includes 20 players with long names/UUIDs, a 128-character arena id, 150 phased bugs including twelve spitters, 140 player shots, twelve globs, 140 events and entity ids near Number.MAX_SAFE_INTEGER. This fixture serializes to **64,856 bytes**, below 65,536. It also checks mixed/all-pop events and every downed/out population split.

`bun install --frozen-lockfile`, `bun run check` (429 tests, 25,405 assertions) and `bun run build` pass. The check includes every existing combat, dasher, revival, reconnect and real-server test. Focused final transport/interpolation/engine checks passed 48 tests. No dependency or database migration was added.

## Production Chrome and load

`bun scripts/validate-spitter.ts` owns a built production server on an ephemeral loopback port, SQLite, Chrome, browser profiles and a developer-only Vite fixture. All scratch data is under `.evidence/78/`. Two isolated Chrome identities plus eighteen aimer bots share an arena; the script waits for natural wave-four spitter/glob activity. Portrait 390 x 844 and landscape 844 x 390 exercise simultaneous two-pointer movement/aim/fire and assert movement, firing and no overflow.

Readable swell, flight and +5 screenshots use explicitly controlled positions on that production server. The interception injects one authoritative player projectile at a deterministic intercept; no debug endpoint ships. Matching authoritative snapshots and a 0-to-5 score change are saved in scenes.json. The screenshots were inspected for the expanded rounded abdomen, green glow/core/trail and distinct green pop/+5.

The full rendering fixture contains twenty players, 150 bugs (including twelve swelling spitters), 140 shots, twelve globs and the bounded 140-effect pool with interceptions. Seven one-second windows per layout measure update/draw work; these are desktop Chrome device/touch emulation measurements, not physical-device or GPU timings. The production F readout is captured with the controlled scene.

Chrome 157.0.8103.51 observed natural activity at tick 1847 / wave 4, with twenty connected players, six spitters and a glob. Controlled captures are at ticks 1865 (swell), 1873 (flight) and 1874 (pop, score 0 -> 5).

The final 120-second aimer CLI workload joined all 200 bots across ten arenas with zero errors. Tick p50 was **1.169 ms**, p95 **2.116 ms**, over 11,757 room ticks in the rolling minute; scheduler lateness p50/p95 was 0.953/2.147 ms. Rates were 2,546.8 sent and 3,866.0 received messages/s. The load observed twelve live spitters, twelve globs, 11,552 sampled swelling states and 586 sampled pop events. The extra collision work is bounded by 140 x 12 shot/glob checks and 12 x 20 glob/player checks per room step. Cached drawing adds at most twelve glob draws and twelve spitter glows; the effect pool keeps its existing bound.

Production screenshots, matching snapshots and load data: `.evidence/78/chrome-VdYHgo/` (`controlled-swell.png`, `controlled-flight.png`, `controlled-intercept.png`, both `*-twin-touch.png`, `natural-snapshot.json`, `scenes.json`, `load.json`, `report.json`). Final complete frame windows: `.evidence/78/chrome-QXzmRE/report.json` and `*-full-arena.png`. The frame-only rerun waited for the first measurement before collecting seven windows; the earlier desktop capture began before its dataset initialized. Owned browsers, sockets, Vite/production servers and database handles were closed after each driver.

| Layout | Update/draw ms per window | FPS |
| --- | ---: | ---: |
| 1280 x 720 | 0.788-0.962 | 60.0-60.0 |
| 390 x 844 | 0.715-0.833 | 60.0-60.0 |
| 844 x 390 | 0.747-0.862 | 60.0-60.0 |

## Skill and independent newcomers

`bun run skill` completed the full 20-seed, eight-bot, 180-second policy matrix and all 65 independent newcomer cohorts (1,300 observations). Gameplay tuning stayed at the initial values above. Glob dodging uses a one-second horizon, twelve units of extra clearance and a 2.5 perpendicular escape force, blended with existing avoidance.

| Policy | Median score | Median life seconds | Deaths | Horizon cutoffs |
| --- | ---: | ---: | ---: | ---: |
| mover | 214 | 65.75 | 199 | 160 |
| aimer | 3,679 | 100.85 | 106 | 160 |

The aimer/mover score ratio is **17.19x** (required >=2x). Policy medians include the existing 180-second horizon cutoffs. Newcomer survival medians are **149.200 seconds fresh** and **490.425 seconds at an eight-minute join**, or **328.70%** (required >=80%). Both newcomer medians are exact, with twelve deaths and eight 600-second horizon cutoffs each. All idle medians at 15-second arena ages from 0 through 900, plus solo controls, pass; the minimum is **21.075 seconds** (required >=10). No gate was changed.

Full per-seed newcomer observations, score/seconds/censor flags, cohort summaries and constants are retained in `.evidence/78/skill.json`. The original PowerShell capture is `skill.raw.log`: that shell returned 1 after treating Bun's stderr command banner as an error, despite the completed report passing every threshold. `verify-skill.ts` independently recomputes cohort summaries and the current score/fairness gates from the captured observations and exits 0. The final check/build use a direct Bun child runner that records actual child exit codes (both 0).

| Policy | Arena join age (s) | Incumbents | Median life (s) | Deaths / cutoffs | Exact median |
| --- | ---: | ---: | ---: | ---: | --- |
| aimer | 0 | 8 | 149.200 | 12 / 8 | yes |
| aimer | 480 | 8 | 490.425 | 12 / 8 | yes |
| idle | 0 | 8 | 32.450 | 20 / 0 | yes |
| idle | 15 | 8 | 21.750 | 20 / 0 | yes |
| idle | 30 | 8 | 22.400 | 20 / 0 | yes |
| idle | 45 | 8 | 22.075 | 20 / 0 | yes |
| idle | 60 | 8 | 21.075 | 20 / 0 | yes |
| idle | 75 | 8 | 21.750 | 20 / 0 | yes |
| idle | 90 | 8 | 21.575 | 20 / 0 | yes |
| idle | 105 | 8 | 21.675 | 20 / 0 | yes |
| idle | 120 | 8 | 21.325 | 20 / 0 | yes |
| idle | 135 | 8 | 21.800 | 20 / 0 | yes |
| idle | 150 | 8 | 21.325 | 20 / 0 | yes |
| idle | 165 | 8 | 22.175 | 20 / 0 | yes |
| idle | 180 | 8 | 21.675 | 20 / 0 | yes |
| idle | 195 | 8 | 21.775 | 20 / 0 | yes |
| idle | 210 | 8 | 21.300 | 20 / 0 | yes |
| idle | 225 | 8 | 24.275 | 20 / 0 | yes |
| idle | 240 | 8 | 23.425 | 20 / 0 | yes |
| idle | 255 | 8 | 22.725 | 20 / 0 | yes |
| idle | 270 | 8 | 22.275 | 20 / 0 | yes |
| idle | 285 | 8 | 21.950 | 20 / 0 | yes |
| idle | 300 | 8 | 23.150 | 20 / 0 | yes |
| idle | 315 | 8 | 21.750 | 20 / 0 | yes |
| idle | 330 | 8 | 22.250 | 20 / 0 | yes |
| idle | 345 | 8 | 22.625 | 20 / 0 | yes |
| idle | 360 | 8 | 22.350 | 20 / 0 | yes |
| idle | 375 | 8 | 21.700 | 20 / 0 | yes |
| idle | 390 | 8 | 22.275 | 20 / 0 | yes |
| idle | 405 | 8 | 22.100 | 20 / 0 | yes |
| idle | 420 | 8 | 23.150 | 20 / 0 | yes |
| idle | 435 | 8 | 23.425 | 20 / 0 | yes |
| idle | 450 | 8 | 22.400 | 20 / 0 | yes |
| idle | 465 | 8 | 23.650 | 20 / 0 | yes |
| idle | 480 | 8 | 23.425 | 20 / 0 | yes |
| idle | 495 | 8 | 21.500 | 20 / 0 | yes |
| idle | 510 | 8 | 22.150 | 20 / 0 | yes |
| idle | 525 | 8 | 22.075 | 20 / 0 | yes |
| idle | 540 | 8 | 21.900 | 20 / 0 | yes |
| idle | 555 | 8 | 23.875 | 20 / 0 | yes |
| idle | 570 | 8 | 23.575 | 20 / 0 | yes |
| idle | 585 | 8 | 23.225 | 20 / 0 | yes |
| idle | 600 | 8 | 22.150 | 20 / 0 | yes |
| idle | 615 | 8 | 22.075 | 20 / 0 | yes |
| idle | 630 | 8 | 22.775 | 20 / 0 | yes |
| idle | 645 | 8 | 23.375 | 20 / 0 | yes |
| idle | 660 | 8 | 25.025 | 20 / 0 | yes |
| idle | 675 | 8 | 22.275 | 20 / 0 | yes |
| idle | 690 | 8 | 23.125 | 20 / 0 | yes |
| idle | 705 | 8 | 23.050 | 20 / 0 | yes |
| idle | 720 | 8 | 23.700 | 20 / 0 | yes |
| idle | 735 | 8 | 22.900 | 20 / 0 | yes |
| idle | 750 | 8 | 23.225 | 20 / 0 | yes |
| idle | 765 | 8 | 22.750 | 20 / 0 | yes |
| idle | 780 | 8 | 21.525 | 20 / 0 | yes |
| idle | 795 | 8 | 22.600 | 20 / 0 | yes |
| idle | 810 | 8 | 22.725 | 20 / 0 | yes |
| idle | 825 | 8 | 23.700 | 20 / 0 | yes |
| idle | 840 | 8 | 22.050 | 20 / 0 | yes |
| idle | 855 | 8 | 22.750 | 20 / 0 | yes |
| idle | 870 | 8 | 24.325 | 20 / 0 | yes |
| idle | 885 | 8 | 24.050 | 20 / 0 | yes |
| idle | 900 | 8 | 23.250 | 20 / 0 | yes |
| idle | 0 | 0 | 22.225 | 20 / 0 | yes |
| idle | 480 | 0 | 22.225 | 20 / 0 | yes |
