# Issue 40: first-run steering hint

The steering hint is implemented and validated. The gentler opening and proposed idle 20–30-second gate are **not implemented**: curve-only experiments have not satisfied the idle range together with existing evasive gates. Production combat and pacing targets remain unchanged. See [pacing investigation](pacing-validation.md#issue-40-opening-investigation-unresolved).

The overlay uses the exact touch/desktop messages, sits inside the arena surface above the robot, and neither captures input nor pauses gameplay. Separate localStorage persistence consumes eligibility at local start, including offline starts and existing identities with no hint flag. A retained controller suppresses repeats on restart and across effect reattachment. Failed storage logs once and suppresses repeats within the page.

Adjacent controller tests cover exact wall-time expiry, movement/token handling, persistence, failed storage getter/read/write, early/stale timers, choice/death/replacement, cleanup and detach/reattach. Engine tests use real fixed-step displacement for WASD, arrows, mouse and touch, reject stationary/rejected input, and stop observation after dismissal. App integration runs desktop, coarse-pointer, touch-entry and absent-matchMedia cases with key-aware storage, testing placement, exact text, expiry, movement and restart/reload suppression.

## Chrome

[Browser assertions and layout measurements](steering-evidence/browser.json) were captured using factory Chrome for Testing, with all HTTP intercepted in-process. No listener or database was opened. Phone contexts use touch emulation and DPR 2; desktop uses DPR 1.

| Viewport | Input | Evidence |
| --- | --- | --- |
| 390×844 | Touch | [Portrait hint](steering-evidence/hint-390.png) |
| 844×390 | Touch | [Landscape hint](steering-evidence/hint-844.png) |
| 1280×720 | Desktop | [Desktop hint](steering-evidence/hint-1280.png) |

All sizes passed fresh entry and board eligibility, exact message, nonfocusable status semantics, arena containment, no overflow, input beneath the hint, real movement dismissal, untouched four-second expiry, restart, reload, existing identity without a flag, blocked storage and offline play. Text is 18px with white foreground on an opaque dark background. Screenshots preserve the unobscured central robot. These are owner-approved factory Chrome measurements; no physical device is required.

## Frame cost

The [fixture](steering-benchmark.ts) mounts the production engine with its actual movement observer and hint controller, 150 mixed base/fast bugs, and the F update/draw readout. A fake hint clock holds the pending path for measurement; it does not change combat or the engine. Each phase warms for ten seconds and measures sixty seconds, first watching and then dismissed. Fixture repositioning runs before the engine callback and outside measured update/draw cost. The robot remains stationary so the observer runs throughout the watching sample. After dismissal, exactly one further pending check removes it. There are no allocations in the added production observer path. Full results are recorded in [performance.json](steering-evidence/performance.json).

Chrome for Testing 158.0.8127.36, 1280×720 at DPR 1, with no concurrent tuning or test jobs during the accepted sample:

| Observer | Mean FPS | Mean update | Mean draw | Bugs |
| --- | ---: | ---: | ---: | ---: |
| Watching | 59.999 | 0.024 ms | 0.815 ms | 150 |
| Dismissed | 59.999 | 0.025 ms | 0.803 ms | 150 |

Both sixty-second samples exceed the 58 FPS floor. There were 4,179 pending checks during the watching phase (including warmup), then one removal check and no further observation after dismissal. Update cost is within measurement noise; the F readout rounds individual costs to 0.01 ms. Initial probe attempts timed out because its own default animation-frame polling entered the benchmark wrapper; the accepted probe uses timer polling, so only production game frames contribute to the measurement.

Validation: the focused `bun run check src/web/App.test.ts src/web/game/steering-hint.test.ts src/web/game/engine.test.ts src/web/game/session.test.ts scripts/pacing.test.ts` passes TypeScript and 98 tests / 1,410 assertions. The unfiltered suite is left to project automation as required by this delivery; the selected tests open no TCP listeners. `bun run pacing` and `bun run pacing --broad` pass every existing production gate with zero score failures. Their post-change reports are [default](steering-evidence/after-default.txt) and [broad](steering-evidence/after-broad.txt); production combat is unchanged. `bun run build` succeeds. Chrome behavior/layout and the accepted performance probe both pass with no uncaught page errors.

## Reproduce

Use a new scratch directory with a `package.json` containing `{"private":true,"type":"module"}`. Install `playwright-core@1.65.1` there. Set `SCRATCH` to that directory and redirect `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `DATA_DIR` into it. Set `CHROME` to a Chrome for Testing executable when the installed Chrome channel blocks remote debugging. The probe launches its own isolated browser and closes it in `finally`.

```text
bun run build
bun docs/steering-validation.probe.ts
bun docs/steering-validation.probe.ts --performance
bun docs/steering-pacing-investigation.ts
```

Run performance sampling alone. The probes are developer tools excluded from production entry points; their browser dependency is not added to the project.
