# Pacing validation

## Issue 40: opening investigation (unresolved)

The first-run steering hint is implemented; **the gentler opening and idle 20–30-second harness gate remain pending**. No candidate was selected for production. The existing spawn curve, upgrades, steering policies, seeds, score checks and pacing gates remain unchanged. This is an empirical tuning failure, not a proof that no curve can satisfy the requested targets.

Baseline reports for this checkout: [default](steering-evidence/before-default.txt), [full broad](steering-evidence/before-broad.txt). The baseline default idle range is 12.45–15.90 seconds, evasive median 78.69 seconds. The broad evasive median is 76.73 seconds, longest run 156.93 seconds, with zero score failures and every existing gate passing.

Curve-only experiments varied quiet openings, linear opening intervals, pressure around 15–20 seconds, short pressure after the first choice, and relief before the unchanged 60-second knot. Reaching the first choice changes the stationary robot's build: laser's firing bonus/penetration and bomb's acquisition clear can sustain it through a sparse opening. Increasing pressure to overwhelm those builds also kills the scripted evasive shield/drone builds early. Default idle still takes the first card; broad idle still follows each named priority. No idle detector, artificial death, upgrade bypass, steering-policy change or scoring relaxation was used.

Two representative rejected curves are reproducible with `bun docs/steering-pacing-investigation.ts` using scratch environment/data paths. It mutates only its process-local configuration, runs the unchanged default and full 2,000-case broad harness, prints the proposed inclusive raw-time idle gate with the existing 1e-7 tolerance, and writes [exact knots and summaries](steering-evidence/pacing-investigation.json).

| Rejected curve | Default idle range | Default evasive median | Broad idle range | Broad evasive median | Broad longest | Score failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Gentle | 32.30–128.98s | 79.07s | 18.47–104.92s | 76.05s | 153.00s | 0 |
| Pressure | 27.37–30.65s | 34.67s | 27.27–31.62s | 34.43s | 140.40s | 0 |

Gentle uses `(time, interval)` knots `(0,.95), (15,.9), (20,.2), (22,.2), (23,10), (45,10)` before the original late knots. It preserves every evasive gate but fails both idle gates; 359/1,000 broad idle cases leave the proposed range. Pressure uses `(0,2), (15,2), (20,.02), (22,.02), (23,10), (45,10)` before the original late knots. It brings all but 31/1,000 broad idle cases inside the range, but fails the default evasive gate, broad overall median and four of the five per-priority floors. Every run in both candidates ends by 240 seconds.

Complete rejected reports: [gentle default](steering-evidence/gentle-default.txt), [gentle broad](steering-evidence/gentle-broad.txt), [pressure default](steering-evidence/pressure-default.txt), [pressure broad](steering-evidence/pressure-broad.txt). These are diagnostic failures, not acceptance evidence. The proposed gate and its production regression tests must be added together with a passing balance change. The first-run hint's Chrome/layout/lifecycle and frame-cost evidence lives in [steering validation](steering-validation.md).

## Score plausibility calibration: issue #34

Before changing validation, `runBroadMatrix()` from `scripts/pacing.ts` at `e5bd626764f19c2a729655621e8cb5a79e7d94b9` reproduced all 2,000 broad cases with zero invalid finishes:

- Maximum run-average squashes per **submitted integer gameplay second**: **466 / 156 = 2.987179487**. This is the denominator used by the server cap, rather than a peak one-second burst.
- Maximum run-average squashes per precise gameplay second: **2.969413764**.
- Longest gameplay duration: **156.933333333 seconds**.

All three maxima occur in evasive seed **46**, viewport **1280×800**, priority **ci-drone → review-laser → refactor-bomb → test-shield**. The maximum score is **4,816**, rather than the issue's approximate 2,600. Reproduce by importing `runBroadMatrix`, then reducing the returned rows by `squashes / seconds`, `squashes / elapsed` and `elapsed`, respectively.

`rules.ts` caps squashes at **4.5 per submitted second** (approximately 1.5 × the measured maximum, rounded upward) and submitted gameplay duration at **300 seconds**. Submitted seconds cannot exceed whole server elapsed seconds. Extra wall-clock time, including upgrade choices, earns no extra squash allowance; an otherwise legal short finish can still arrive after a long pause. These empirical bounds limit obvious forgeries, not cheating: the maximum accepted score is still **13,800**, and the owner hides bad entries manually. Exceptional legitimate runs can exceed these measured bounds.

The harness feeds every finish through the real `plausible()` function using `Math.ceil(state.time * 1000)` as its synthetic server completion timestamp, the first integer millisecond at or after completion. Raw `elapsed` remains unchanged for measurements. This avoids microscopic floating-point drift below a whole second when simulation scoring uses `floor(time + 1e-9)`; the server gains no clock slack. The seeded API simulation fixture uses the same convention. Default-matrix acceptance and the existing ten-seed broad slice cover compatibility, including whole-second finishes; full broad validation remains a manual command.

Client saving also accounts for asynchronous registration: Session records the start acknowledgement on a monotonic clock and waits only if time since that acknowledgement cannot yet cover the unchanged submitted seconds. Gameplay and restart remain immediate. A real Session/simulation/request-client/in-memory-API regression reproduces the review's 250 ms start / 50 ms finish latency case (13 seconds, 8 squashes, 93 points), then verifies acceptance and board/team credit. It also covers a delayed response, a long pause with no unnecessary wait, and immediate restart during the previous run's pending save. Strict server elapsed validation remains unchanged. The cache-invalidation fixture now primes caches after one gameplay second and finishes 100 ms later; independently removing either invalidation fails the test while moderation-expiry assertions remain intact.

Return validation: `bun run check --test-name-pattern '^(?!Vite serves cards)'` passes TypeScript and **258 tests / 87,446 assertions**. The two existing Vite tests are excluded because they open TCP listeners, which this task's socket-only isolation forbids; the unfiltered check is left to CI. `bun run pacing` (20 cases) and `bun run pacing --broad` (2,000 cases) pass every gate with **zero rejected finishes**. Rule and API regressions reject the 20-second / 120-squash forgery; the API confirms no event, personal best, leaderboard or team credit, then accepts a legal finish on the same run.

## Current correction: issue #30

The fixed broad harness was captured against unchanged combat at `0339ee9`, before tuning. [Complete before report](pacing-validation/issue-30-before.txt) and [complete after report](pacing-validation/issue-30-after.txt) contain all 2,000 cases, acquired builds, grouping summaries and gates. Older evidence below describes issue #21 and remains historical.

### Workload and acceptance

`bun run pacing` keeps its original 20 cases, seeds, evasive steering and first-card idle choices. It still requires idle death by 60 seconds, evasive medians of 60–180 seconds overall and in both shapes, all deaths by 240 seconds and valid scores.

`bun run pacing --broad` (also `bun run pacing -- --broad`) crosses seeds **0–99 × five distinct full priorities × two shapes × idle/evasive**. There are 2,000 cases, including 1,000 evasive cases. The two drone-first priorities remain separate, and laser-first occurs once. Both modes choose the first offered upgrade in the full ordered priority; only movement differs. Default idle still takes the first offered card. Production simulation, arena geometry, seeded offers, fixed step, repulsion steering and 600-second diagnostic horizon are shared and unchanged.

The broad command prints case records plus count, median, maximum and cutoff summaries for each mode overall, mode/shape, mode/priority and mode/priority/shape. Its gates require:

- Overall evasive median **75–110 seconds**, inclusive.
- Each full priority's evasive median **at least 55 seconds**, across both shapes.
- Every idle run actually dead by **60 seconds**; every run actually dead by **240 seconds**.
- Complete, unique mode/priority/shape combinations for every sampled seed, and valid scores for every run.

A cutoff is a survivor, never a death. Missing groups cannot pass. Gates use unrounded elapsed times with a 1e-7-second inclusive-boundary tolerance. Evasive deaths strictly below `60 - 1e-7` count toward the under-60 share, divided by all evasive cases; within-tolerance values are on the boundary. Individual shape medians and this percentage are diagnostics. Any failed gate exits nonzero; unknown or extra arguments fail before running combat.

CI asserts the full default matrix's original target object and runs a real ten-seed broad slice (200 cases), protecting each priority's 55-second floor, idle/death ceilings and scores. Enumeration and independent fixtures cover completeness, separate drone priorities, inclusive boundaries, hidden weak builds, cutoffs, invalid scores, reporting and command status. The full broad acceptance run stays outside `bun run check`. The existing 402-case first-card idle regression remains intact.

The slice also replays seeded offers independently of the harness selector and compares actual acquired builds with their named priorities, including choices that differ from the first card for every priority. Command checks use the production dispatcher and both scenario generators, stubbing only individual scenario execution; this also exercises broad idle callbacks despite idle combat ending before upgrades. These checks enumerate the full workload without adding a full broad combat run to CI. Mutation checks reject first-card/fixed-priority selection, first-card broad idle selection and always-fast/always-broad dispatch; equivalent cloned priority/viewport arrays pass.

### Broad results

All values are gameplay seconds. Each priority has 200 evasive cases; each shape has 500.

| Evasive priority | Before median | After median |
| --- | ---: | ---: |
| shield / drone / bomb / laser | 51.50 | 73.10 |
| drone / bomb / shield / laser | 64.67 | 77.04 |
| bomb / drone / laser / shield | 49.22 | 71.85 |
| laser / shield / drone / bomb | 35.54 | 110.84 |
| drone / laser / bomb / shield | 63.60 | 80.32 |
| **Overall** | **54.85** | **76.73** |

| Group | Median before → after | Maximum before → after |
| --- | ---: | ---: |
| evasive portrait (390×844) | 54.77 → 76.58 | 77.97 → 151.25 |
| evasive landscape (1280×800) | 55.03 → 76.75 | 78.38 → 156.93 |
| idle portrait | 23.82 → 13.89 | 55.25 → 18.97 |
| idle landscape | 23.87 → 13.49 | 42.88 → 17.38 |
| idle overall | 23.82 → 13.63 | 55.25 → 18.97 |
| all runs | 36.02 → 43.35 | 78.38 → 156.93 |

Evasive deaths under 60: **644/1,000 (64.4%) → 0/1,000 (0.0%)**. Cutoffs **0 → 0**; invalid scores **0 → 0**. All final broad gates pass. The final default matrix also passes: evasive median 78.69 seconds (portrait 77.78; landscape 79.60), idle maximum 15.90 and overall maximum 136.87.

### Final combat rules and measured tradeoff

Only the early spawn knots and one-time robot laser benefit change. Spawn intervals interpolate through **(0, 0.2), (20, 4), (30, 4), (60, 0.3), (120, 0.2), (180, 0.18)**. This intentionally starts with a brief base-bug burst, eases through the first upgrade/fast-bug introduction, then returns to the original 60-second pressure. The 60-second point, later knots, exponential tail, fast unlock/cadence and pursuit multiplier are unchanged. The cumulative six-spawns-per-second allowance still holds.

The plan's initial 1.2/1.0/0.9-second opening with a 0.5 laser multiplier produced an evasive median of 68.32 seconds and idle maximum 92.98, failing both gates. Broader easing and longer contact recovery also let idle builds sustain. The final opening concentrates enough early attackers to end idle runs before their first upgrade, while moving players get a quiet window to thin the swarm through weapon kills. This departs from simply increasing all three opening intervals. Idle play ends earlier than before; the acceptance specifically measures moving survival. Contact recovery remains the original one second: no additional recovery rule was needed.

The first laser gives **4× robot firing rate** (1.5 seconds × 0.25 = **0.375 seconds**), alongside two-target piercing. This single benefit is identical for every positive laser pick count. Later picks only increase penetration to `1 + picks`; they never stack firing speed or reset cooldowns. First acquisition clamps remaining robot cooldown to 0.375 seconds, grants no synchronous shot and leaves existing projectiles unchanged. The shared multiplier drives combat and the first card's text; repeat cards describe their additional penetration. Drones retain their independent 1.5-second cadence and shared penetration benefit.

Three-hit health, persistent contact attackers, no contact scoring/removal, shield refill cap, bomb recharge/repick rules, choice pauses, upgrade counts, finish payloads and server plausibility rules are unchanged. Deterministic tests exercise actual firing counts, cooldown acquisition, non-stacking, unchanged drones/projectiles, late spawn/pursuit values and cumulative spawn limits.

`bun run check`: TypeScript and **200 tests / 86,489 assertions** pass. `bun run build`, default pacing and full broad pacing pass. The coverage repair reproduces the committed full broad after report exactly; combat and rendering are unchanged, so the recorded Chrome evidence below still applies.

### Fresh Chrome evidence

2026-11-19: factory Windows 11 Home 10.0.26200, AMD Ryzen 9 7950X3D (32 logical CPUs), RTX 3090 host; headless **Chrome for Testing 159.0.8154.6**. Viewport 1280×720, device/render DPR 1, world 800×450. All four existing benchmark profiles ran sequentially, each with a **10-second warmup and 60-second real RAF sample** (3,600 intervals). Checks, downloads and browser interaction completed outside sampling. [Raw reports](pacing-validation/issue-30-benchmark.json) retain every sample, population bounds, counters, update/draw/fixture timings and browser metadata.

| Profile | Mean / lowest rolling FPS | Update mean / p95 ms | Draw mean / p95 ms | Fast bugs min–max |
| --- | ---: | ---: | ---: | ---: |
| normal | 59.999 / 59.988 | 0.040 / 0.100 | 0.652 / 1.200 | 32–39 |
| first | 59.999 / 59.988 | 0.048 / 0.100 | 0.698 / 1.200 | 27–42 |
| stress + burst | 59.999 / 59.988 | 0.089 / 0.200 | 1.168 / 2.200 | 23–43 |
| double + late | 59.999 / 59.988 | 0.042 / 0.100 | 0.716 / 1.200 | 31–41 |

**All four pass 58 FPS** in both mean and lowest rolling rate, with exactly **150 bugs at every draw**, no browser errors and no failed measured samples. Stress/burst reaches the fixed 1,024-particle and 256-label caps. The laser changes firing workload without adding a per-frame allocation structure. Its highest measured update p95 is 0.200 ms and draw p95 2.200 ms in stress/burst. The earlier historical failed Chrome 157 sample remains below under its original filename.

This run used scratch homes/profiles/data and intercepted browser requests: the unchanged production benchmark entry was bundled with Bun and delivered to Chrome without a listening server, API or database. Installed Chrome refused remote debugging before any sample started; a separate scratch Chrome for Testing install completed all samples. Reproduce the existing fixture's protocol via [look-validation.md](look-validation.md#repeat-the-measurement), using normal, `?profile=first`, `?profile=stress&burst` and `?profile=double&late`, keeping checks and interaction separate from timed samples.

[Card assertions](pacing-validation/issue-30-browser.json) and screenshots cover the production build at **390×844** ([first](pacing-validation/issue-30-cards-390-first.png), [repeat](pacing-validation/issue-30-cards-390-repeat.png)) and **1280×800** ([first](pacing-validation/issue-30-cards-1280-first.png), [repeat](pacing-validation/issue-30-cards-1280-repeat.png)). Explicit fixture offers isolate text/layout/selection from scheduling. First laser text states two-target piercing plus 4× robot firing; repeat text states three-target piercing. All text fits inside cards and all cards fit inside the viewport, without horizontal overflow. Portrait cards are 306×100–104 px; landscape cards are 278×150 px. Touch in portrait and fresh key 1 in landscape each select first/repeat laser, increment picks, close the dialog and restore canvas focus. There are no page/console errors. All browser contexts and processes were closed after validation. These are factory Chrome measurements, not human playtest evidence.

## Historical issue #21 validation

The following sections and their original raw filenames record the previous correction. Their constants and measurements describe that historical change, rather than the current issue #30 balance above.

Validation compares baseline `032ed1c` with this change. The permanent harness was run before changing combat, then kept fixed during tuning. [Before](pacing-validation/before.txt) and [after](pacing-validation/after.txt) retain every case's seconds, death/cutoff status, score, priority and acquired build.

### Reproduce the acceptance check

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

### Before and after

All times below are gameplay seconds. `≥600` denotes a survivor at the horizon. The baseline had eight idle failures and three cutoff survivors; the final run has neither.

| Mode | Viewport | Seed | Before | After |
| --- | --- | ---: | ---: | ---: |
| idle | 390×844 | 1 | 81.62 | 20.85 |
| idle | 390×844 | 42 | 64.48 | 35.98 |
| idle | 390×844 | 12345 | 65.77 | 37.33 |
| idle | 390×844 | 7 | 67.75 | 22.55 |
| idle | 390×844 | 99 | 49.82 | 22.68 |
| idle | 1280×800 | 1 | 75.17 | 20.43 |
| idle | 1280×800 | 42 | 66.87 | 35.23 |
| idle | 1280×800 | 12345 | 84.55 | 36.67 |
| idle | 1280×800 | 7 | 69.57 | 26.13 |
| idle | 1280×800 | 99 | 57.40 | 19.97 |
| evasive | 390×844 | 1 | 115.47 | 61.87 |
| evasive | 390×844 | 42 | ≥600 | 63.02 |
| evasive | 390×844 | 12345 | ≥600 | 39.50 |
| evasive | 390×844 | 7 | 71.42 | 36.80 |
| evasive | 390×844 | 99 | 138.68 | 69.37 |
| evasive | 1280×800 | 1 | 98.27 | 64.40 |
| evasive | 1280×800 | 42 | 134.08 | 63.02 |
| evasive | 1280×800 | 12345 | ≥600 | 60.12 |
| evasive | 1280×800 | 7 | 67.48 | 36.38 |
| evasive | 1280×800 | 99 | 127.72 | 61.95 |

| Group | Median before → after | Longest before → after | Cutoffs before → after |
| --- | ---: | ---: | ---: |
| idle portrait | 65.77 → 22.68 | 81.62 → 37.33 | 0 → 0 |
| idle landscape | 69.57 → 26.13 | 84.55 → 36.67 | 0 → 0 |
| idle combined | 67.31 → 24.41 | 84.55 → 37.33 | 0 → 0 |
| evasive portrait | 138.68 → 61.87 | ≥600 → 69.37 | 2 → 0 |
| evasive landscape | 127.72 → 61.95 | ≥600 → 64.40 | 1 → 0 |
| evasive combined | 130.90 → 61.91 | ≥600 → 69.37 | 3 → 0 |
| all | 78.39 → 36.73 | ≥600 → 69.37 | 3 → 0 |

PASS: all ten idle players actually died by 60 seconds. PASS: evasive medians in both viewports and combined are 60–180 seconds. PASS: all 20 runs actually died by 240 seconds. PASS: every result passes `parseFinish` and `plausible` using its acquired upgrades and exact simulated elapsed time, without extra wall-clock pause; squashes never exceed spawned bugs.

The baseline raw log conservatively prefixes medians with `≥` whenever the group contains a cutoff. Its medians above are exact: all central order statistics are completed deaths, below every censored time. The final reporter only prefixes medians when censoring affects a central order statistic.

### Final rules and tuning

- Shield refills to `min(picks, 4)`, with no healing or accumulated charges. First/second picks grant one/two charges; two further picks grow capacity to four, then picks refill spent charges at that cap. Pick counts remain independent of resources and retain the existing finish format.
- Bomb must be acquired. Acquisition arms the first clear; subsequent picks recalculate from the last detonation without an extra explosion. Recharge is `15 + 15/picks` seconds: 30, 22.5, 20, 18.75, … approaching 15. It waits for bugs when armed, pauses with choices and scores ten per victim, as do drones and robot shots.
- Spawn intervals linearly interpolate through `(0,0.9), (20,0.8), (30,0.7), (60,0.3), (120,0.2), (180,0.18)` in gameplay seconds. Thereafter use `1/6 + (0.18 - 1/6)*exp(-(time - 180)/60)`. Intervals never fall below 1/6 second, preserving the server's six-squashes-per-second cumulative allowance. Scheduled overshoot, fast unlock at 30 seconds and every-fourth fast cadence remain intact.
- Both bug kinds multiply movement speed by `1 + max(0,time - 45)/45 + (max(0,time - 90)/45)^2`. This applies to existing and newly spawned bugs and preserves the fast/base speed ratio. Pressure continues growing past 120 seconds; death still comes from contacts. There is no forced ending or time damage.
- Drones still add one firing drone per pick; laser picks still increase projectile penetration. First and repeated shield/bomb benefits share their formulas with card descriptions.
- Robot and drone firing cadence is 1.5 gameplay seconds. First and repeated drone picks still add an immediately ready firing drone. This reduces automatic sustain while preserving the added drone and laser penetration benefits.
- Contacts never remove attackers. A damaging contact still costs one shield charge or health and grants the same one-second immunity; further contacts during immunity do not damage or clear bugs. Attackers remain until a weapon kills them, and moving away prevents repeated hits. Only projectile/bomb kills score squashes.

The first delivery passed the prescribed 20 cases but did not generalize: seed 5 survived 67.70/64.88 seconds, and a 400-case probe found 73 idle failures, reaching 84.98 seconds. Stronger spawn pressure alone shortened evasive runs too far. The previous correction combined a slightly earlier first spawn, the shorter 60-second spawn interval, pursuit growth starting at 50 seconds, and slower automatic fire. Seeds, steering, offers, scoring and acceptance limits remain unchanged.

The prior repair's tuning passed **100,000 idle runs**: seeds 0–24,999 and `Math.imul(i + 1, 0x9e3779b9) >>> 0` for i=0–24,999, each in both required shapes. All actually died within 60 seconds, all scores were valid, and the longest was **59.40 seconds**. [Repair-check results](pacing-validation/repair-checks.json) retain the sample definition and mutation outcomes. This is a wider deterministic sample, not a proof over every 32-bit seed.

That sample was insufficient: the next review reproduced seed 29514 surviving 71.82 seconds in portrait after drone picks at 20/40 seconds and a bomb at 60. The correction removes the underlying passive clear: damaging and immune contacts used to delete approaching bugs without consuming weapon fire. Attackers now persist, so standing still cannot exchange damage/immunity for free crowd control. A seed-independent combat test verifies that the same surviving attacker can deal all three hits across immunity windows. Shield and feedback probes retain their protection/scoring coverage without assuming contact destroys bugs.

The reproducer now ends at **20.33 seconds**, confirmed by both the harness and a direct production-simulation loop. The 30-second spawn interval is gentler (0.7s) to retain moving survival time, while linear pursuit starts at 45 seconds with a 45-second scale. Firing cadence and upgrade effects are unchanged from the returned commit. An additional **1,000,000-case** idle sweep covers i=0–249,999, both seeds `i` and `Math.imul(i + 1, 0x9e3779b9) >>> 0`, and both required shapes: zero survivors/score failures/60-second failures, longest **59.27 seconds**. [Contact-repair evidence](pacing-validation/contact-repair-checks.json) retains the reproducer, sample definition, worst case, source hashes and mutation outcomes. This sample supports the contact-rule regression; it is not proof over every possible seed.

### Broader build diagnostic and regression

The exported `runScenario` also exercised all 24 permutations of the four upgrade priorities over all five seeds and both shapes (240 evasive runs). Twenty further runs alternate preferred drone/bomb or shield/bomb by choice number, starting with drone or shield. If the preferred card is missing, select the other member of the pair, then fall back to registry order. All use the same production offers, movement, fixed step and 600-second horizon. Across these 260 runs: median **46.10 seconds**, longest **77.18 seconds**, zero cutoffs, zero runs over 240 seconds, and all scores pass server validation.

The diagnostic is reproducible with `runScenario`, `SCENARIOS` and `VIEWPORTS` from `scripts/pacing.ts`: enumerate each permutation, seed and viewport with mode `evasive`; supply the alternating choice function as the optional third argument. These finite policies are regression evidence, not proof against every possible steering strategy.

`scripts/pacing.test.ts` replays seeds 1 and 42 in both modes and shapes, asserting actual death, idle ≤60, all ≤240, deterministic results, valid scoring and exact acquired-pick totals. It also checks first-card idle choices, priority fallback, choice pause/resume time, evasion math and cutoff rejection. Focused combat tests cover shield cap/refill/no healing, first/second/high-count bomb cooldowns, no pre-acquisition or repeat-pick free clears, paused recharge, unchanged scoring, late spawn growth, late movement of both kinds and the cumulative spawn bound through 600 seconds. The obsolete no-upgrade duration fixtures were replaced by upgrade-enabled acceptance coverage; collision, movement, targeting, score and rendering coverage remain.

The prior return-check repairs added a separate 400-case idle regression (seeds 0–99 plus the same 100-value spread, including seed 5), a default-matrix contract, independent odd/even median and maximum fixtures, vertical/off-centre steering checks and live scheduled-spawn counts through 300 seconds. Deliberately reducing the matrix, dropping shield-first priority, substituting mean/minimum summaries, removing either vertical steering term or clamping the live spawn curve at 120 seconds each fails its corresponding test. The wording-sensitive card test was removed; combat and App tests retain effect and presentation coverage. The duplicate paused-step frozen-state assertion was removed while actual choice resolution remains tested. The server finish-validation fixture now protects its first three scheduled choices so early combat deaths cannot remove upgraded payload coverage; the pacing harness has no such protection.

The latest repair adds seed 29514 in both shapes (402 idle regression cases total) and independently specified `targets()` fixtures: inclusive 60/180-second median limits, idle death at 60 versus 61, a 240 versus 241-second outlier with valid medians, invalid 59/181-second medians overall and in either viewport while the combined median is valid, missing groups, and rejected score validation. Widening either ceiling, changing the median conjunction to a disjunction, disabling score validation, or restoring passive contact clears is rejected by the corresponding test. No output wording is asserted.

### Chrome validation

Chrome uses a scratch profile/home/data directory and a Vite-only server started for this task; API requests in the UI fixture are intercepted, and no database is opened. First, second and capped refill cards were inspected and selected by touch at 390×844 and 1280×800. All card bounds fit the viewport with no horizontal overflow and targets at least 44 px. The production renderer shows one/two shield outlines, one/two drones, piercing streaks and the bomb ring after first/repeated picks in both shapes. [Browser assertions](pacing-validation/browser.json) include card text/bounds and effect state.

Screenshots: [capped portrait cards](pacing-validation/cards-390-4.png), [second-pick landscape cards](pacing-validation/cards-1280-1.png), [repeated effects in portrait](pacing-validation/effects-390-double.png), [repeated effects in landscape](pacing-validation/effects-1280-double.png).

Performance follows [look-validation.md](look-validation.md): 150 bugs at every draw, 10 seconds of warmup and 60 seconds of real RAF sampling, sequential profiles, no concurrent project checks or interaction tests. The late sample starts at 180 gameplay seconds, so its sampled pursuit speeds cover approximately 190–250 seconds. Per-frame balance cost is a single speed-multiplier calculation per active step plus one multiply per bug; the exponential spawn tail is evaluated only at scheduled spawns.

The following Chrome 157 measurements belong to the previous repair at `f040c9b`; they remain recorded, including the failed rolling-FPS sample. Factory environment: Windows 11 Home 10.0.26200, AMD Ryzen 9 7950X3D desktop, headless installed Chrome 157.0.8103.51, viewport 1280×720, device/render DPR 1. Every sample recorded about 3,600 RAF intervals over approximately 60 seconds. [Raw benchmark reports](pacing-validation/benchmark.json) retain population bounds, activity counters, pool peaks and browser metadata.

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

#### Contact-pressure correction: fresh Chrome evidence

The current correction was measured separately in headless Chrome for Testing **159.0.8154.6** on the same Windows/Ryzen factory desktop, with a scratch home/profile and an owned Vite-only server. The same viewport 1280×720, DPR 1, 150-bug fixture, sequential profiles, 10-second warmup and 60-second real RAF sampling protocol apply. No project checks or interaction workload ran concurrently. The robot, both bug kinds, first/repeated upgrades and contact effects use the production code; only fixture replenishment/durability keep the benchmark alive. [Fresh raw reports](pacing-validation/contact-benchmark.json) retain all samples.

| Profile | Mean / lowest rolling FPS | Update mean / p95 ms | Draw mean / p95 ms | Fixture mean / p95 ms |
| --- | ---: | ---: | ---: | ---: |
| normal | 59.999 / 59.994 | 0.051 / 0.200 | 0.756 / 1.300 | 0.003 / 0.000 |
| double | 59.999 / 59.994 | 0.063 / 0.200 | 0.754 / 1.200 | 0.003 / 0.000 |
| stress + burst | 59.999 / 59.992 | 0.077 / 0.200 | 1.052 / 1.800 | 0.005 / 0.000 |
| double + late | 59.999 / 59.988 | 0.050 / 0.100 | 0.699 / 1.200 | 0.003 / 0.000 |

All four fresh samples passed the 58 FPS criterion in both mean and lowest rolling rate, with exactly 150 bugs at every sampled draw and no browser errors. The contact loop removes the old compaction writes and adds no allocation or per-frame machinery. Cards and first/repeated upgrade effects were inspected at both 390×844 and 1280×800; touch selections applied the displayed charges, with no overflow or click-through. Chrome and Vite were stopped afterward. These fresh measurements do not erase the earlier recorded Chrome 157 stress dip.

`bun run pacing` passes all targets; `bun run check` passes TypeScript and 187 tests (86,289 assertions); `bun run build` passes. These are factory desktop measurements under the owner's ruling, with no physical-device evidence requested.

The branch incorporates current `main` at `2b326d6` so the draft remains mergeable with teams, capacity tooling and the livestream board. Conflicts were confined to command/documentation additions; both sets were retained. Production simulation, pacing and benchmark/renderer sources are unchanged by this integration, so the recorded simulation/performance evidence still applies. The full check, build and pacing command were rerun after the merge; Chrome card selection and first/repeated effects were rechecked through the new team-entry flow in both shapes. The earlier contact-repair artifact's 144-test count describes the pre-merge run.

The PRD's five human runs remain the Phase 2 release validation; this deterministic/browser evidence does not replace them.
