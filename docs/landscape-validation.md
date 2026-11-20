# Phone landscape validation — issue #38

Recorded 2026-11-20 on the factory Windows desktop with Bun 1.4.2 and headless Chrome for Testing **156.0.8078.4**, using the production Vite bundle. The [browser probe](landscape-validation.probe.ts) passed **49 game cases and eight board cases**, including touch and desktop pointers, both short sizes, all five requested viewports, rotation and real API replay. [Game geometry](landscape-evidence/measurements.json) records the initial game run; [board geometry](landscape-evidence/board-measurements.json) records the review repair.

## Results and arena height

Below 500 px high and at least 600 px wide, results use two columns: score/race/status/best/restart on the left, upgrades/top 10 on the right. HUD and footer give their height to results. Outside that breakpoint the stacked results retain vertical scrolling, including long names wrapping beside their scores. Names and scores use grid columns within native ordered-list items; ranks remain visible.

The short HUD is one 32 px line. Primary-touch devices hide the controls footer during play and upgrade choice, before any gesture. Desktop pointers retain controls and the expanded F readout. The shell takes safe-area padding once; the native top-layer dialog independently uses the same insets. Entry also receives safe padding. `/board` keeps its separate stylesheet, with inset-aware padding at each responsive breakpoint.

| Viewport | Previous touch canvas | New touch canvas | Desktop canvas, F visible | Populated Play again bottom | Row ten bottom |
| --- | ---: | ---: | ---: | ---: | ---: |
| 844×390 | 306 px | **358 px** | 322 px | 248 px | 264 px |
| 740×360 | 276 px | **328 px** | 292 px | 248 px | 284 px |

Both landscape overlays have `scrollHeight === clientHeight` (390 / 360 px). The probe checks document, overlay and both columns for overflow, and checks each heading, status, upgrade summary, row, full name, score and button against the safe rectangle. It captures screenshots before any interaction that could scroll the results. All restart buttons remain 48 px high; all buttons meet the 44 px minimum.

Layout fixtures include ten **16-character names** (fourteen W's plus a two-digit suffix), five-digit scores, all four upgrades with counts 1–4, populated and zero team totals, empty results/personal best, loading reads/save, failed reads/save, and rate-limited starts. At 740×360 the upgrade summary takes two lines; it and all ten rows still fit with room below. Zero totals put Play again's bottom at 272 px; rate-limit feedback puts it at 268 px. These fixtures prove layout, not server score acceptance.

## Safe areas, rotation and API smoke

Chrome's `Emulation.setSafeAreaInsetsOverride` supplied real `env(safe-area-inset-*)` values, and the probe asserted the shell's computed padding equals those values:

- 844×390 and 740×360: left/right 44 px, bottom 21 px.
- 844×390: asymmetric left 44 px / right 12 px, bottom 21 px.
- 390×844 and 360×640: top 44 px, bottom 34 px.

HUD, canvas, results controls and all three upgrade cards stay inside those bounds. At 740×360 with the 44/44/21 insets, the results viewport is 339 px high; row ten ends at 284 px and Play again at 272 px, without scrolling. Portrait still scrolls its long leaderboard inside the safe results panel. All three portrait upgrade cards fit, including at 360×640 with insets. Dialog focus starts on a card, remains in the modal and restores to canvas on selection.

A separate smoke used the real Hono app and a fresh SQLite database. Rotating portrait → landscape preserved steering: CDP touch down/drag moved the robot. Rotating a pending upgrade choice to portrait and back preserved that choice. After selection, a fresh unmodified run played and saved successfully through the real API. Once the existing restart guard allowed replay, one touch on Play again issued exactly one new start, resumed play and selected the existing 800×450 landscape simulation arena. There were **zero uncaught browser errors**.

The layout only changes CSS display dimensions. The existing canvas ResizeObserver updates rendering size; no simulation dimensions, Session behavior, input rules, pacing, renderer or per-frame work were added or changed. This is browser layout evidence on the factory machine, with no new frame-rate claim.

## Review repairs

The shared `viewport-fit=cover` also reaches `/board` and `/board/`. Their separate stylesheet previously left ranks, scores and headings outside the safe rectangle. Board padding now adds each inset to its existing responsive spacing, without loading game CSS. Eight direct-load cases cover both routes at 844×390 (44/44 px sides, 21 px bottom), 740×360 (44/12 px asymmetric sides, 21 px bottom), 390×844 (44 px top, 34 px bottom), and 1280×720 (44/44 px sides, 21 px bottom). They cover all three padding breakpoints, all ten names/ranks/scores, headings, team totals, horizontal overflow and the footer after scrolling to the document bottom. The assertion checks visible content bounds rather than requiring a particular padding implementation.

At 844×390 content now occupies x=60–784, inside the safe interval [44,800]. In portrait the heading starts at y=56, below the 44 px top inset. The original board CSS fails the repaired probe at unsafe horizontal content bounds. Captures: [landscape board](landscape-evidence/board-844x390.png), [portrait board](landscape-evidence/board-390x844.png).

The other two repairs strengthen existing assertions. Game-over row counts, full names and scores now come from the fixture state at every viewport; an empty rendered list cannot skip the checks. Upgrade assertions also run independently of row count. The component test requires Best in the summary for loading, empty, numeric server values and failures. The metadata test parses directive names and values, accepting directive order, whitespace and equivalent numeric scale values.

Replayed the reported mutations against the repaired checks:

- Rendering `view.leaders.slice(0, 0).map(...)` fails the browser assertion with **0 !== 10** in the populated fixture.
- Moving Best into `.over-board` fails the component assertion that Best belongs in the summary.
- Reordering metadata to `viewport-fit = cover , initial-scale = 1 , width = device-width` passes the metadata tests and all **49 game / eight board** browser cases. Removing `viewport-fit=cover` still fails the required-value assertion.

All temporary mutations were restored. The fresh final production build passed all 57 browser cases, real save, rotation, steering and single replay. Source inspection found entry, the game shell and the dialog already inset-aware; the game cases continue to cover the shell and dialog geometry. Other viewport metadata assertions check their intended values; no other viewport directive string comparison remains. The browser probe remains a manually invoked developer check.

Merged newer `main` at `ecca27f` to resolve overlapping game-over markup and tests. Kept its 800 ms replay guard, 350 ms choice guard, input handlers and guard tests; the guarded restart controls stay inside the left summary. The layout probe waits for published control readiness before successful input and screenshots. The inherited guard probe's landscape-scrolling assertion was updated to the new no-scroll layout, matching the already-superseded team validation. Session and engine files match `main` exactly. Rechecked the 57 cases and reported mutations after integration. The guard browser probe also passed at 390×844, 844×390 and 1280×720, including early-input rejection, fresh inputs, reduced motion, focus, offline replay and zero uncaught errors. All ten requested playing/results screenshot files were byte-identical to fresh post-merge captures, so their existing PR links remain valid.

## Screenshots

| Viewport | Playing | Populated game over |
| --- | --- | --- |
| 844×390 | [Playing](landscape-evidence/844x390-playing.png) | [Game over](landscape-evidence/844x390-over.png) |
| 740×360 | [Playing](landscape-evidence/740x360-playing.png) | [Game over](landscape-evidence/740x360-over.png) |
| 390×844 | [Playing](landscape-evidence/390x844-playing.png) | [Game over](landscape-evidence/390x844-over.png) |
| 360×640 | [Playing](landscape-evidence/360x640-playing.png) | [Game over](landscape-evidence/360x640-over.png) |
| 1280×720 | [Playing](landscape-evidence/1280x720-playing.png) | [Game over](landscape-evidence/1280x720-over.png) |

Additional evidence: [zero totals](landscape-evidence/740x360-zero.png), [empty](landscape-evidence/740x360-empty.png), [loading](landscape-evidence/740x360-loading.png), [failed reads/save](landscape-evidence/740x360-failed.png), [rate limit](landscape-evidence/740x360-rate-limited.png), [desktop F readout](landscape-evidence/740x360-desktop.png), [safe landscape results](landscape-evidence/740x360-safe-44-over.png), [safe landscape choice](landscape-evidence/740x360-safe-44-choice.png), [asymmetric choice](landscape-evidence/844x390-safe-12-choice.png), [safe portrait choice](landscape-evidence/360x640-safe-0-choice.png).

## Reproduce and checks

Install project dependencies with `bun install --frozen-lockfile`, then `bun run build`. Create a separate scratch directory with its own `package.json` before installing `playwright-core` there; this is validation tooling, not a project dependency. Set `SCRATCH` to that directory and optionally `CHROME` to a Chrome for Testing executable. Set HOME, USERPROFILE, APPDATA, LOCALAPPDATA and DATA_DIR to scratch locations when running project commands. Run `bun docs/landscape-validation.probe.ts` from the checkout. Optional `EVIDENCE` changes the output directory.

The probe intercepts every request to a synthetic HTTPS origin, serving built assets and controlled fixtures or dispatching directly to its own in-process Hono app. It opens no HTTP listener and never connects to another server. Chrome uses a temporary profile, debugging pipe and scratch home; the database uses a fresh scratch data directory. The browser and SQLite handles close in `finally`.

Validation completed:

- `bun test src/web/App.test.ts src/server/share-meta.test.ts`: 23 passed. Phase transitions, score/race adjacency within the summary, all upgrades/counts, server-derived values, failure feedback, guarded single restart and viewport metadata are covered.
- `bun run check`: TypeScript and **311 tests passed**, 90,137 assertions, zero failures after merging the input guards and review repairs.
- `bun run pacing` with no flags: all **20 default cases** passed `idle60`, `evasiveMedian60to180`, `allDead240`, `scoresPlausible`; evasive median 78.69 s, longest 136.87 s, zero score failures.
- `bun run build`: production build passed.
- `bun docs/landscape-validation.probe.ts`: all **49 game and eight board cases**, real save, rotation, touch steering and single replay passed.
- `git diff --check`: passed.

The old short-landscape scrolling acceptance in [team validation](team-validation.md) is superseded by these results. Portrait and normal desktop height retain the stacked, scrollable layout.
