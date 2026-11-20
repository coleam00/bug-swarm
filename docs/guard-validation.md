# Restart and choice input guards

Issue #37 adds an 800 ms guard after death and a 350 ms guard when each upgrade choice opens. Session enforces monotonic deadlines, independently of published readiness or API completion. A single one-shot timer publishes readiness while subscribed; no deadline checks or React updates were added to the animation loop. Simulation, scoring and pacing rules are unchanged, so this change requires no new 150-bug frame-cost benchmark.

`bun run check` passed **279 tests**, including deterministic Session/engine/UI checks using injected time and manually advanced schedulers. These cover inclusive 800/350 ms boundaries, rejected inputs without side effects, immutable choices/results, held keys, pointer presses spanning a deadline, native activation suppression, automatic readiness, early/obsolete callbacks, cancellation, detach/reattach and unmount cleanup. `bun run pacing` passed the default 20-run matrix with **zero score failures**, unchanged evasive medians of **77.78 s portrait / 79.60 s landscape**, and all four gates passing. `bun run build` passed.

Headless **Chrome for Testing 156.0.8078.4** on the Windows factory machine passed the [browser probe](guard-validation.probe.ts) at **390×844** and **844×390**, touch emulation/DPR 2, plus desktop keyboard at **1280×720**, DPR 1. [Raw assertions and measurements](guard-evidence/browser.json) record:

- An early touch-down on a card held past readiness did not select. Fresh taps did select. Cards faded from sampled opacity below 1 to 1, with one animation retained across the readiness update. Reduced motion displayed full opacity immediately while retaining the input guard.
- Early held Space on the choice and Enter on game over did not activate on release/repeat after readiness. Numeric keys also required release and a fresh press. Gameplay time stayed frozen during the choice.
- Replay instruction and button were initially invisible, then appeared automatically. Score, race and top 10 remained available. The build's vertical position stayed fixed across readiness. Early overlay downs released after readiness did not restart or start another API request; fresh input restarted once.
- Tab/Shift+Tab stayed in the modal; Escape did not dismiss it; selection restored canvas focus. Phone layouts had no horizontal overflow, and the landscape results scrolled to the final leaderboard row. A fresh touch after restart stayed stationary until dragged. Offline score failure still allowed replay after the same guard. No uncaught page errors occurred.

The probe also asserts a computed `animation-duration` of `0.35s` at all three viewports and records it in the JSON. A scratch copy of the production build with the fade changed to `100ms` failed this assertion (`0.1s` versus `0.35s`); the unchanged build passed all scenarios. The original layout screenshots are retained.

Inspected screenshots: [portrait choice](guard-evidence/choice-390.png), [landscape choice](guard-evidence/choice-844.png), [portrait results](guard-evidence/over-390.png), [landscape results scrolled to the final row](guard-evidence/over-844.png). Desktop screenshots are retained beside them. These are factory-machine browser measurements with device emulation, as allowed by the owner ruling.

The probe intercepts every request, serves the built assets in process and mocks API responses. It creates no application server or database and uses an isolated browser profile and scratch home/data paths. The installed Chrome channel refused remote debugging; the completed run used Chrome for Testing through `CHROME` instead.

To reproduce from PowerShell, create a scratch directory and install tooling there, keeping application dependencies unchanged:

```powershell
$env:SCRATCH = Join-Path ([IO.Path]::GetTempPath()) ('bug-swarm-guards-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $env:SCRATCH | Out-Null
Set-Content (Join-Path $env:SCRATCH 'package.json') '{"private":true,"dependencies":{"playwright-core":"1.65.1"}}'
$env:HOME = Join-Path $env:SCRATCH 'home'
$env:USERPROFILE = $env:HOME
$env:APPDATA = Join-Path $env:HOME 'AppData/Roaming'
$env:LOCALAPPDATA = Join-Path $env:HOME 'AppData/Local'
$env:DATA_DIR = Join-Path $env:SCRATCH 'data'
New-Item -ItemType Directory -Force $env:HOME | Out-Null
bun install --cwd $env:SCRATCH
$env:CHROME = '<absolute path to Chrome for Testing executable>'
bun run build
bun docs/guard-validation.probe.ts
```

The probe closes Chrome before exiting and writes screenshots and JSON under `docs/guard-evidence/`. Existing touch/share probes now wait for guard readiness before their successful-selection/replay scenarios.
