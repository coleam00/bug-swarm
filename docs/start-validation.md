# Start screen validation (issue #58)

Entry now shows Bug Swarm, “Survive the swarm.”, three procedural beetles and a robot, one name field and the orange/teal Join buttons. A valid saved identity shows its name, team and Play. Valid legacy identities keep their name and UUID while choosing a team. No change-name feature was added.

`StartScreen` owns draft input, attempted-entry feedback and touch attribution. Each route owns persistence and game activation. The component imports its own CSS and has no Session, engine, simulation or arena dependency. `/arena` has no dedicated client in this checkout; its eventual caller can use the same component. The drawing helpers and glow cache are shared with the current renderer.

## Chrome evidence

Factory Windows desktop, headless Chrome for Testing **155.0.8059.84**, Playwright Core 1.65.1. The production build is served entirely through interception; every API request is intercepted too. No application listener or database is opened. Chrome uses a fresh profile and home under scratch. The installed Chrome channel refused debugging, so the probe used the available Chrome for Testing executable. Phone layouts use touch emulation and DPR 2; desktop uses DPR 1. These are factory Chrome measurements, not physical-device measurements.

| Viewport (CSS px) | First entry | Attempted error | Returning player |
| --- | --- | --- | --- |
| 1280 x 720 | [Screenshot](start-evidence/first-1280x720.png) | [Screenshot](start-evidence/error-1280x720.png) | [Screenshot](start-evidence/returning-1280x720.png) |
| 390 x 844 | [Screenshot](start-evidence/first-390x844.png) | [Screenshot](start-evidence/error-390x844.png) | [Screenshot](start-evidence/returning-390x844.png) |
| 844 x 390 | [Screenshot](start-evidence/first-844x390.png) | [Screenshot](start-evidence/error-844x390.png) | [Screenshot](start-evidence/returning-844x390.png) |

The [browser report](start-evidence/browser.json) records control bounds and decorative frame cost. All inputs/buttons are 60 CSS px high and at least 44 px wide. Controls and the attempted-error message fit the three viewports without horizontal overflow. Screenshots were inspected for title hierarchy, readable labels, team colours, scene proportions and unclipped controls.

The probe checks pristine copy, one short error after an empty attempt, clearing on edit, trimmed retry, Enter focusing Join Tabs without starting, Tab to Spaces, keyboard activation, both teams, touch Join/Play, saved UUID continuity, rotation preserving the draft, reduced motion and cancellation of every decorative frame after joining. Entry sends zero run requests and leaves the hint flag alone; Join and Play each send one request.

Adjacent React tests cover format/moderation feedback, accepted punctuation and moderation exceptions, legacy entry, storage failure, offline play, hint eligibility, authoritative team recovery and replay. Canvas fixtures cover resize/DPR, hidden-page pause/resume, reduced-motion changes, effect setup/cleanup replay and released backing stores. Existing renderer tests retain the robot visibility, gait, ordering and cache-lifetime checks. The server rules and routing are unchanged.

Validation passed: `bun run check` (489 tests across 41 files; 103,210 assertions), `bun run build`, and the Chrome layout/interaction and before/after performance probes. `git diff --check` is clean.

## Performance

The [performance report](start-evidence/performance.json) compares the original renderer from `c6d6a67` with the shared drawing helpers using the existing `scripts/look-benchmark.ts` fixture, `?profile=stress&burst`: 150 mixed beetles, nine drones, four of every other upgrade, saturated particles and grouped score labels. Each case has ten seconds of warmup and a separate sixty-second sample. Cases run sequentially without project checks or another benchmark running.

| Renderer | Viewport / DPR | Mean FPS | Draw mean / p95 (ms) | Update p95 (ms) |
| --- | --- | ---: | ---: | ---: |
| Original | 1280 x 720 / 1 | 59.999 | 1.101 / 1.900 | 0.200 |
| Original | 390 x 844 / 2 | 59.999 | 1.236 / 2.000 | 0.200 |
| Shared helpers | 1280 x 720 / 1 | 59.999 | 1.166 / 2.000 | 0.200 |
| Shared helpers | 390 x 844 / 2 | 59.999 | 1.040 / 1.800 | 0.200 |

All four samples kept exactly 150 bugs at every draw and about 60 FPS, with the unchanged fixed cache/pool limits. Desktop draw p95 changed from 1.9 to 2.0 ms; phone draw p95 changed from 2.0 to 1.8 ms. These samples show no material frame-budget regression, not a guaranteed speedup.

The decorative callback measured 0.166 / 0.300 ms mean/p95 at 1280 x 720, 0.162 / 0.300 ms at 390 x 844, and 0.181 / 0.400 ms at 844 x 390. Every pending entry frame was cancelled on joining.

Server tick p95 is not applicable: this change is client-only, and this checkout has no arena server or `bun run bots` command. The benchmark exercises the current production game; it cannot claim a measurement of the future 20-player arena.

## Reproduce

Install project dependencies with `bun install --frozen-lockfile`. Create an isolated scratch directory with its own `package.json`; from that directory run `bun add playwright-core`. Set `SCRATCH` to its absolute path and create its `home` directory. Set `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `DATA_DIR` to locations under scratch for commands that run project software. Set `CHROME` to an available Chrome for Testing executable if the installed channel cannot enable debugging. Browser profiles are generated below scratch automatically.

From the checkout, with Node 22.18+ and Bun on PATH:

```text
bun run check
bun run build
node --experimental-strip-types docs/start-validation.probe.ts
node --experimental-strip-types docs/start-validation.probe.ts --performance
```

The probe closes every context and browser on success or failure. Browser tooling stays outside application dependencies. Existing steering, team, share and landscape probes now press Play on returning entry; the touch probe checks the short tagline instead of the removed instructions.
