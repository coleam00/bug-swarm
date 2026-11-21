# Arena revive validation - issue 72

The completed revive flow passes simulation, lifecycle, production Chrome, touch, load and full skill validation. One owner-approved constant change restores late-join survival from 61.18% to 88.35% of fresh survival. Thresholds, seeds, populations, horizon extensions and censoring rules are unchanged.

## Reproduction and isolation

Run `bun install`, `bun run build`, then `bun scripts/validate-revive.ts` from the checkout. Set `CHROME_PATH` if Chrome is not installed at a conventional path. The probe starts its own production HTTP/WebSocket server on an ephemeral loopback port and uses built assets. A separate owned Vite server exposes only the renderer fixture. It creates its database, Chrome profile, home, temporary directory, screenshots and JSON report under `.evidence/72/production-<suffix>/`, and closes its servers, bots, Chrome process and database in `finally`. No existing server or browser profile is used. No tooling dependency was added.

For checks and skill measurements, first redirect HOME, USERPROFILE, APPDATA, LOCALAPPDATA, XDG_CONFIG_HOME, XDG_CACHE_HOME, TEMP, TMP and DATA_DIR to directories inside `.evidence/72/`, then run `bun run check` and `bun run skill`. This also keeps the existing tests' operating-system temporary directories inside the checkout. The additional CLI load command is `bun run bots -- --url <owned-origin> --count 200 --seconds 120 --policy aimer`, using a separately started owned production server.

Measurements below were captured on 2026-11-21 in Chrome 157.0.8103.51 on the factory's Windows machine, headless, device scale 1, without CPU throttling. Chrome uses an isolated profile and `--disable-gpu`; frame readings measure update/draw CPU cost, excluding later compositing. Device emulation is evidence for this machine, not a physical-phone hardware claim.

## Behavior evidence

Final production artifacts after tuning are in `.evidence/72/production-3M7NVG/`; raw assertions and authoritative player state are in `report.json`. The two independent storage contexts joined opposite teams before 18 aimer bots filled their room. The probe then positioned players and one crawler on the owned server to make the scenarios repeatable. Inputs, three-hit downing, countdown, contact accumulation, immunity, rewards, timeout and saves followed the ordinary production paths and real elapsed time.

| Screenshot | Observation |
| --- | --- |
| `portrait-local-downed.png` | 390 x 844, dim flattened robot, readable name, countdown ring, exact short local message |
| `desktop-edge-arrow.png` | Other browser sees off-screen Help arrow |
| `other-browser-downed.png` | Other browser sees downed robot after approaching |
| `revive-in-progress.png`, `portrait-revive-in-progress.png` | Separate countdown and partial revive rings in both browsers |
| `revive-completed.png`, `portrait-revived.png` | Same life/run, 11 points and x1.1 preserved; one hit; rescuer gains exactly 50 |
| `landscape-local-downed.png` | 844 x 390, readable countdown/message and robot name |
| `landscape-timeout.png`, `landscape-respawn.png` | Unrescued timeout saves one terminal result; fresh input starts next life |
| `full-room-f-timings.png` | Full room with F readout |

Two-point Chrome touch input exercises the right firing stick and left movement stick. Downing releases controls; gameplay presses while downed cannot request respawn; revival requires fresh input. The probe checks neutral movement/fire after revival despite attempted held input. Landscape twin-stick input is recorded separately. Both layouts have no horizontal overflow or browser errors. The screenshots above were visually inspected after tuning.

Deterministic simulation tests cover the 90-unit boundary, cumulative/interrupted/transferred contact, no stacking or self/downed rescue, cross-team eligibility, simultaneous deterministic rewards, no same-step rescue chains, exact-deadline completion, repeated downing, retained score/streak/life, immunity expiry with firing, cancelled shots, ignored targeting, gun cooling and personal spawn debt. Room/writer tests cover no down/revive finish, denied downed respawn, reward/team persistence and exactly-once timeout/departure/moderation/stall/shutdown saves. Real WebSocket coverage exercises revive, timeout and a single subsequent respawn using controlled steps, without a ten-second sleep. Client and recording-canvas tests cover transition resets, held-input suppression, immediate status/progress and edge geometry. The bot transport and shared policy have both pure-simulation and real-socket coverage.

## Frame and tick cost

Full-room F samples after tuning: desktop 60.0-61.3 FPS at 0.237-0.656 ms/frame; portrait 60.0-61.1 FPS at 0.256-0.729 ms/frame. All eight observations from each context contained 20 players.

The bounded renderer fixture keeps 20 players, 150 bugs, 140 shots and 140 effects. `?revive` adds 19 downed robots split between on-screen rings and off-screen arrows, with retained progress and active contact. Four samples per view:

| Scene | CSS viewport | FPS | Update/draw ms/frame |
| --- | --- | ---: | ---: |
| Combat | 1280 x 800 | 60.0-60.0 | 0.842-0.992 |
| Combat | 390 x 844 | 60.0-61.1 | 0.716-0.937 |
| Combat | 844 x 390 | 60.0-60.0 | 0.718-0.992 |
| Combat + rescue | 1280 x 800 | 60.0-60.0 | 0.873-0.925 |
| Combat + rescue | 390 x 844 | 60.0-60.0 | 0.779-0.838 |
| Combat + rescue | 844 x 390 | 60.0-60.0 | 0.861-0.941 |

The separate real CLI run after tuning used **200 aimers for 120 seconds** in ten arenas: 200 joins, zero errors, 172,462 messages sent and 430,136 received. Rolling final-minute tick p50/p95: **0.830 / 1.533 ms** (11,731 samples); scheduler lateness p50/p95: **0.965 / 2.211 ms**, reported separately. Its server and bot CLI were separate processes; raw CLI output, server/bot process identities, database and measurements are in `.evidence/72/cli-load-5JTSSm/`. Both owned processes and database handles closed. Skill and production validation jobs were running concurrently on this machine.

The browser probe additionally ran 200 in-process WebSocket bots for 120 seconds: 200 joins, zero errors, tick p50/p95 **0.866 / 1.574 ms** and scheduler lateness p95 **80.977 ms**. The CLI run separates the bot parsing/policy CPU work from the server event loop. Both measurements are retained in `.evidence/72/production-3M7NVG/report.json` and the CLI report above. Before tuning, the browser probe's in-process run measured **0.756 / 1.363 ms** tick p50/p95; these are measurements under different live populations, not a controlled CPU comparison of the constant change.

Revival adds at most 20 x 19 squared-distance comparisons per tick and 19 edge projections per frame. Snapshot size tests cover every active/downed/out population split, including terminal results and remaining owners' maximum shot counts, within the existing 64 KiB cap. Changing one spawn-rate knot adds no per-tick algorithm or data structure.

## Pacing correction and before/after

The owner approved the smallest constant adjustment needed to preserve all three existing skill gates with revival. Only the 60-second personal spawn-rate knot changes, **4 -> 4.25 bugs/s**; the curve remains **0.1 at spawn, 5 at 120 seconds and 6 at 240 seconds**, interpolated and then clamped. Spawn clearance, protection, bot policies, revive timing and rewards remain as implemented before the correction. Potential spawn requests increase from 123 to 130.5 in the first minute and from 393 to 408 by two minutes; blocked requests still discard whole credit and downed lives still generate no credits.

Initial revive validation failed the unchanged late-join gate: fresh aimer newcomers had median **133.625 s**, eight-minute newcomers **81.75 s**, or **61.18%**. Fresh observations had 18 deaths / 2 cutoffs at the common 600-second horizon; late observations had 20 deaths / 0 cutoffs. Both medians were exact. Raw before results remain in `.evidence/72/skill.log` and `.evidence/72/skill.json`.

The same paired cohorts with the selected constant reach fresh **132 s** and late **116.625 s**, or **88.35%**, above 80%. Fresh survival stays close while the late median improves; the gate was not restored by substantially shortening fresh lives. The final full matrix below verifies these observations without mock tuning.

Exploration stayed in `.evidence/72/`: minimum drop-in clearances 350/400/450 produced identical paired results, while a larger birth clearance and reduced later rate caps also failed. Of the tested quarter-step increases in the one-minute knot, 4.25 restored the gate; 4.5 and 4.75 did not. The selected correction changes one value and introduces no new mechanic. `tune-pacing.ts` and the raw candidate reports are scratch tools; they are not used by the final skill command.

## Checks and full skill matrix

- `bun run check`: 612 tests passed, zero failures, including TypeScript checks after the returned visual repair; `.evidence/72/boundary-check.log`. The earlier 611-test run remains in `.evidence/72/check-after.log`.
- `bun run build`: passed; `.evidence/72/build-after.log`.
- Focused spawn-credit/curve, combat and revive tests: 26 passed; `.evidence/72/pacing-focused.log`. Literal expected rates, integrated requests and fractional credit were updated for the selected knot.
- Production Chrome/touch/browser/load assertions passed after tuning; `.evidence/72/production-after.log`, `.evidence/72/cli-load-after.log` and the reports above.
- `bun run skill`: passed all gates with exit 0; complete raw observations, censoring and constants are in `.evidence/72/skill-after.log` and `.evidence/72/skill-after.json`.

The complete score benchmark uses 20 seeds, eight bots and 180 seconds per policy:

| Shared policy | Median score before -> after | Median life seconds before -> after | Terminal observations after | Horizon cutoffs after |
| --- | ---: | ---: | ---: | ---: |
| mover | 216 -> 202.5 | 90.65 -> 90 | 134 | 160 |
| aimer | 2210.5 -> 1730.5 | 82.05 -> 68.725 | 210 | 160 |

Aimer/mover median score ratio is **8.546x**, above the unchanged 2x requirement (before: 10.234x). All **65 cohorts / 1,300 first-life observations** are present. All 63 idle cohorts pass the unchanged ten-second threshold; the minimum median is **20.775 s at arena age 60 s**, versus **21.075 s** before tuning. Their complete observations and censoring remain in the raw JSON.

| Newcomer cohort | Median before -> after, seconds | Deaths / cutoffs after | Median exact |
| --- | ---: | ---: | --- |
| fresh aimer, eight incumbents | 133.625 -> 132 | 20 / 0 | yes |
| eight-minute aimer, eight incumbents | 81.75 -> 116.625 | 17 / 3 | yes |

Both final aimer medians are exact under the existing censoring rules, despite three late lives censored at the common 600-second horizon. Late survival reaches **88.352%**, above **80%**; no horizon extension was needed. Final observations match the exploratory pair exactly. The previously blocking gate is resolved.

## Returned visual repairs

The short downed message now stays above the local robot only when that slot clears the complete name and rescue feedback; otherwise it moves below the Help marker. Positions are calculated in CSS pixels from the existing camera and world scale. Copy, camera behavior, simulation, pacing and controls are unchanged. This adds constant-time arithmetic to the existing downed banner draw, with no extra canvas operations or frame allocations.

The existing renderer test now also uses an active local player and an on-screen downed player from the opposite team. It checks that teammate's flattened pose, dimming, countdown/progress rings and pulsing Help, then checks removal on revival. The prior local-overlay and off-screen arrow cases remain. A separate geometry regression covers all four walls, four corners and the center in portrait, landscape and scaled desktop views, with 50/1,000/1,950 ms revive progress. It reserves each complete ring, including stroke width, rather than only the currently filled arc.

The new layout regression fails against the previous fixed banner position. In isolated source copies, both newly returned mutations (local-only downed rendering and restoring the fixed banner position) fail their intended tests. All eight previous regression mutations still fail, and the wording-only variant passes. Raw mutation output is in `.evidence/72/returned-mutations-pdlGlS/` and `.evidence/72/boundary-mutations.log`. Focused visual checks passed all eight tests; `bun run check` passed 612 tests, and `bun run build` passed (`boundary-focused.log`, `boundary-check.log`, `boundary-build.log`).

Owned local-file Chrome fixtures bundled the production renderer, using `cameraFor`/`worldView` and actual canvas glyph/paint bounds. The preserved pre-fix bundle reproduces the overlap at (1200, 14), 390 x 844, with 50 ms progress: `.evidence/72/boundary-browser-9Xy9eI/before-390x844-north-50.png`. Final Chrome 157.0.8103.51 screenshots and all 84 successful geometry observations are in `.evidence/72/boundary-browser-iL0Nik/`: `after-<width>x<height>-north-<progress>.png`, `<width>x<height>-teammate.png` and `report.json`. The final portrait/landscape captures, including the first progress segment and on-screen teammate, were visually inspected. Every recorded name, complete ring and Help bound stays inside the viewport and clear of the HUD/message. All Chrome processes exited; profiles and scratch files remain inside this checkout.

A bounded renderer fixture additionally includes a downed local robot at the center, 19 downed teammates, 150 bugs, 140 shots and 140 effects. With explicit foreground/background-timer controls, two warm-up seconds and four one-second samples per view:

| View | FPS | Update/draw ms/frame |
| --- | ---: | ---: |
| 390 x 844 | 59.0-60.0 | 0.732-0.865 |
| 844 x 390 | 60.0-60.0 | 0.768-0.782 |
| 1280 x 800 | 60.0-60.0 | 0.803-0.892 |

Initial local-file fixture runs without those foreground controls varied from 52.1 to 60 FPS, with CPU draw cost at most 1.564 ms; their reports remain under `boundary-browser-TkB8B7/` and `boundary-browser-NrG32n/`. The final controlled report above retains all samples. The earlier live two-browser/touch, server-load and full skill evidence remains applicable to the unchanged gameplay/server code; those long-running scenarios were not repeated for this renderer-only repair.
