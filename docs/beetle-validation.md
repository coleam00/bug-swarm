# Beetle validation — issue 83

The beetle keeps the planned starting values: five HP, 60 base points, radius 22,
84 units/s, 90 degrees/s steering and an inclusive +/-60 degree front shell.
It unlocks at wave 5 with a constant 10% uncapped selection share and a ten-live
limit. Capped selections become crawlers without changing spawn pressure or
the dasher share. No game numbers, seeds, fairness coverage or thresholds were
changed during validation.

Armour is evaluated at the earliest swept contact using the authoritative facing
held for that 50 ms interval. A bounce consumes one projectile and resets only
its owner's accuracy streak; HP, score and kills stay unchanged. A fresh shooter
earns 90 points on the fifth uninterrupted damaging hit (60 base times 1.5).
Cracks show lost HP without weakening the guarded sector. The existing delayed
combat clock owns cracks, facing, projectile removal and the pale shell spark.

Aimer prefers interceptable exposed targets and otherwise approaches an
85-unit orbit. It retains the tangent with more edge clearance, compensates for
target velocity, and reserves 65 units of separation from the selected beetle.
Other bugs retain normal avoidance; nearest danger still governs rescue safety.
The policy uses observed facing with a 0.12-radian safety margin. Mover is unchanged.

## Reproduce

Run `bun run check`, `bun run skill`, `bun run build`, then
`bun scripts/validate-beetle.ts`. The Chrome driver owns ephemeral loopback
servers, isolated browser contexts, scratch homes, profiles and SQLite data.
Set `TEMP`, `TMP` and home/config/cache environment variables under
`.evidence/83/` before check/skill as well, so tests' temporary directories remain
inside the checkout. `CHROME_PATH` can select an installed Chrome executable.

The driver first runs two browser identities with 18 aimers for 180 seconds and
requires a naturally spawned wave-5 beetle. It then sets up controlled scenes
on its own in-process arena: browser keyboard/mouse inputs produce the bounce,
move the shooter around the beetle, and fire the exposed lethal shot while a
teammate draws its facing. This uses ordinary simulation, sockets, authoritative
snapshots and delayed rendering; it adds no debug endpoint. Both phone layouts
also exercise two simultaneous touch points.

The separate renderer fixture contains 20 players, 150 bugs including ten visible
beetles across all five HP states, 140 shots and a bounded mixed hit/kill/bounce
effect pool. The beetles sit inside all three camera layouts. Load validation
extends to 240 seconds so the final complete minute is entirely after every
arena unlocks wave 5, rather than assuming 120 wall-clock seconds equals 120
simulation seconds. Processes, sockets and database handles close after each run.

## Automated coverage

Deterministic tests cover nearest-active targeting and id ties, forward speed,
shortest-angle wrapping, the half-turn tie and one 4.5-degree turn per actual
step. Combat tests cover inclusive armour boundaries and adjacent angles,
off-centre and moving contacts, wall stops, a shooter moving after firing,
consumed blocking ahead of another victim, surviving damage, fifth-hit scoring,
the multiplier cap and contested lethal attribution. Coincident contacts use
the inverse shot direction, shell sparks clamp at world bounds, and a bounce
leaves the other player's streak unchanged.

Spawn tests exercise waves 4/5/8/late, probability boundaries, deterministic
placement, nine-to-ten admission, repeated capped choices, renewed eligibility
and the global cap. JSON/keyframe/delta tests cover HP and motion validation,
bounce validation, removals and missed-base recovery. The maximum phased-dasher
fixture remains, with an additional mixed payload at all collection bounds
below 64 KiB. Two real clients negotiate JSON and binary transport and receive
matching beetle identities and bounce events. Combat and scoring expectations
remain in the pure simulation tests. Renderer tests cover shell orientation,
successive cracks, pale sparks without score labels, delayed onset/removal,
deduplication and reset. Policy tests include solo and teammate flank kills and
retain the dasher-dodge and rescue regressions.

## Results on the factory machine (2026-11-21)

The original delivery's `bun run check` passed: 434 tests, 28,952 assertions,
no failures, and TypeScript passed. Focused combat/steering/spawn/policy, JSON/binary integration and renderer
runs also passed. `bun run build` produced production assets successfully.
Check output and the recorded exit code are in
`.evidence/83/check-final.{stdout,stderr}.log` and `check-final-exit.json`.

Production Chrome 157.0.8103.51 used separate desktop and phone storage contexts.
The successful production run is `.evidence/83/production-cCg34W/`: natural
spawning was observed at wave 5, tick 2421, during the two-browser/18-aimer
180-second run. `report.json` retains snapshots proving unchanged five HP and
streak zero after the front bounce, then a 90-point flank kill and removal.
Inspected captures include `front-bounce.png`, `flank-kill.png`,
`shell-damage-states.png`, `shell-hp-*.png`, `touch-390x844.png` and
`touch-844x390.png`. Both touch layouts sent movement and fire together, fit the
viewport and reported no browser errors.

The corrected full-arena benchmark is in `.evidence/83/production-CnJour/`.
Chrome used its normal GPU path (factory NVIDIA GeForce RTX 3090; accelerated
canvas/compositing/rasterization recorded in `report.json`). All four samples
per scenario reported **60.0 FPS**:

| Scenario | Canvas | Update + draw per frame |
| --- | --- | --- |
| Mixed combat, ten visible beetles | 1280 x 800 | 1.105–1.138 ms |
| Mixed combat, ten visible beetles | 390 x 844 | 1.020–1.037 ms |
| Mixed combat, ten visible beetles | 844 x 390 | 0.832–1.065 ms |
| Rescue overlay and mixed combat | 1280 x 800 | 0.888–1.040 ms |
| Rescue overlay and mixed combat | 390 x 844 | 0.742–0.933 ms |
| Rescue overlay and mixed combat | 844 x 390 | 0.807–0.918 ms |

These meet the 60 FPS / 16.67 ms target on factory Chrome, including phone
emulation. An auxiliary run forced `--disable-gpu` and recorded 54.1–59.0 FPS
on desktop; the final driver lets Chrome use the machine's ordinary GPU path.
The fixture was corrected to keep all ten beetles visible before the final
measurements, rather than measuring their culling.

The initial 200-aimer / 180-second production run maintained exactly 200
connections across ten arenas, reported zero errors/drops, and reached ten
live beetles per arena. Whole-run tick p50/p95 was **1.018/1.869 ms** (maximum
12.185 ms). Snapshot payload p50/p95/max was 1,743/2,354/7,771 bytes per
recipient tick; the highest per-player average was 36,244 bytes/s, below the
40,000-byte budget. Its full report is in `production-cCg34W/report.json`.

The extended CLI run (`bun run bots -- --url <owned-origin> --count 200
--seconds 240 --policy aimer`) also exited zero, with exactly 200 connections,
zero errors/drops and a ten-beetle maximum. All ten arenas were at waves 6–8
throughout the final complete minute. Whole-run tick p50/p95/max was
**1.039/2.118/6.631 ms**; the post-unlock minute had 11,758 samples and
**1.040/1.969/6.436 ms**. Its payload p50/p95/max was 1,760/2,480/7,152 bytes;
the highest per-player average was 36,967 bytes/s. The CLI output, raw tick
samples, population, wave/beetle observations and bandwidth counters are in
`.evidence/83/load-41Y6SW/{cli.json,report.json}`. Both whole-run and post-unlock
tick p95 are below 10 ms.

`bun run skill` completed with exit zero. Across the unchanged 20 seeds, eight
bots and 180 seconds per policy, pooled life medians (including horizon cutoffs)
were:

| Policy | Score | Survival | Lives | Deaths | Cutoffs |
| --- | --- | --- | --- | --- | --- |
| mover | 238.5 | 84.65 s | 306 | 146 | 160 |
| aimer | 3,933 | 111.05 s | 267 | 107 | 160 |

The score ratio is **16.49x**, above the required 2x, with both medians positive.
The complete newcomer matrix also passed, using the initial 600-second horizon:

| Newcomer cohort | Median first-life survival | Deaths / cutoffs |
| --- | --- | --- |
| Fresh aimer with eight incumbents | 309.975 s | 16 / 4 |
| Eight-minute aimer with eight incumbents | 387.000 s | 13 / 7 |
| Idle with eight incumbents, every 15-second age 0–900 | 21.450–37.000 s | 20 / 0 at every age |
| Solo idle, fresh | 22.225 s | 20 / 0 |
| Solo idle, eight minutes | 22.275 s | 20 / 0 |

Both aimer newcomer medians are exact despite the censored tails. Late survival
is **124.85%** of fresh survival, above 80%. All 61 incumbent idle cohorts and
both solo controls have exact medians above 10 seconds; the lowest is 21.450
seconds at arena age 180. `.evidence/83/skill.json` retains all 65 cohort
summaries, all **1,300 individual newcomer observations and censoring flags**,
per-seed policy results and tuning constants. `skill-exit.json` records the
process exit code. No seeds, coverage, thresholds or mover behavior were changed.

## Review follow-up

The existing movement test now checks literal 84-unit/s speed and 4.2-unit
step displacement, nearest targets in both insertion orders and lower-id ties
with the winning player inserted last. The renderer test checks transformed
body/shell size and identifies shell, cracks and effects through geometry rather
than exact palette strings. The real-server test is limited to matching JSON
and binary beetle/bounce transport; combat rules stay in the pure simulation.

All 52 focused tests passed, followed by `bun run check`: **434 tests, 28,969
assertions**, TypeScript clean, exit zero. Eight mutation probes confirmed that
speed, first/last-player targeting, turn rate, half-size rendering and scoring
regressions fail their intended simulation/render tests. An equivalent shell
color passes; changing points also passes the reduced wire test while failing
the pure scoring test. Logs and results are in `.evidence/83/recheck/`.
Production code is unchanged, so the original skill, Chrome and load evidence
above is retained without rerunning those separate acceptance commands.

### Effective paint visibility

The renderer guard now multiplies `globalAlpha` by CSS paint-color alpha for the
body, shell fill/rim, every damage crack and the early bounce spark. It retains
geometry-based identification, transformed-size checks and palette tolerance.
Sixteen mutation probes reject transparent paints individually and together,
zero global alpha, insufficient combined opacity, half-size drawing, incorrect
facing and missing cracks; equivalent hex and opaque RGBA palettes pass.
All production files were restored after the probes.

All 52 focused tests passed, followed by `bun run check`: **434 tests, 28,996
assertions**, TypeScript clean, exit zero. Logs, mutation results and the exit
code are in `.evidence/83/visibility/`. This remains a test-only repair; the
original issue-83 skill, Chrome and load evidence above is unchanged.
