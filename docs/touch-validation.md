# Floating touch joystick validation

Issue #36 replaces finger-target steering with a fixed-origin floating joystick. The first accepted touch owns steering until release. Its origin and drag are canvas-local CSS pixels: 6 px radial dead zone, half speed at 33 px, full speed at 60 px, and a knob clamped radially to 60 px. The renderer adds one stroked circle and one filled circle after restoring world scale, clip and shake. Input changes only on pointer events; there are no new frame allocations, caches, assets or React updates for the overlay.

## Correctness and layout

`bun install --frozen-lockfile`, `bun run check` (222 tests, 87,011 assertions), default `bun run pacing`, and `bun run build` passed. Pacing kept its existing portrait/landscape evasive medians of 77.78 / 79.60 seconds, with zero score failures. Combat tuning, score rules and pacing thresholds are unchanged.

- Pure input tests cover fixed origins, all directions, dead-zone boundaries, half/full speed, radial clamping, return to centre, exclusive ownership and no takeover through moves.
- Simulation tests cover explicit speed fractions, clamping, stationary zero speed despite a target, full-speed default vectors (including small scripted vectors), diagonal normalization, mouse stopping and bounds.
- Engine tests exercise actual pointer-to-simulation wiring, stale mouse suppression, keyboard priority and opposing keys, non-owner events, outside-canvas capture, release/cancel/lost capture, blur, visibility, resize, run replacement, both choice transitions, death, fresh restart and unmount. Held-key restart protection and post-death effects remain covered by existing tests. Capture release dispatches a lost-capture event in the fixture to check reentrancy.
- Renderer tests assert visible ring/knob geometry at DPR 1 and 2 across different world scales, independence from shake, stationary touchdown, disappearance without an active touch and balanced canvas state.

Chrome for Testing 156.0.8078.4 on the Windows factory machine passed actual CDP touch sequences at **390×844 and 844×390 CSS px, DPR 2**, plus mouse, WASD and arrow diagonals in a separate **1280×720, DPR 1** desktop context. Each mobile shape starts a fresh run; a separate rotation check confirms cancellation while preserving the current arena. Upgrade selection and a game-over tap restart resume stationary; a subsequent touch moves only after dragging. The direct canvas touch-down restart is also covered by the engine regression. No uncaught page errors occurred.

The probe serves the built application through Playwright interception, mocks API responses and uses scratch browser home/profile/data paths. It starts no network listener or database and contacts no existing server. The fixture disables spawns and temporarily places two bugs for the control screenshots. The thumb stays away from the robot and those bugs. Evidence:

- [Portrait controls](touch-evidence/portrait-joystick.png) and [landscape controls](touch-evidence/landscape-joystick.png).
- [Portrait hint](touch-evidence/portrait-hint.png), [landscape hint](touch-evidence/landscape-hint.png) and [upgrade choice](touch-evidence/upgrade.png). The entry screen scrolls vertically in landscape; neither orientation overflows horizontally.
- [Browser assertions and actual pointer events](touch-evidence/browser.json).

## Frame budget

The developer fixture accepts `?profile=stress&joystick`; omitting `joystick` leaves the overlay off. It reports the flag and passes a reusable active joystick directly to the production renderer. Both cases retain the existing stress upgrades, continuous movement, forced contacts, firing and 150-bug replenishment. The overlay does not change simulation input or the swarm workload.

Measurements use the same Chrome instance sequentially at **1280×720 CSS px, DPR 1**, with **10 seconds warmup and 60 seconds sampling per case**, after project checks finish. No other project checks or benchmark run during sampling. Raw timings and environment are saved in [performance.json](touch-evidence/performance.json), with [off](touch-evidence/stress-off.png) and [on](touch-evidence/stress-on.png) screenshots. These factory desktop measurements are the owner-approved evidence, not a prediction of physical phone throughput.

Recorded 2026-11-20 UTC, Chrome for Testing 156.0.8078.4 on Windows, 800×450 logical world:

| Overlay | Mean / lowest rolling FPS | Bugs (min–max) | Fast bugs (min–max) | Update mean / p95 (ms) | Draw mean / p95 (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Off | 59.999 / 59.988 | 150–150 | 20–42 | 0.099 / 0.200 | 1.046 / 1.700 |
| On | 59.999 / 59.988 | 150–150 | 22–38 | 0.109 / 0.200 | 1.114 / 1.900 |

Both samples contain 3,600 frame intervals over 60.001 seconds and exceed the unchanged **58 FPS floor**. The observed added draw cost is **0.068 ms mean / 0.200 ms p95**; this is a sequential whole-renderer comparison, subject to normal measurement noise and fixture timing differences. Production adds just two circles per active-touch frame, independent of bug count.

The [first pair](touch-evidence/performance-first.json) is retained: off mean/lowest FPS 59.949 / 58.000, on 59.899 / 57.053, with draw mean/p95 1.292 / 2.300 ms and 1.713 / 2.600 ms respectively. The on case failed the rolling floor. The table above is a repeat with no concurrent agent work during either sample; there were no renderer, workload or threshold changes between pairs. The repeat passed both cases, while the first result demonstrates host scheduling variability that these measurements cannot eliminate.

## Reproduce

Install project dependencies with `bun install --frozen-lockfile`, and build with `bun run build`, using a scratch `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `DATA_DIR`. Install the probe dependency in a separate scratch directory, not this repository. For example, in PowerShell:

```powershell
$env:SCRATCH = Join-Path ([IO.Path]::GetTempPath()) ('bug-swarm-touch-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $env:SCRATCH | Out-Null
Set-Content (Join-Path $env:SCRATCH 'package.json') '{"private":true,"type":"module"}'
bun add --cwd $env:SCRATCH playwright-core@1.65.1
$env:HOME = Join-Path $env:SCRATCH 'home'
$env:USERPROFILE = $env:HOME
$env:APPDATA = $env:HOME
$env:LOCALAPPDATA = $env:HOME
$env:DATA_DIR = Join-Path $env:SCRATCH 'data'
New-Item -ItemType Directory -Force $env:HOME,$env:DATA_DIR | Out-Null
# Optional: point CHROME at a Chrome for Testing executable; otherwise uses channel chrome.
$env:CHROME = '<absolute path to Chrome for Testing executable>'
bun run build
bun docs/touch-validation.probe.ts
bun docs/touch-validation.probe.ts --performance
```

The probe itself uses platform-independent paths and always closes Chrome. Its two modes write screenshots and raw JSON under `docs/touch-evidence/`. The performance mode bundles the unchanged developer fixture in memory; it does not add a production entry point. For interactive inspection, use the existing Vite benchmark procedure in [look-validation.md](look-validation.md), adding `?profile=stress` and then `?profile=stress&joystick`.
