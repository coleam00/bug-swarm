# Upgrade-enabled pacing validation

Measured on 2026-11-19 against baseline `032ed1c` and this change. The permanent harness was run before changing combat, then kept fixed during tuning. [Before](pacing-validation/before.txt) and [after](pacing-validation/after.txt) retain every case's seconds, death/cutoff status, score, priority and acquired build.

## Reproduce the acceptance check

Run `bun run pacing`. It imports the production simulation, arena sizing, fixed step, seeded offers, choice selection and acquired-build summary. There is no browser, API, database, forced offer, invulnerability or disabled choice in this harness. Default execution is exactly 20 runs: idle/evasive × five seeds × 390×844/1280×800 viewports.

| Seed | Evasive priority (first available card wins) |
| --- | --- |
| 1 | shield, drone, bomb, laser |
| 42 | drone, bomb, shield, laser |
| 12345 | bomb, drone, laser, shield |
| 7 | laser, shield, drone, bomb |
| 99 | drone, laser, bomb, shield |

Idle input is always zero, and idle choices always take the first offered card regardless of seed priority. Evasive input starts with `x = 0.15*(arena.width/2 - robot.x)/arena.width` and the corresponding y expression. Every bug at distance `0 < d < 200` contributes the robot-minus-bug unit vector times `1 - d/200`. Zero-distance bugs contribute nothing. Input has `target: null`; production movement normalizes it and clamps at walls. This formula and these seeds were unchanged during tuning.

Pending choices resolve immediately without advancing gameplay time. Runs step at `STEP` (1/60 second), shortening the final step at a 600-second diagnostic horizon. A survivor there is a cutoff, never a death; printed cutoff times and affected summaries are lower bounds. Targets use unrounded gameplay time with a 1e-7 second floating-point tolerance. The command prints separate PASS/FAIL results and exits nonzero for any failed target or invalid score.

## Before and after

All times below are gameplay seconds. `≥600` denotes a survivor at the horizon. The baseline had eight idle failures and three cutoff survivors; the final run has neither.

| Mode | Viewport | Seed | Before | After |
| --- | --- | ---: | ---: | ---: |
| idle | 390×844 | 1 | 81.62 | 40.95 |
| idle | 390×844 | 42 | 64.48 | 44.82 |
| idle | 390×844 | 12345 | 65.77 | 57.58 |
| idle | 390×844 | 7 | 67.75 | 54.52 |
| idle | 390×844 | 99 | 49.82 | 49.43 |
| idle | 1280×800 | 1 | 75.17 | 43.45 |
| idle | 1280×800 | 42 | 66.87 | 42.98 |
| idle | 1280×800 | 12345 | 84.55 | 56.25 |
| idle | 1280×800 | 7 | 69.57 | 52.78 |
| idle | 1280×800 | 99 | 57.40 | 44.93 |
| evasive | 390×844 | 1 | 115.47 | 79.88 |
| evasive | 390×844 | 42 | ≥600 | 67.80 |
| evasive | 390×844 | 12345 | ≥600 | 74.33 |
| evasive | 390×844 | 7 | 71.42 | 58.93 |
| evasive | 390×844 | 99 | 138.68 | 99.65 |
| evasive | 1280×800 | 1 | 98.27 | 85.17 |
| evasive | 1280×800 | 42 | 134.08 | 85.65 |
| evasive | 1280×800 | 12345 | ≥600 | 61.38 |
| evasive | 1280×800 | 7 | 67.48 | 53.85 |
| evasive | 1280×800 | 99 | 127.72 | 79.95 |

| Group | Median before → after | Longest before → after | Cutoffs before → after |
| --- | ---: | ---: | ---: |
| idle portrait | 65.77 → 49.43 | 81.62 → 57.58 | 0 → 0 |
| idle landscape | 69.57 → 44.93 | 84.55 → 56.25 | 0 → 0 |
| idle combined | 67.31 → 47.18 | 84.55 → 57.58 | 0 → 0 |
| evasive portrait | 138.68 → 74.33 | ≥600 → 99.65 | 2 → 0 |
| evasive landscape | 127.72 → 79.95 | ≥600 → 85.65 | 1 → 0 |
| evasive combined | 130.90 → 77.11 | ≥600 → 99.65 | 3 → 0 |
| all | 78.39 → 56.92 | ≥600 → 99.65 | 3 → 0 |

PASS: all ten idle players actually died by 60 seconds. PASS: evasive medians in both viewports and combined are 60–180 seconds. PASS: all 20 runs actually died by 240 seconds. PASS: every result passes `parseFinish` and `plausible` using its acquired upgrades and exact simulated elapsed time, without extra wall-clock pause; squashes never exceed spawned bugs.

The baseline raw log conservatively prefixes medians with `≥` whenever the group contains a cutoff. Its medians above are exact: all central order statistics are completed deaths, below every censored time. The final reporter only prefixes medians when censoring affects a central order statistic.

## Final rules and tuning

- Shield refills to `min(picks, 4)`, with no healing or accumulated charges. First/second picks grant one/two charges; two further picks grow capacity to four, then picks refill spent charges at that cap. Pick counts remain independent of resources and retain the existing finish format.
- Bomb must be acquired. Acquisition arms the first clear; subsequent picks recalculate from the last detonation without an extra explosion. Recharge is `15 + 15/picks` seconds: 30, 22.5, 20, 18.75, … approaching 15. It waits for bugs when armed, pauses with choices and scores ten per victim, as do drones and robot shots.
- Spawn intervals linearly interpolate through `(0,1), (20,0.8), (30,0.6), (60,0.35), (120,0.2), (180,0.18)` in gameplay seconds. Thereafter use `1/6 + (0.18 - 1/6)*exp(-(time - 180)/60)`. Intervals never fall below 1/6 second, preserving the server's six-squashes-per-second cumulative allowance. Scheduled overshoot, fast unlock at 30 seconds and every-fourth fast cadence remain intact.
- Both bug kinds multiply movement speed by `1 + max(0,time - 60)/60 + (max(0,time - 90)/45)^2`. This applies to existing and newly spawned bugs and preserves the fast/base speed ratio. Pressure continues growing past 120 seconds; death still comes from contacts. There is no forced ending or time damage.
- Drones still add one firing drone per pick; laser picks still increase projectile penetration. First and repeated shield/bomb benefits share their formulas with card descriptions.

The plan's initial faster spawn curve and speed ramp starting at 30 seconds ended evasive medians at 48.57/44.88 seconds, below target. The final gentler early spawn curve and linear speed ramp starting at 60 seconds restore time to move and choose upgrades while meeting every idle ceiling. Seeds, steering, scoring and acceptance limits were not tuned.

## Broader build diagnostic and regression

The exported `runScenario` also exercised all 24 permutations of the four upgrade priorities over all five seeds and both shapes (240 evasive runs). Twenty further runs alternate preferred drone/bomb or shield/bomb by choice number, starting with drone or shield. If the preferred card is missing, select the other member of the pair, then fall back to registry order. All use the same production offers, movement, fixed step and 600-second horizon. Across these 260 runs: median **71.19 seconds**, longest **100.57 seconds**, zero cutoffs, zero runs over 240 seconds, and all scores pass server validation.

The diagnostic is reproducible with `runScenario`, `SCENARIOS` and `VIEWPORTS` from `scripts/pacing.ts`: enumerate each permutation, seed and viewport with mode `evasive`; supply the alternating choice function as the optional third argument. These finite policies are regression evidence, not proof against every possible steering strategy.

`scripts/pacing.test.ts` replays seeds 1 and 42 in both modes and shapes, asserting actual death, idle ≤60, all ≤240, deterministic results, valid scoring and exact acquired-pick totals. It also checks first-card idle choices, priority fallback, choice pause/resume time, evasion math and cutoff rejection. Focused combat tests cover shield cap/refill/no healing, first/second/high-count bomb cooldowns, no pre-acquisition or repeat-pick free clears, paused recharge, unchanged scoring, late spawn growth, late movement of both kinds and the cumulative spawn bound through 600 seconds. The obsolete no-upgrade duration fixtures were replaced by upgrade-enabled acceptance coverage; collision, movement, targeting, score and rendering coverage remain.

## Chrome validation

Chrome uses a scratch profile/home/data directory and a Vite-only server started for this task; API requests in the UI fixture are intercepted, and no database is opened. First, second and capped refill cards were inspected and selected by touch at 390×844 and 1280×800. All card bounds fit the viewport with no horizontal overflow and targets at least 44 px. The production renderer shows one/two shield outlines, one/two drones, piercing streaks and the bomb ring after first/repeated picks in both shapes. [Browser assertions](pacing-validation/browser.json) include card text/bounds and effect state.

Screenshots: [capped portrait cards](pacing-validation/cards-390-4.png), [second-pick landscape cards](pacing-validation/cards-1280-1.png), [repeated effects in portrait](pacing-validation/effects-390-double.png), [repeated effects in landscape](pacing-validation/effects-1280-double.png).

Performance follows [look-validation.md](look-validation.md): 150 bugs at every draw, 10 seconds of warmup and 60 seconds of real RAF sampling, sequential profiles, no concurrent project checks or interaction tests. The late sample starts at 180 gameplay seconds, so its sampled pursuit speeds cover approximately 190–250 seconds. Per-frame balance cost is a single speed-multiplier calculation per active step plus one multiply per bug; the exponential spawn tail is evaluated only at scheduled spawns.

Factory environment: Windows 11 Home 10.0.26200, AMD Ryzen 9 7950X3D desktop, headless installed Chrome 157.0.8103.51, viewport 1280×720, device/render DPR 1. Every sample recorded 3,600 RAF intervals over approximately 60 seconds. [Raw benchmark reports](pacing-validation/benchmark.json) retain population bounds, activity counters, pool peaks and browser metadata.

| Profile | Mean / lowest rolling FPS | Update mean / p95 ms | Draw mean / p95 ms | Fixture mean / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| normal | 59.999 / 59.994 | 0.039 / 0.100 | 0.612 / 1.000 | 0.002 / 0.000 |
| double | 59.999 / 59.992 | 0.054 / 0.100 | 0.672 / 1.200 | 0.002 / 0.000 |
| stress + burst | 59.999 / 59.994 | 0.096 / 0.200 | 1.017 / 1.700 | 0.004 / 0.000 |
| double + late | 59.999 / 59.992 | 0.054 / 0.200 | 0.756 / 1.400 | 0.004 / 0.000 |

All four profiles exceeded 58 FPS, with 150 bugs at every sampled draw and no page/console errors. Double/stress/late activity counters confirm blocks, bomb clears, piercing kills and drone firing. Burst mode reached the fixed 1,024-particle and 256-label caps. Chrome and Vite were stopped after validation.

`bun run pacing` passes all targets; `bun run check` passes TypeScript and 134 tests; `bun run build` passes. These are factory desktop measurements under the owner's ruling, with no physical-device evidence requested.

The PRD's five human runs remain the Phase 2 release validation; this deterministic/browser evidence does not replace them.
