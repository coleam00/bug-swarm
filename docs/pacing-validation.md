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
| idle | 390×844 | 1 | 81.62 | 27.17 |
| idle | 390×844 | 42 | 64.48 | 38.67 |
| idle | 390×844 | 12345 | 65.77 | 37.77 |
| idle | 390×844 | 7 | 67.75 | 33.52 |
| idle | 390×844 | 99 | 49.82 | 24.75 |
| idle | 1280×800 | 1 | 75.17 | 23.90 |
| idle | 1280×800 | 42 | 66.87 | 36.25 |
| idle | 1280×800 | 12345 | 84.55 | 36.93 |
| idle | 1280×800 | 7 | 69.57 | 26.53 |
| idle | 1280×800 | 99 | 57.40 | 26.58 |
| evasive | 390×844 | 1 | 115.47 | 64.82 |
| evasive | 390×844 | 42 | ≥600 | 61.47 |
| evasive | 390×844 | 12345 | ≥600 | 53.92 |
| evasive | 390×844 | 7 | 71.42 | 35.87 |
| evasive | 390×844 | 99 | 138.68 | 69.50 |
| evasive | 1280×800 | 1 | 98.27 | 64.32 |
| evasive | 1280×800 | 42 | 134.08 | 61.00 |
| evasive | 1280×800 | 12345 | ≥600 | 39.35 |
| evasive | 1280×800 | 7 | 67.48 | 43.35 |
| evasive | 1280×800 | 99 | 127.72 | 65.98 |

| Group | Median before → after | Longest before → after | Cutoffs before → after |
| --- | ---: | ---: | ---: |
| idle portrait | 65.77 → 33.52 | 81.62 → 38.67 | 0 → 0 |
| idle landscape | 69.57 → 26.58 | 84.55 → 36.93 | 0 → 0 |
| idle combined | 67.31 → 30.34 | 84.55 → 38.67 | 0 → 0 |
| evasive portrait | 138.68 → 61.47 | ≥600 → 69.50 | 2 → 0 |
| evasive landscape | 127.72 → 61.00 | ≥600 → 65.98 | 1 → 0 |
| evasive combined | 130.90 → 61.23 | ≥600 → 69.50 | 3 → 0 |
| all | 78.39 → 38.22 | ≥600 → 69.50 | 3 → 0 |

PASS: all ten idle players actually died by 60 seconds. PASS: evasive medians in both viewports and combined are 60–180 seconds. PASS: all 20 runs actually died by 240 seconds. PASS: every result passes `parseFinish` and `plausible` using its acquired upgrades and exact simulated elapsed time, without extra wall-clock pause; squashes never exceed spawned bugs.

The baseline raw log conservatively prefixes medians with `≥` whenever the group contains a cutoff. Its medians above are exact: all central order statistics are completed deaths, below every censored time. The final reporter only prefixes medians when censoring affects a central order statistic.

## Final rules and tuning

- Shield refills to `min(picks, 4)`, with no healing or accumulated charges. First/second picks grant one/two charges; two further picks grow capacity to four, then picks refill spent charges at that cap. Pick counts remain independent of resources and retain the existing finish format.
- Bomb must be acquired. Acquisition arms the first clear; subsequent picks recalculate from the last detonation without an extra explosion. Recharge is `15 + 15/picks` seconds: 30, 22.5, 20, 18.75, … approaching 15. It waits for bugs when armed, pauses with choices and scores ten per victim, as do drones and robot shots.
- Spawn intervals linearly interpolate through `(0,0.9), (20,0.8), (30,0.6), (60,0.3), (120,0.2), (180,0.18)` in gameplay seconds. Thereafter use `1/6 + (0.18 - 1/6)*exp(-(time - 180)/60)`. Intervals never fall below 1/6 second, preserving the server's six-squashes-per-second cumulative allowance. Scheduled overshoot, fast unlock at 30 seconds and every-fourth fast cadence remain intact.
- Both bug kinds multiply movement speed by `1 + max(0,time - 50)/60 + (max(0,time - 90)/45)^2`. This applies to existing and newly spawned bugs and preserves the fast/base speed ratio. Pressure continues growing past 120 seconds; death still comes from contacts. There is no forced ending or time damage.
- Drones still add one firing drone per pick; laser picks still increase projectile penetration. First and repeated shield/bomb benefits share their formulas with card descriptions.
- Robot and drone firing cadence is 1.5 gameplay seconds. First and repeated drone picks still add an immediately ready firing drone. This reduces automatic sustain while preserving the added drone and laser penetration benefits.

The first delivery passed the prescribed 20 cases but did not generalize: seed 5 survived 67.70/64.88 seconds, and a 400-case probe found 73 idle failures, reaching 84.98 seconds. Stronger spawn pressure alone shortened evasive runs too far. The correction combines a slightly earlier first spawn, the shorter 60-second spawn interval, pursuit growth starting at 50 seconds, and slower automatic fire. Seeds, steering, offers, scoring and acceptance limits remain unchanged.

The final tuning additionally passed **100,000 idle runs**: seeds 0–24,999 and `Math.imul(i + 1, 0x9e3779b9) >>> 0` for i=0–24,999, each in both required shapes. All actually died within 60 seconds, all scores were valid, and the longest was **59.40 seconds**. [Repair-check results](pacing-validation/repair-checks.json) retain the sample definition and mutation outcomes. This is a wider deterministic sample, not a proof over every 32-bit seed.

## Broader build diagnostic and regression

The exported `runScenario` also exercised all 24 permutations of the four upgrade priorities over all five seeds and both shapes (240 evasive runs). Twenty further runs alternate preferred drone/bomb or shield/bomb by choice number, starting with drone or shield. If the preferred card is missing, select the other member of the pair, then fall back to registry order. All use the same production offers, movement, fixed step and 600-second horizon. Across these 260 runs: median **47.36 seconds**, longest **75.32 seconds**, zero cutoffs, zero runs over 240 seconds, and all scores pass server validation.

The diagnostic is reproducible with `runScenario`, `SCENARIOS` and `VIEWPORTS` from `scripts/pacing.ts`: enumerate each permutation, seed and viewport with mode `evasive`; supply the alternating choice function as the optional third argument. These finite policies are regression evidence, not proof against every possible steering strategy.

`scripts/pacing.test.ts` replays seeds 1 and 42 in both modes and shapes, asserting actual death, idle ≤60, all ≤240, deterministic results, valid scoring and exact acquired-pick totals. It also checks first-card idle choices, priority fallback, choice pause/resume time, evasion math and cutoff rejection. Focused combat tests cover shield cap/refill/no healing, first/second/high-count bomb cooldowns, no pre-acquisition or repeat-pick free clears, paused recharge, unchanged scoring, late spawn growth, late movement of both kinds and the cumulative spawn bound through 600 seconds. The obsolete no-upgrade duration fixtures were replaced by upgrade-enabled acceptance coverage; collision, movement, targeting, score and rendering coverage remain.

Return-check repairs add a separate 400-case idle regression (seeds 0–99 plus the same 100-value spread, including seed 5), a default-matrix contract, independent odd/even median and maximum fixtures, vertical/off-centre steering checks and live scheduled-spawn counts through 300 seconds. Deliberately reducing the matrix, dropping shield-first priority, substituting mean/minimum summaries, removing either vertical steering term or clamping the live spawn curve at 120 seconds each fails its corresponding test. The wording-sensitive card test was removed; combat and App tests retain effect and presentation coverage. The duplicate paused-step frozen-state assertion was removed while actual choice resolution remains tested. The server finish-validation fixture now protects its first three scheduled choices so early combat deaths cannot remove upgraded payload coverage; the pacing harness has no such protection.

## Chrome validation

Chrome uses a scratch profile/home/data directory and a Vite-only server started for this task; API requests in the UI fixture are intercepted, and no database is opened. First, second and capped refill cards were inspected and selected by touch at 390×844 and 1280×800. All card bounds fit the viewport with no horizontal overflow and targets at least 44 px. The production renderer shows one/two shield outlines, one/two drones, piercing streaks and the bomb ring after first/repeated picks in both shapes. [Browser assertions](pacing-validation/browser.json) include card text/bounds and effect state.

Screenshots: [capped portrait cards](pacing-validation/cards-390-4.png), [second-pick landscape cards](pacing-validation/cards-1280-1.png), [repeated effects in portrait](pacing-validation/effects-390-double.png), [repeated effects in landscape](pacing-validation/effects-1280-double.png).

Performance follows [look-validation.md](look-validation.md): 150 bugs at every draw, 10 seconds of warmup and 60 seconds of real RAF sampling, sequential profiles, no concurrent project checks or interaction tests. The late sample starts at 180 gameplay seconds, so its sampled pursuit speeds cover approximately 190–250 seconds. Per-frame balance cost is a single speed-multiplier calculation per active step plus one multiply per bug; the exponential spawn tail is evaluated only at scheduled spawns.

Factory environment: Windows 11 Home 10.0.26200, AMD Ryzen 9 7950X3D desktop, headless installed Chrome 157.0.8103.51, viewport 1280×720, device/render DPR 1. Every sample recorded about 3,600 RAF intervals over approximately 60 seconds. [Raw benchmark reports](pacing-validation/benchmark.json) retain population bounds, activity counters, pool peaks and browser metadata.

| Profile | Mean / lowest rolling FPS | Update mean / p95 ms | Draw mean / p95 ms | Fixture mean / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| normal | 59.999 / 59.988 | 0.046 / 0.100 | 0.699 / 1.200 | 0.003 / 0.000 |
| double | 59.999 / 59.988 | 0.073 / 0.200 | 0.883 / 1.600 | 0.003 / 0.000 |
| stress + burst, first saved sample | 59.849 / 56.989 | 0.122 / 0.200 | 1.612 / 2.900 | 0.005 / 0.000 |
| double + late | 59.999 / 59.980 | 0.061 / 0.200 | 0.855 / 1.700 | 0.003 / 0.000 |

The stress sample's mean exceeded 58 FPS but its lowest rolling window failed that threshold. An earlier attempt also failed the rolling guard before the runner saved its report. To check whether the changed balance caused the dip, a fresh sequential comparison measured the returned commit's constants and the fix with the identical stress/burst fixture and warmup/sample protocol. The runner saved reports before checking thresholds. [Control reports](pacing-validation/stress-comparison.json) retain both results:

| Stress/burst control | Mean / lowest rolling FPS | Update mean / p95 ms | Draw mean / p95 ms | Fixture mean / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| returned commit `35f6fa2` | 59.999 / 59.992 | 0.106 / 0.200 | 1.175 / 2.200 | 0.005 / 0.000 |
| fixed constants | 59.966 / 58.994 | 0.123 / 0.200 | 1.628 / 2.800 | 0.006 / 0.100 |

The fixed control met 58 FPS in both mean and lowest rolling rate. The earlier dip did not recur in this comparison; it remains recorded above rather than being counted as a passing sample. Both versions use the same per-frame code; timings include the changed combat/effect workload. Normal, double and late samples passed the rolling threshold. All samples held 150 bugs at every draw with no page/console errors. Double/stress/late counters confirm blocks, bomb clears, piercing kills and drone firing; burst mode reached the fixed 1,024-particle and 256-label caps. Chrome and Vite were stopped after validation.

`bun run pacing` passes all targets; `bun run check` passes TypeScript and 137 tests; `bun run build` passes. These are factory desktop measurements under the owner's ruling, with no physical-device evidence requested.

The PRD's five human runs remain the Phase 2 release validation; this deterministic/browser evidence does not replace them.
