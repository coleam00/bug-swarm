# Phone landscape validation — issue #38

Recorded 2026-11-20 on the factory Windows desktop with Bun 1.4.2 and headless Chrome for Testing **156.0.8078.4**, using the production Vite bundle. The [browser probe](landscape-validation.probe.ts) passed **49 measured cases**, including touch and desktop pointers, both short sizes, all five requested viewports, rotation and real API replay. [Raw geometry](landscape-evidence/measurements.json) records every case.

## Results and arena height

Below 500 px high and at least 600 px wide, results use two columns: score/race/status/best/restart on the left, upgrades/top 10 on the right. HUD and footer give their height to results. Outside that breakpoint the stacked results retain vertical scrolling, including long names wrapping beside their scores. Names and scores use grid columns within native ordered-list items; ranks remain visible.

The short HUD is one 32 px line. Primary-touch devices hide the controls footer during play and upgrade choice, before any gesture. Desktop pointers retain controls and the expanded F readout. The shell takes safe-area padding once; the native top-layer dialog independently uses the same insets. Entry also receives safe padding. `/board` keeps its separate stylesheet.

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

A separate smoke used the real Hono app and a fresh SQLite database. Rotating portrait → landscape preserved steering: CDP touch down/drag moved the robot. Rotating a pending upgrade choice to portrait and back preserved that choice. After selection, a fresh unmodified run played and saved successfully through the real API. One touch on Play again issued exactly one new start, immediately resumed play and selected the existing 800×450 landscape simulation arena. There were **zero uncaught browser errors**.

The layout only changes CSS display dimensions. The existing canvas ResizeObserver updates rendering size; no simulation dimensions, Session behavior, input rules, pacing, renderer or per-frame work were added or changed. This is browser layout evidence on the factory machine, with no new frame-rate claim.

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

- `bun test src/web/App.test.ts src/server/share-meta.test.ts`: 23 passed. Phase transitions, score/race adjacency within the summary, all upgrades/counts, server-derived values, failure feedback, immediate single restart and viewport metadata are covered.
- `bun run check`: TypeScript and **302 tests passed**, 90,029 assertions, zero failures.
- `bun run pacing` with no flags: all **20 default cases** passed `idle60`, `evasiveMedian60to180`, `allDead240`, `scoresPlausible`; evasive median 78.69 s, longest 136.87 s, zero score failures.
- `bun run build`: production build passed.
- `bun docs/landscape-validation.probe.ts`: all **49 cases**, real save, rotation, touch steering and single replay passed.
- `git diff --check`: passed.

The old short-landscape scrolling acceptance in [team validation](team-validation.md) is superseded by these results. Portrait and normal desktop height retain the stacked, scrollable layout.
