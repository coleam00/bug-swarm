# Procedural look validation

The subsequent balance change's current pacing tests, updated shield/bomb rules and fresh normal/double/stress-burst/late-speed Chrome measurements are in [pacing-validation.md](pacing-validation.md). That change replaces the historical no-upgrade duration fixtures described below with an upgrade-enabled regression harness. The measurements below remain the evidence recorded for their respective earlier changes.

The renderer uses Canvas 2D commands only. The full rectangular world's grid and vignette, glows and score glyph are cached on detached canvases; actors and legs are drawn procedurally. Base beetles are coral; fast beetles are smaller, bright gold and have a quicker gait, selected through `BUG_STYLES[bug.kind]`. Collision dimensions and all simulation rules remain those merged from main in #10. The original look change added no image assets, rendering dependencies or upgrade visuals. The later upgrade integration and its fresh evidence are recorded separately below.

## Evidence required by the owner

The [issue #7 owner ruling](https://github.com/coleam00/bug-swarm/issues/7) accepts this PR's benchmark on the factory desktop in Chrome, including headless Chrome, plus the operator's browser check before merge. No laptop or phone measurement is required for this item. The owner plays on real devices after deploy.

## Repeat the measurement

Install with `bun install --frozen-lockfile`, then start Vite alone:

```sh
bunx vite --host 127.0.0.1 --port 5191 --strictPort
```

Open `http://127.0.0.1:5191/scripts/look-benchmark.html`. No API or database is needed; the page does not create runs or submit scores. Keep the viewport and DPR fixed during measurement. Reload to repeat. Use `?burst` for saturation. The page warms for 10 seconds, then records 60 seconds and displays its JSON report; `window.lookBenchmark.result` exposes the same report. `window.lookBenchmark.dispose()` stops it and releases its backing stores.

The fixture samples the screen-shaped world once at start and replenishes to 150 bugs before every draw, mixing one fast bug per four fixture spawns. It records minimum/maximum total and fast-bug counts and the world dimensions. It moves the robot continuously, maintains normal auto-fire plus one fixture shot every 200 ms, and forces a contact every two seconds. Burst mode adds 300 squash effects every second, exceeding both particle and label capacity. Fixture work is timed separately from production fixed-step/feedback/FX update and rendering. The initial RAF timestamp is excluded from the interval count. Lowest rolling FPS uses consecutive windows of at least one second. Timing resolution can round short fixture work to zero.

## Recorded environment and results

2026-11-19: Windows 11 Home 10.0.26200, ASUS desktop, AMD Ryzen 9 7950X3D, RTX 3090 host; automated headless Chrome for Testing 159.0.8154.6. Viewport 1280 x 720 CSS pixels, device/render DPR 1, 800 x 450 logical world, RAF scheduling approximately 60 Hz. Each case used 10 seconds of warmup and a separate 60-second sample. Browser profiles, home and application data were scratch directories. The project checks finished before measurement; no parallel benchmark or project-check workload ran during these samples.

| Case | Mean FPS | Lowest rolling FPS | Completed frame intervals | Bugs at every draw | Fast bugs (min-max) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 59.999 | 59.994 | 3600 | 150 | 24-46 |
| Burst | 59.999 | 59.988 | 3600 | 150 | 22-39 |

| Case | Update mean / p95 (ms) | Draw mean / p95 (ms) | Fixture mean / p95 (ms) | Peak particles / trails / labels |
| --- | ---: | ---: | ---: | ---: |
| Normal | 0.055 / 0.200 | 0.632 / 1.000 | 0.002 / 0.000 | 29 / 6 / 6 |
| Burst | 0.061 / 0.200 | 0.968 / 1.700 | 0.004 / 0.000 | 1024 / 6 / 256 |

Both samples cover 60.001 seconds. Burst mode reaches the fixed particle/label caps without growing storage. No page errors occurred.

These are measured browser timings from real RAF intervals, not synthetic timestamps. They are the desktop evidence specified by the owner; they do not predict device throughput on other hardware.

## Correctness and visual review

- `bun run check`: TypeScript and all 104 tests pass (12,191 assertions). `bun run build` passes; the benchmark is not a production entry point.
- Pool tests cover fixed storage identity, caps/drop-on-full, expiry, reuse, reset, displaced particles, rising text and bounded nonzero shake. Feedback tests distinguish both kinds' shot squashes from contacts, invulnerable contacts, simultaneous kills/hits, shot-before-contact, same-step spawn kills, kills on different catch-up steps, overflow and terminal-hit decay. Three seeded 3,600-step sequences in portrait, landscape and square worlds compare the complete observed and unobserved simulation after every step.
- Renderer tests retain the prior feature and cache coverage and verify rectangular grid/vignette backing paints, world clipping, independent expected pixel bounds, edge labels, rotation, same-canvas world replacement on restart, and the fast kind's smaller bright shell and quicker gait. Engine coverage retains actual feedback wiring, expiry after death, steering, focus resets and screen-shaped restarts.
- The previous test repair exercised 22 destructive mutations, all rejected by their relevant tests, while allowing sharing a cached warm glow. That mutation campaign was on the earlier renderer; the updated rectangular/kind integration is covered by the tests above.

The latest test-only repair retains radial circle geometry and the creation transform in the canvas fixture. Existing assertions sample opacity inside the cache surface and painted bounds: glow centres/inner areas must be visible and fade toward the corners; the vignette must leave the centre clear while darkening sides and corners in every world shape. Animated leg strokes require opacity and floor contrast for both kinds. Bun's built-in colour parser replaces the limited custom parser, accepting equivalent CSS colours such as HSL white. All 16 destructive mutations failed, including off-surface, oversized/tiny and displaced-paint glows, oversized/corner-only vignettes and invisible or camouflaged legs. Four harmless controls each passed the full check: HSL white, modest gradient tuning, equivalent gradient/paint transforms, and combined leg-colour/zero-blur/six-particle tuning. The count-independent particle assertions and consolidated Pool contract remain intact. Production rendering, simulation and effects are unchanged from `f2abea0`; browser timings, heap profiling and the operator's own browser check were not repeated by this test repair.

The terminal-hit engine test now clears its draw spy before each observed tick, requires a fresh renderer call and reads effects from that call. This prevents a mutable reference from an earlier draw masking a missing terminal, advancement or expiry render. In a scratch copy, suppressing all game-over draws passed the old test; the repaired test rejects that mutation as well as variants that skip only later advancement or expired-feedback frames. The original engine passes all six engine tests (117 assertions); production code is unchanged.

Automated Chrome checks at 390 x 844 portrait and 844 x 390 landscape (DPR 2) inspected the full grid/vignette, both beetle silhouettes/colours, glowing robot, streaks, bursts and labels. Portrait and landscape fixtures each contained 37 fast bugs during capture. Rotating the portrait run preserved its 450 x 800 world; restarting in landscape adopted 800 x 450. A 320 x 180 scene retained bold readable labels. Touch drag, keyboard movement, hit/squash feedback, terminal-hit expiry and immediate restart completed with no page errors. Application API calls were fulfilled by fixtures, with no API server or operator database used.

Screenshots and raw benchmark JSON are retained in the task scratch directory for local review. The operator's browser check before merge is the normal next review step specified by the owner; these automated checks do not claim to be that human check.

## Allocation evidence and limits

All pool storage and feedback scratch slots are allocated at construction; update and emission code creates no arrays, objects, strings or callbacks and never grows its storage. Tests verify storage identity through repeated emissions/updates/resets. Saturation occupancy is recorded above; pool capacities remain 1024 particles, 128 trails and 256 labels.

Historical Chrome allocation sampling at a 512-byte interval, with collected objects included, exercised the same warmed function for 100,000 iterations of squash/trail/hit/update using fractional timestamps. One warmed sample attributed no allocations to FX functions; another attributed approximately 109 KB to `advance`/`Pool.update`. Sampling includes runtime optimization/boxing effects and is not proof of literally zero V8 heap allocations. The fixed-capacity and no-explicit-allocation guarantees are structural and tested. Pool/coordinator runtime code is unchanged by this rectangular-world integration.


## Upgrade integration (issue #12, fresh validation)

The upgrade change adds a longer laser streak, shield bubble (two outlines for multiple charges), half-second expanding bomb ring and small orbiting drone glows. These reuse the procedural renderer and cached glow surfaces. Particle/trail/label capacities remain 1024/128/256; the ring uses one reusable slot. No application dependency or game image asset was added.

The benchmark accepts `?profile=laser`, `shield`, `bomb`, and `drone` (two picks of that upgrade), `first` (one of each), `double` (two of each), and `stress` (four laser/shield/bomb picks, nine drones). `?profile=stress&burst` also saturates the cosmetic pools. Scheduling is suppressed only in the benchmark fixture by setting its next choice to Infinity; live play has no rollout flag or setting. Fixture replenishment keeps 150 bugs at every draw. Forced contacts refill fixture shield charges before real blocks; bomb cooldowns and clears, laser kills and drone shots use the production simulation. Fixture setup/replenishment are timed separately. Diagnostic counters are included in the reported update interval, making those times slightly conservative. Counters span warmup plus sample; pool peaks and population bounds cover the sample.

Fresh browser checks used Chrome 157.0.8103.51 on the factory desktop with a scratch home, scratch browser profiles and fixture API responses. No API/database server was used and no operator data was opened. The cards were inspected at 390 x 844 and 844 x 390 CSS pixels, DPR 2:

- Portrait cards were 306 px wide and at least 100 px tall; landscape cards were approximately 245 x 150 px. Text wrapped without horizontal overflow and every card stayed in the viewport.
- Forward Tab and Shift+Tab cycling stayed within the cards; Escape left the choice open. Selection restored canvas focus. A real 30-second pause and rotation kept the complete gameplay state unchanged. Holding a numeric key before the offer did not select it; a fresh key did. Touch selected a card without steering or click-through and marked the run as touch input.
- All three numeric keys, Space activation, the game-over build (laser x1, bomb x2), its exact finish payload and immediate touch restart passed. Held steering repeats stayed cleared after selection. Page and console errors: zero. Unit tests also exercise each numeric key, stale choice/run identities, blur, long synthetic clock gaps, frozen effects and no resume catch-up.
- `bun run check`: 135 tests pass, 13,304 assertions, TypeScript clean. `bun run build` passes. Existing swarm pacing tests explicitly retain their no-upgrade baseline; separate tests exercise real scheduled choices beyond two minutes. Choice-driven runs in square, portrait and landscape arenas submit successfully against the in-process API with and without ten minutes of added wall-clock pause.

Screenshots: [portrait cards](upgrade-validation/portrait.png), [landscape cards](upgrade-validation/landscape.png), [portrait game over](upgrade-validation/game-over-portrait.png), [landscape game over](upgrade-validation/game-over-landscape.png). [Browser assertions and finish payload](upgrade-validation/browser.json) retain the measured card dimensions. The operator's normal browser check before merge and the PRD's five human pacing runs remain human review/follow-through; automation does not claim either of them.

### Fresh desktop performance results

2026-11-19, Windows 11 Home 10.0.26200, AMD Ryzen 9 7950X3D desktop, RTX 3090 host, headless Chrome 157.0.8103.51. Viewport 1280 x 720, device/render DPR 1, logical world 800 x 450. Each of the nine profiles ran sequentially with 10 seconds of warmup and 60 seconds of sampling (approximately 3,600 real RAF intervals per profile). Project checks finished before sampling and resumed after every profile completed. No concurrent benchmark or browser-interaction workload ran during sampling.

| Profile | Mean FPS | Lowest rolling FPS | Update mean / p95 ms | Draw mean / p95 ms | Fixture mean / p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| normal | 59.999 | 59.994 | 0.042 / 0.100 | 0.636 / 1.000 | 0.002 / 0.000 |
| laser | 59.999 | 59.988 | 0.054 / 0.100 | 0.640 / 1.000 | 0.002 / 0.000 |
| shield | 59.999 | 59.988 | 0.042 / 0.100 | 0.623 / 1.000 | 0.002 / 0.000 |
| bomb | 59.999 | 59.982 | 0.048 / 0.100 | 0.634 / 1.100 | 0.002 / 0.000 |
| drone | 59.999 | 59.988 | 0.048 / 0.100 | 0.630 / 1.000 | 0.002 / 0.000 |
| first | 59.999 | 59.994 | 0.057 / 0.200 | 0.710 / 1.200 | 0.003 / 0.000 |
| double | 59.999 | 59.988 | 0.057 / 0.200 | 0.685 / 1.200 | 0.003 / 0.000 |
| stress | 59.999 | 59.988 | 0.093 / 0.200 | 0.799 / 1.300 | 0.002 / 0.000 |
| burst | 59.999 | 59.994 | 0.093 / 0.200 | 1.037 / 1.700 | 0.005 / 0.000 |

| Profile | Bugs min-max | Fast bugs min-max | Peak particles / trails / labels / rings | Shield blocks | Bomb clears | Laser kills | Drone fires |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normal | 150-150 | 37-46 | 30 / 6 / 6 / 0 | 0 | 0 | 0 | 0 |
| laser | 150-150 | 27-41 | 94 / 6 / 17 / 0 | 0 | 0 | 1035 | 0 |
| shield | 150-150 | 30-39 | 29 / 6 / 5 / 0 | 67 | 0 | 0 | 0 |
| bomb | 150-150 | 29-47 | 1024 / 6 / 155 / 1 | 0 | 5 | 0 | 0 |
| drone | 150-150 | 31-45 | 44 / 6 / 8 / 0 | 0 | 0 | 0 | 142 |
| first | 150-150 | 30-43 | 1024 / 6 / 163 / 1 | 35 | 3 | 914 | 71 |
| double | 150-150 | 26-40 | 1024 / 6 / 169 / 1 | 69 | 5 | 1442 | 142 |
| stress | 150-150 | 23-42 | 1024 / 6 / 199 / 1 | 69 | 10 | 3405 | 639 |
| burst | 150-150 | 24-43 | 1024 / 6 / 256 / 1 | 68 | 10 | 3463 | 639 |

All profiles exceeded the 58 FPS criterion, with exactly 150 bugs at every sampled draw. Saturation reached the fixed particle and label caps while the ring stayed within its single slot. The activity counters confirm shield blocks, automatic clears, upgraded projectile kills and independent drone firing occurred; laser kills include all upgraded projectile sources. No page or console errors occurred. These are desktop measurements accepted by the owner, not estimates for other hardware. [Raw reports](upgrade-validation/benchmark.json) include browser version, durations, frame counts, viewport, population bounds, fixture costs and pool peaks.


### Focused test repairs after review

The follow-up changes tests only. `react-test-renderer` 18.3.1 is a development dependency matching React 18.3.1; it replaces the App test's server-rendered HTML probe with actual React effects, handlers and real Session subscriptions without a DOM/browser dependency or a custom React renderer. Native dialog methods and canvas mounting are test boundaries. The probe checks modal open/close, all three touch-card handlers, touch attribution, focus restoration and a full minute of UI timers without selection. Build and description assertions check meaningful content without fixing copy, separators or count placement.

The existing offer test now compares fixed different run seeds as well as equal seeds, including the simulation-to-choice seed handoff. Laser and bomb tests require effective opacity and contrast through the existing paint fixture; laser geometry only has to exceed the ordinary beam. The existing real-client/in-process-API test submits a mixed repeated-pick build and checks its SQLite JSON.

In a disposable copy, 15 broken variants were rejected: missing modal opening, disabled cards, timeout/interval auto-selection, missing dialog close/focus restoration, a constant seed at either layer, transparent laser, transparent/zero-alpha/camouflaged ring, dropped client upgrades, missing descriptions and missing build counts. Six harmless controls passed: a 30-unit laser instead of 48 (ordinary shots remain 18), equivalent descriptions, alternate empty copy, different build separators/count placement and modest ring-colour tuning.

`bun run check` passes all 135 tests with 13,320 assertions; `bun run build` produces the same application bundle. Neighboring engine keyboard/pointer and session lifecycle tests, drone glow checks, and the other client routes were inspected for the same gaps. The recorded browser/FPS measurements above were not rerun for this test-only repair; the operator's before-merge browser check remains due.


The subsequent shield review exposed a missed case in that audit: stroke-colour alpha alone did not guard a zero canvas globalAlpha. The existing shield test now applies visibleStroke to every outline with one and two charges, checking effective opacity, floor contrast and positive line width. In a disposable copy, nine broken variants failed (all-shield, single-charge, double-charge and second-outline transparency; transparent/camouflaged shield colours; invisible laser, bomb and drones). Three harmless shield controls passed: a different bright palette, HSL colour and 0.8 global opacity. The latest bun run check passes 135 tests with 13,326 assertions, and bun run build retains the same production bundle. Browser/FPS measurements were not repeated for this test-only correction.

## Phase 2 finish (issue #28, 2026-11-19)

F now includes the current bug population and live effects alongside FPS and update/draw timings. Effects are occupied particle, trail and label slots, plus one each for an active bomb ring, hit flash and shake. Projectiles, drones and shield outlines are excluded. The getter uses existing pool counts without scans, allocation or a second counter; it is read only at the existing one-second refresh while F is enabled. There is no added per-frame work. Focused tests cover exact populations, independent transients, replacement, expiry/reset, changing debug populations, repeat suppression, disabling, choice-modal input and restart cleanup.

Fresh post-change measurements used headless Chrome **156.0.8078.4**, Windows 11 Home **10.0.26200**, AMD Ryzen 9 7950X3D desktop. Viewport **1280×720**, device/render DPR **1**, logical world **800×450**. The existing `?profile=stress` and `?profile=stress&burst` ran sequentially, each with **10 seconds warmup + 60 seconds sample**, after checks/build completed. No concurrent checks or browser workloads ran. Vite alone bound to 127.0.0.1:5191 with strictPort; Chrome used scratch home/profile directories. Both browser and our Vite process stopped after measurement.

| Profile | Mean FPS | Lowest rolling FPS | Sample (ms) / intervals | Bugs min–max | Fast bugs min–max |
| --- | ---: | ---: | ---: | ---: | ---: |
| stress | 59.999 | 59.994 | 60001.0 / 3600 | 150–150 | 22–44 |
| stress + burst | 59.999 | 59.994 | 60000.9 / 3600 | 150–150 | 24–42 |

| Profile | Update mean / p95 (ms) | Draw mean / p95 (ms) | Fixture mean / p95 (ms) | Peak particles / trails / labels / rings |
| --- | ---: | ---: | ---: | ---: |
| stress | 0.093 / 0.200 | 0.849 / 1.400 | 0.003 / 0.000 | 1024 / 6 / 204 / 1 |
| stress + burst | 0.092 / 0.200 | 1.203 / 2.100 | 0.005 / 0.000 | 1024 / 6 / 256 / 1 |

Both profiles acquired four laser/shield/bomb picks and nine drones. Activity counters (warmup plus sample) were respectively **68 / 69 shield blocks**, **10 / 10 bomb detonations**, **3364 / 3334 upgraded projectile kills**, and **630 / 639 drone shots**. Pool peaks and bug bounds cover the sample only. Both mean and lowest rolling FPS exceed 58; no effects simplification was needed. [Raw reports](upgrade-validation/issue-28-benchmark.json) retain full precision and all counters. No page errors or API requests occurred; this developer-only fixture has no submission path, and the production build contains no benchmark entry or `lookBenchmark` hook.

`bun run check` passed **184 tests, 13,915 assertions**, with TypeScript clean; `bun run build` passed. The built application also passed the [fresh phone-layout and keyboard F probe](team-validation.md#phase-2-finish-issue-28-2026-11-19). The [1280×720 screenshot](team-evidence/issue-28/debug-desktop.png) shows the complete readout within the viewport, and a second F press restored the hint. These factory Chrome measurements satisfy the issue's owner ruling; the operator's own browser check remains required before merge.

### Review follow-up (2026-11-19)

Review reported an initial Chrome 156 normal-stress rolling minimum of **56.994 FPS**, followed by **59.988** when repeated without concurrent review commands; its burst run reached **59.994**. Product review's Chrome 153 normal run also reached **59.988**, but its additional 300-synthetic-squashes/second saturation runs reached **54.10** and **53.99** (means **59.43** and **59.62**). Those below-floor observations remain on record; the initial passing measurements above do not invalidate them.

To check recurrence under the documented measurement conditions, a preselected sequence of **three normal stress trials and one burst trial** ran on the same factory machine and **Chrome 156.0.8078.4** as the initial review, with fresh scratch home/profile/data. All four reports are retained, with no retries or discarded samples. Each used the unchanged benchmark, 1280×720, DPR 1, 10-second warmup and 60-second sample. Checks/build finished first; no project checks, browser probes or review commands ran alongside these trials. Only the benchmark runner and its Vite/Chrome processes ran for this validation, and all were closed afterward.

| Trial | Mean FPS | Lowest rolling FPS | Sample ms / intervals | Bugs min–max | Fast bugs min–max |
| --- | ---: | ---: | ---: | ---: | ---: |
| normal 1 | 59.982 | 59.000 | 60001.1 / 3599 | 150–150 | 26–42 |
| normal 2 | 59.999 | 59.986 | 60001.1 / 3600 | 150–150 | 25–43 |
| normal 3 | 59.982 | 59.020 | 60001.0 / 3599 | 150–150 | 23–43 |
| burst | 59.899 | 58.000 | 60001.0 / 3594 | 150–150 | 25–42 |

| Trial | Update mean / p95 ms | Draw mean / p95 ms | Fixture mean / p95 ms | Peak particles / trails / labels / rings | Blocks / bombs / upgraded kills / drone shots |
| --- | ---: | ---: | ---: | ---: | ---: |
| normal 1 | 0.108 / 0.200 | 1.223 / 2.200 | 0.003 / 0.000 | 1024 / 6 / 200 / 1 | 69 / 10 / 3383 / 630 |
| normal 2 | 0.114 / 0.200 | 1.241 / 2.100 | 0.003 / 0.000 | 1024 / 6 / 204 / 1 | 67 / 10 / 3384 / 639 |
| normal 3 | 0.111 / 0.200 | 1.142 / 2.100 | 0.003 / 0.000 | 1024 / 6 / 204 / 1 | 67 / 10 / 3378 / 639 |
| burst | 0.119 / 0.200 | 1.591 / 3.000 | 0.006 / 0.000 | 1024 / 6 / 256 / 1 | 67 / 10 / 3384 / 639 |

Every trial used four laser/shield/bomb picks and nine drones, with no page errors or API requests. Activity counters include warmup; population bounds and peaks cover sampling only. [All follow-up raw reports](upgrade-validation/issue-28-followup-benchmark.json) retain full precision. The below-58 normal dip did **not recur in three isolated normal samples**; the burst trial also met the unchanged **≥58** floor, at exactly 58 in its lowest window. Render/update p95 costs remained well below the 16.67 ms frame budget. Concurrent machine scheduling is a plausible explanation for the review dip, consistent with its own isolated repeat, but no trace establishes its cause and these finite samples cannot guarantee absence of future scheduling stalls. No renderer or emission change was justified by this reproduction. The older Chrome 153 saturation results are not claimed to have passed. The operator's browser check remains required before merge.

The choice-screen test now advances both the sampling-initialization tick and a full additional second before checking that F stayed suppressed. Enabling F during a choice is rejected by that assertion. Nearby numeric assertions allow equivalent label placement/punctuation; effect composition remains in pool tests and immediate disable clearing remains in the existing F frame-rate test. The simplified wiring test still rejects missing bug counts, wrong effect counts, repeated-key toggles and effects surviving restart. `bun run check` passes **184 tests, 13,913 assertions**; `bun run build` passes with the same application assets. Production code and game-over layout are unchanged by this repair, so the existing phone evidence still applies.

### Recurring dip investigation (second return, 2026-11-19; unresolved)

Product review of `e8e6940` reported **59.949 mean / 57.000 lowest rolling FPS** in normal stress, then **59.999 / 59.988** in burst and **59.999 / 59.992** in a subsequent normal trial. All held 150 bugs with all upgrades active. These three reported results are preserved in [the investigation report](upgrade-validation/issue-28-investigation.json), alongside every new capture. The 57 FPS finding is valid evidence. Passing retries did not establish its cause, and this investigation does **not** claim a causal performance fix or readiness to merge.

The missing evidence was the work around the failing window: previous reports retained only averages, p95 and one rolling minimum. The existing developer benchmark now retains `result.frameAudit`, with every completed one-second window, maximum measured callback duration/RAF interval, and details for each interval over 25 ms. Gap details include preceding callback duration, time between callbacks, current callback delay/work and update/draw/fixture costs. The 25 ms cutoff selects detail only: **every frame still counts toward FPS**, including all gaps. Warmup, duration, bug count, upgrades and the ≥58 floor are unchanged. Callback work covers the fixture, simulation/FX, draw submission and readout up to the audit call; audit bookkeeping and final JSON reporting are excluded. Deferred browser raster/compositing work is not included, so a gap between short callbacks cannot alone distinguish GPU work from OS/browser scheduling. The recorder is developer-only, with scalar work per frame and objects emitted per completed window or gap. It is absent from the production bundle and has no API client.

Tests seed real-duration sample timestamps, preserve complete windows, count a deliberately lost interval as **55 FPS**, and distinguish an 80 ms preceding callback from a 100 ms delivery gap between short callbacks. `bun run check` passes **187 tests / 13,939 assertions** and `bun run build` passes with unchanged application assets. Existing phone/F/gameplay evidence remains applicable; no production, upgrade, scoring or layout code changed.

Profiling used the same Windows/CPU/Chrome 156 environment, RTX 3090 via ANGLE D3D11, viewport 1280×720, DPR 1. Browser homes/profiles/data were scratch-only. Captures ran sequentially, without concurrent project checks or other validation workloads. Six captures used Chrome tracing; two used lighter callback ledgers with three-minute samples; three used a separately Vite-built fixture served entirely through browser interception and default Playwright RAF polling. No-draw cases suppress rendering only in scratch tooling, retain simulation/upgrades and are **diagnostic controls, not acceptance evidence**. All browser/Vite processes and handles were closed. No page errors or API requests occurred. Tracing and wrappers can perturb timing.

| Capture | Sample seconds | Mean / lowest rolling FPS | Maximum measured callback ms |
| --- | ---: | ---: | ---: |
| Traced normal, initial | 60 | 59.999 / 59.982 | 5.600 |
| Traced normal A / B / C | 60 each | 59.999 / 59.994; 59.999 / 59.994; 59.999 / 59.988 | 4.600 / 4.400 / 4.200 |
| Traced burst | 60 | 59.999 / 59.988 | 4.600 |
| Traced no-draw control | 60 | 59.999 / 59.982 | 1.600 |
| Longer normal | 180 | 59.999 / 59.982 | 6.100 |
| Longer no-draw control | 180 | 59.999 / 59.988 | 3.200 |
| Bundled normal A / B | 60 each | 59.999 / 59.994; 59.999 / 59.982 | 12.900 / 5.300 |
| Bundled no-draw control | 60 | 59.999 / 59.994 | 1.900 |

All 11 pre-change captures are retained: [reports and derived windows](upgrade-validation/issue-28-investigation.json), [gzip JSON callback ledgers](upgrade-validation/issue-28-profiling-ledgers.json.gz). The scratch wrappers measured complete callbacks, including final reporting; these maxima are not identical in scope to the maintained recorder. The initial trace found an **80.441 ms GPU raster flush during warmup**, and a maximum sampled raster flush of **13.675 ms**; that passing trace supplies no below-floor window to attribute. Neither drawing controls nor normal captures reproduced the returned failure, so there is no basis to blame or exonerate effects or machine contention.

The revised benchmark itself was then measured normally (10-second warmup, 60-second sample, no tracing/wrappers):

| Profile | Mean / lowest rolling FPS | Update mean / p95 ms | Draw mean / p95 ms | Fixture mean / p95 ms | Max measured callback / interval ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| stress | 59.982 / 59.020 | 0.095 / 0.200 | 0.869 / 1.500 | 0.003 / 0.000 | 3.300 / 33.300 |
| stress + burst | 59.999 / 59.988 | 0.091 / 0.200 | 1.132 / 1.900 | 0.004 / 0.000 | 4.800 / 17.200 |

[Full reports](upgrade-validation/issue-28-diagnostic-benchmark.json) retain all windows and one normal 33.3 ms gap: preceding measured work **0.9 ms**, current work **0.8 ms**, with **32.4 ms between callbacks**. This identifies a missed frame outside measured game callbacks, but not the cause of the earlier 57 FPS window. Both profiles held 150 bugs with four laser/shield/bomb picks and nine drones; activity was respectively **67/67 blocks, 10/10 bombs, 3309/3425 upgraded kills, 630/639 drone shots**. No failed or passing capture was discarded. The performance finding remains open pending a failing-window capture with the new audit and Chrome trace on the product-review path, or a controlled factory-machine profiling window. The operator's separate browser check remains required before merge. No physical device is requested.
