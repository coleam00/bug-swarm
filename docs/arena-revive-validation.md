# Arena revive validation - issue 72

The requested revive behavior is implemented and the automated checks and production Chrome scenarios pass. **Delivery is blocked on the existing late-join survival gate:** `bun run skill` exits 1 because eight-minute joins reach 61.18% of fresh aimer survival, below the required 80%. No threshold, seed, cohort, censoring rule or pacing constant was changed.

## Reproduction and isolation

Run `bun install`, `bun run build`, then `bun scripts/validate-revive.ts` from the checkout. Set `CHROME_PATH` if Chrome is not installed at a conventional path. The probe starts its own production HTTP/WebSocket server on an ephemeral loopback port and uses built assets. A separate owned Vite server exposes only the renderer fixture. It creates its database, Chrome profile, home, temporary directory, screenshots and JSON report under `.evidence/72/production-<suffix>/`, and closes its servers, bots, Chrome process and database in `finally`. No existing server or browser profile is used. No tooling dependency was added.

For checks and skill measurements, first redirect HOME, USERPROFILE, APPDATA, LOCALAPPDATA, XDG_CONFIG_HOME, XDG_CACHE_HOME, TEMP, TMP and DATA_DIR to directories inside `.evidence/72/`, then run `bun run check` and `bun run skill`. This also keeps the existing tests' operating-system temporary directories inside the checkout.

Measurements below were captured on 2026-11-21 in Chrome 157.0.8103.51 on the factory's Windows machine, headless, device scale 1, without CPU throttling. Chrome uses an isolated profile and `--disable-gpu`; frame readings measure update/draw CPU cost, excluding later compositing. Device emulation is evidence for this machine, not a physical-phone hardware claim.

## Behavior evidence

Final production artifacts are in `.evidence/72/production-cPCKgf/`; raw assertions and authoritative player state are in `report.json`. The two independent storage contexts joined opposite teams before 18 aimer bots filled their room. The probe then positioned players and one crawler on the owned server to make the scenarios repeatable. Inputs, three-hit downing, countdown, contact accumulation, immunity, rewards, timeout and saves followed the ordinary production paths and real elapsed time.

| Screenshot | Observation |
| --- | --- |
| `portrait-local-downed.png` | 390 x 844, dim flattened robot, readable name, countdown ring, exact short local message |
| `desktop-edge-arrow.png` | Other browser sees off-screen Help arrow |
| `other-browser-downed.png` | Other browser sees downed robot after approaching |
| `revive-in-progress.png`, `portrait-revive-in-progress.png` | Separate countdown and partial revive rings in both browsers |
| `revive-completed.png`, `portrait-revived.png` | Same life/run, 11 points and -1.1 preserved; one hit; rescuer gains exactly 50 |
| `landscape-local-downed.png` | 844 x 390, readable countdown/message and robot name |
| `landscape-timeout.png`, `landscape-respawn.png` | Unrescued timeout saves one terminal result; fresh input starts next life |
| `full-room-f-timings.png` | Full room with F readout |

Two-point Chrome touch input exercises the right firing stick and left movement stick. Downing releases controls; gameplay presses while downed cannot request respawn; revival requires fresh input. The probe checks neutral movement/fire after revival despite attempted held input. Landscape twin-stick input is recorded separately. Both layouts have no horizontal overflow or browser errors.

Deterministic simulation tests cover the 90-unit boundary, cumulative/interrupted/transferred contact, no stacking or self/downed rescue, cross-team eligibility, simultaneous deterministic rewards, no same-step rescue chains, exact-deadline completion, repeated downing, retained score/streak/life, immunity expiry with firing, cancelled shots, ignored targeting, gun cooling and personal spawn debt. Room/writer tests cover no down/revive finish, denied downed respawn, reward/team persistence and exactly-once timeout/departure/moderation/stall/shutdown saves. Real WebSocket coverage exercises revive, timeout and a single subsequent respawn using controlled steps, without a ten-second sleep. Client and recording-canvas tests cover transition resets, held-input suppression, immediate status/progress and edge geometry. The bot transport and shared policy have both pure-simulation and real-socket coverage.

## Frame and tick cost

Full-room F samples: desktop 60.0-61.5 FPS at 0.398-0.816 ms/frame; portrait 60.0-61.1 FPS at 0.257-0.848 ms/frame. All eight observations from each context contained 20 players.

The bounded renderer fixture keeps 20 players, 150 bugs, 140 shots and 140 effects. `?revive` adds 19 downed robots split between on-screen rings and off-screen arrows, with retained progress and active contact. Four samples per view:

| Scene | CSS viewport | FPS | Update/draw ms/frame |
| --- | --- | ---: | ---: |
| Combat | 1280 x 800 | 60.0-60.0 | 0.810-0.990 |
| Combat | 390 x 844 | 60.0-60.0 | 0.725-0.842 |
| Combat | 844 x 390 | 60.0-60.0 | 1.116-1.393 |
| Combat + rescue | 1280 x 800 | 60.0-60.0 | 0.940-1.451 |
| Combat + rescue | 390 x 844 | 60.0-60.0 | 0.827-1.238 |
| Combat + rescue | 844 x 390 | 60.0-60.0 | 0.782-1.373 |

The final real WebSocket run used the same `runBots` implementation as `bun run bots -- --url <owned-origin> --count 200 --seconds 120 --policy aimer`: 200 joins in ten arenas, zero errors, 360,197 messages sent and 362,928 received. Rolling final-minute tick p50/p95: **0.756 / 1.363 ms** (9,005 samples); scheduler lateness p50/p95: **11.272 / 50.403 ms**, reported separately. Skill/check processes were also running on this machine, so the lateness figures include CPU contention. The earlier successful run measured tick p50/p95 0.769 / 1.415 ms.

Revival adds at most 20 x 19 squared-distance comparisons per tick and 19 edge projections per frame. Snapshot size tests cover every active/downed/out population split, including terminal results and remaining owners' maximum shot counts, within the existing 64 KiB cap.

## Checks and blocking skill result

- `bun run check`: 611 tests passed, zero failures, including TypeScript checks; raw output `.evidence/72/check-final.log`.
- `bun run build`: passed; `.evidence/72/build-final.log`.
- Focused simulation, transport, persistence, policy and canvas checks passed; logs under `.evidence/72/`.
- Production Chrome/touch/browser/load assertions passed twice; an initial Chrome attach timed out, and subsequent launches with explicit profile-path handling, a longer CDP timeout and GPU disabled passed; `.evidence/72/production-final.log` and the report above.
- `bun run skill`: **failed the late-join gate**; raw output `.evidence/72/skill.log`, extracted complete report `.evidence/72/skill.json`.

| Shared policy | Median score | Median life seconds | Terminal observations | Horizon cutoffs |
| --- | ---: | ---: | ---: | ---: |
| mover | 216 | 90.65 | 141 | 160 |
| aimer | 2,210.5 | 82.05 | 174 | 160 |

Aimer/mover score ratio is 10.234, above the unchanged 2x gate. All 63 idle cohorts pass the unchanged ten-second threshold; the minimum median is 21.075 seconds. Complete raw seed/cohort observations and censoring remain in `skill.json`.

Fresh aimer newcomers: median **133.625 s**, 18 terminal observations and two 600-second cutoffs. Eight-minute newcomers: median **81.75 s**, 20 terminal observations and no cutoffs. Both medians are exact under the existing censoring rules; the ratio is **0.6118**, and the required median is at least **106.9 s**. Extending the horizon cannot change this failed comparison.

Scratch policy experiments limited rescue search to 200 and 300 units while keeping simulation rules and cohorts fixed. Both also failed (late medians 82.425 and 74.075 seconds respectively; fresh median unchanged). These experiments remain only under `.evidence/72/`; the implementation retains the planned 450-unit search range. The regression therefore needs an explicit decision about expanding scope to personal pacing/safe-spawn balance, or deferring this change behind a separate pacing correction. The draft must remain blocked until the gate passes or a maintainer explicitly changes the requirement.
