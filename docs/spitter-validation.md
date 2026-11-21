# Spitter validation (issue 78)

The original delivery measurements below are from `ad6bb3b`. The returned-check section records the collision fix and current measurements; the original full age sweep and Chrome captures remain historical evidence.

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

## Returned checks: contact ordering and acceptance fixtures

The review reproduced stale contact eligibility: an early glob downs a player, but that player's cached contact still prevents a later interception. Contacts now supply geometry and time only. Combat advances shots to each still-eligible contact boundary, resolves interception first on a tie, then consumes the glob and applies damage. Downing cancels pending shots and invalidates later contacts immediately. Bug/shot motion, expiry/world clipping, fixed +5 rewards and life ownership checks remain shared with the existing shot loop. Shot order remains stable within each interval; ticks without glob contacts keep the single original interval. Downing deadlines still use the completed tick, preserving the full revive window.

The original two-glob probe fails on the delivery code and passes with this fix. Its adjacent cases reverse glob array order, put another active teammate later on the same path within the tick, and queue a shot whose owner is downed before its birth. Existing early/late/tied interception, nearer-bug blocking, competing shots, protection/immunity, inactive owners, source death and revive tests remain green. Inspection found no other cached eligibility cutoff: remaining motion caches contain geometry, while owner status/life checks run for every shot interval.

The existing spitter timing fixture now moves the target through real input during emission. The engine fixture checks that received globs reach the renderer on the delayed clock. The draw fixture checks an actual cached gradient paint around the glob and distinct trail endpoints; it accepts a harmless width change. The world-exit fixture uses an unexpired glob, and the room fixture asserts snapshot glob membership.

Mutation probes reject 0.5 s velocity lead, empty renderer globs, removed glow, zero-length trail, omitted world-exit rejection and empty room globs. Changing trail width from 12 to 11 passes. Sources are restored in `finally`. Probe logs and restoration driver are under `.evidence/78/returned/`.

Current validation:

- `bun run check`: **433 tests, zero failures, 25,454 assertions**; `bun run build` passes. The focused eight-file group passed 84 tests.
- Current 20-seed/eight-bot/180-second score matrix: mover **214 points / 64.85 s**, aimer **3,908 points / 100.85 s**, ratio **18.26x**. Mover has 201 deaths / 160 cutoffs; aimer 104 deaths / 160 cutoffs.
- Fresh and eight-minute newcomer cohorts, twenty seeds each at a 600 s horizon, pass the unchanged comparison: fresh **149.125 s** (12 deaths / 8 cutoffs, exact median), late **519.750 s** (10 deaths / 10 cutoffs, a censored lower bound), ratio at least **348.53%**. Raw observations are in `returned/newcomers.json`.
- Fresh production CLI load: all **200 bots** joined ten arenas for 120 seconds with **zero errors**; tick p50 **1.158 ms**, p95 **2.516 ms**, over 11,767 room ticks in the rolling minute. Activity reached twelve spitters and twelve globs. All owned sockets, processes and database handles closed afterward.

The contact list is built once per tick (at most 12 x 20 player checks). Each consumed glob adds at most one shot-advancement boundary, so there are at most thirteen shot intervals; interval scans reuse the existing bug motions and shot/glob clipping. The fresh load above measures the extra tick work. Rendering implementation is unchanged, so the original Chrome/F measurements remain the presentation evidence. The full 65-cohort age sweep and Chrome campaign were not repeated for this return; the current check, score matrix, forty newcomer observations, mutations and load measurements are separate artifacts in `.evidence/78/returned/`.

## Merge with compact snapshot transport

Merged main at `c5548a6` (PR #80) into the existing spitter branch, retaining `db14713`'s contact-order fix. The arena simulation, damage, revive, targeting, scoring and policy code are unchanged by this merge. The text conflicts in architecture and room-test imports are resolved with both features preserved.

The new compact codec includes a bounded fifth collection for globs, using the same motion/birth precision and identity-based delta machinery as other entities. Kind-free glob-pop events remain independent of bug events. Legacy JSON retains its shot-owner index expansion. Codec fixtures now carry globs, and maximum-collection coverage includes twelve swelling spitters, twelve globs and mixed/all-pop events within the 64 KiB cap. A fixed-step round trip covers swell, birth, travel, interception, removal and +5; the real-server spitter test runs both JSON and compact clients.

`bun run check` passes **451 tests / 29,025 assertions**; `bun run build` and final TypeScript checking pass. These include all fourteen glob tests and the four same-tick downing variants from the previous fix. Pure-simulation skill/fairness observations above remain applicable; no gameplay or policy tuning changed.

The production evidence observer now decodes negotiated snapshots with the same decoder as the client. On the merged build, two isolated Chrome identities and eighteen bots observed natural wave four at tick 1847, reaching twelve spitters and two globs. Controlled snapshots at ticks 1863/1870/1871 show swell, flight and an interception with score 0 -> 5. Portrait and landscape twin-touch checks pass. Evidence: `.evidence/78/chrome-HCg9ge/`.

The separate Vite fixture initially timed out during navigation. An explicit benchmark dependency entry and ignored evidence-directory watch avoid scanning/reloading validation artifacts; the isolated rerun passes seven windows per layout at 60 FPS. Update/draw means are 0.867-0.995 ms desktop, 1.069-1.310 ms portrait and 0.747-1.217 ms landscape. Frame evidence: `.evidence/78/chrome-AOyJng/`. Both drivers closed their owned Chrome, Vite/production servers and database handles.

A fresh merged-build CLI run joined all 200 aimers across ten arenas for a complete 120-second window. Population stayed exactly 200; errors, drops, queueing, rejected/skipped sends and transport errors were all zero. Tick p50/p95/max were **1.293 / 2.507 / 7.489 ms**, from 23,529 room ticks. Accepted snapshot sizes p50/p95/max were **1,752 / 2,252 / 6,737 bytes** (447,180 deltas and 23,400 keyframe recipient observations); every connection passed main's 40,000 bytes/s mean bandwidth gate. Sampled activity reached twelve spitters, twelve globs, 11,754 swelling states and 648 pops. Data and driver: `.evidence/78/merged-load-uvAr3C/` and `.evidence/78/main-merge-load.ts`. All owned workers, sockets, production servers and database handles were closed.
