# Issue 40: first-run steering hint

The steering hint is approved and unchanged. Opening balance is incomplete: removing the rejected speed surge preserves the reproduced seeds' 18–40-second range but lets other upgraded idle builds exceed 40 seconds. Both pacing commands currently fail their idle gates. See the [review correction](pacing-validation.md#review-correction-balance-remains-blocked) for current results and the remaining blocker. The Chrome evidence below was captured at `1d13d82`; it remains historical hint/layout/performance evidence, not proof of current pacing.

The overlay uses the exact touch/desktop messages, sits inside the arena surface above the robot, and neither captures input nor pauses gameplay. Separate localStorage persistence consumes eligibility at local start, including offline starts and existing identities with no hint flag. A retained controller suppresses repeats on restart and across effect reattachment. Failed storage logs once and suppresses repeats within the page.

Adjacent controller tests cover exact wall-time expiry, movement/token handling, persistence, failed storage getter/read/write, early/stale timers, choice/death/replacement, cleanup and detach/reattach. Engine tests use real fixed-step displacement for WASD, arrows, mouse and touch, reject stationary/rejected input, and stop observation after dismissal. App integration runs desktop, coarse-pointer, touch-entry and absent-matchMedia cases with key-aware storage, testing placement, nonempty messages, touch text, expiry, movement and restart/reload suppression.

## Chrome

[Browser assertions and layout measurements](steering-evidence/browser.json) were captured using factory Chrome for Testing, with all HTTP intercepted in-process. No listener or database was opened. Phone contexts use touch emulation and DPR 2; desktop uses DPR 1.

| Viewport | Input | Evidence |
| --- | --- | --- |
| 390×844 | Touch | [Portrait hint](steering-evidence/hint-390.png) |
| 844×390 | Touch | [Landscape hint](steering-evidence/hint-844.png) |
| 1280×720 | Desktop | [Desktop hint](steering-evidence/hint-1280.png) |

All sizes passed fresh entry and board eligibility, exact message, nonfocusable status semantics, arena containment, no overflow, input beneath the hint, real movement dismissal, untouched four-second expiry, restart, reload, existing identity without a flag, blocked storage and offline play. Text is 18px with white foreground on an opaque dark background. Screenshots preserve the unobscured central robot. These are owner-approved factory Chrome measurements; no physical device is required.

At `1d13d82`, the desktop probe fixed the gameplay seed to 1 and ran a fresh, unprotected arena without input or upgrade auto-selection. It verified no bug before the initial 9.3-second delay and recorded an idle death at **19.40 gameplay seconds**. That result used the rejected speed surge and no longer describes current combat. The probe's idle phase will now reach a pending upgrade rather than its death assertion; its timeout remains bounded.

## Frame cost

The [fixture](steering-benchmark.ts) mounts the production engine with its actual movement observer and hint controller, 150 mixed base/fast bugs, and the F update/draw readout. A fake hint clock holds the pending path for measurement; it does not change combat or the engine. Each phase warms for ten seconds and measures sixty seconds, first watching and then dismissed. Fixture repositioning runs before the engine callback and outside measured update/draw cost. The robot remains stationary so the observer runs throughout the watching sample. After dismissal, exactly one further pending check removes it. There are no allocations in the added production observer path. Full results are recorded in [performance.json](steering-evidence/performance.json).

Chrome for Testing 158.0.8127.36, 1280×720 at DPR 1, with no concurrent tuning or test jobs during the accepted sample:

| Observer | Mean FPS | Mean update | Mean draw | Bugs |
| --- | ---: | ---: | ---: | ---: |
| Watching | 59.999 | 0.028 ms | 0.764 ms | 150 |
| Dismissed | 59.999 | 0.024 ms | 0.779 ms | 150 |

Both sixty-second samples exceeded the 58 FPS floor. There were 4,173 pending checks during the watching phase (including warmup), then one removal check and no further observation after dismissal. Update cost remained below 0.03 ms mean in both samples; the F readout rounds individual costs to 0.01 ms. The probe uses timer polling, so only production game frames contribute to the measurement. The review correction removes speed knots and leaves this observer path unchanged; no additional frame work or allocation was added.

Current validation after merging main's personal-standing change: `bun run check src/web/game src/web/App.test.ts scripts/pacing.test.ts src/server/app.test.ts` passes TypeScript and **246 tests**, with **four pacing failures**. Hint test/benchmark API fixtures and the browser route stub include the new standing response. The new seed regressions pass; the Session suite also passed with opening-speed interpolation bypassed before this merge. `bun run build` passes. Both pacing commands fail `idle18to40` and `idle60`, with no score failures. Current full reports are [default](steering-evidence/issue-40-review-default.txt) and [broad](steering-evidence/issue-40-review-broad.txt). The unfiltered suite remains with project automation. Chrome behavior/layout and performance were not rerun during this correction because the hint and observer are unchanged and balance is not ready.

## Reproduce

Use a new scratch directory with a `package.json` containing `{"private":true,"type":"module"}`. Install `playwright-core@1.65.1` there. Set `SCRATCH` to that directory and redirect `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `DATA_DIR` into it. Set `CHROME` to a Chrome for Testing executable when the installed Chrome channel blocks remote debugging. The probe launches its own isolated browser and closes it in `finally`.

```text
bun run build
bun docs/steering-validation.probe.ts
bun docs/steering-validation.probe.ts --performance
bun run pacing
bun run pacing --broad
```

Run performance sampling alone. The probes are developer tools excluded from production entry points; their browser dependency is not added to the project. The behavior probe's idle phase currently fails as described above; do not interpret its earlier successful result as validation of this correction.
