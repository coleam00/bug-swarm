# Shield pickup validation — issue 79

This delivery implements the supplied shield-only plan: the pickup foundation, shield behavior, transport, drawing and safe bot collection. Spread and rapid remain owner-filed follow-ups. No simulation tuning or existing skill/fairness gates were changed.

All raw logs, browser profiles, scratch homes, databases, screenshots and measurements are under `.evidence/79/` in this checkout. They are gitignored. The production driver is reproducible with `bun run build` then `bun scripts/validate-shield.ts` (`CHROME_PATH` may select Chrome). It starts its own loopback server on an ephemeral port and closes every owned process/server on completion; controlled state is confined to the evidence harness, with no debug endpoint.

## Checks and authoritative behavior

`bun run check` passed TypeScript and all **424 tests across 57 files** (`.evidence/79/check-delivery.log`). Focused simulation tests cover both crawler and dasher contact, consumption, subsequent damage, exact expiry, refresh without stacking, protection/immunity precedence, firing, collection before combat, lifecycle cleanup and revival. Drop tests cover exact unsigned probability thresholds for every configured rate, seeded replay, spawn-RNG independence, lethal-only rolling, swept impact position, simultaneous kills at capacity, twelve-second expiry, swept crossing, first-touch ownership, insertion-order independence, id ties and inactive exclusion.

Protocol tests reject corrupt floor entities and effect maps. The completed maximum-payload fixture includes six pickups and shields on every active player, with all downed/out population splits and terminal results. `.evidence/79/payload.json` records a **64,300-byte** maximum, leaving **1,236 bytes** below the unchanged 65,536-byte cap. Renderer/timeline tests cover delayed birth/removal, blink boundaries, glow caching/culling, remote bubbles and authoritative HUD depletion/refresh/removal. Policy tests cover seeking within 250 units, unsafe routes and committed corridors, expiry, refresh opportunities, dodge/rescue priority and unchanged mover behavior. The real-server two-client test verifies shared floor state, one collection winner, refresh and hit consumption; the bot transport test verifies pickup steering with independent aiming/firing.

## Production Chrome and touch

Chrome **157.0.8103.51** ran two independent browser storage contexts plus 18 aimer bots in one arena. Final-build visual evidence: `.evidence/79/production-HuNa6G/`. Final rendering measurements: `production-MFi16a/`; actual CLI load measurements: `production-e3OWNc/`. Earlier runs remain under `.evidence/79/`. Controlled visual stages clear threats and move evidence bots away between collections so a shield remains available to capture. Natural drops and load measurements use ordinary play.

- `natural-drop-observer-moved.png`: a real bot kill rolled a shield naturally; the protected observer was moved beside it for framing. RNG and kills were not forced.
- `desktop-floor-and-spawn-arcs.png`, `portrait-floor.png`, `portrait-floor-nearby.png`: violet floor glyph and glow; pale rotating spawn arcs remain distinct.
- `desktop-floor-blink-dim.png`, `desktop-floor-blink-bright.png`: the final-three-second bright/dim phases.
- `desktop-active.png`, `desktop-draining-hud.png`, `desktop-refreshed.png`, `desktop-consumed.png`: movement collection, bubble/HUD ring, depletion, refreshed deadline and consumed shield with health preserved.
- `portrait-remote-bubble.png`, `portrait-active.png`, `landscape-active-twin-sticks.png`: remote and local effects at 390×844 and 844×390; simultaneous touch movement and aiming/firing.
- `report.json`: corresponding authoritative scene snapshots, touch input, frame samples and assertions. Both clients reported no overflow or console errors. Screenshots were inspected for HUD/minimap/stick overlap and distinction from spawn protection.

The real 20-player room's eight F-readout samples stayed at approximately **60 FPS**: desktop update/draw cost **0.272–0.562 ms/frame**, portrait **0.193–0.530 ms/frame**.

## Full-arena rendering cost

The developer fixture includes 20 robots, 150 bugs, maximum shots/events, six floor pickups and shields on all active robots. `?baseline` removes the pickups/effects for comparison. Four one-second Chrome samples per viewport from `production-MFi16a/report.json`, after the skill run and checks finished:

| Viewport | Baseline FPS | Shield FPS | Baseline ms/frame | Shield ms/frame |
| --- | --- | --- | --- | --- |
| 1280×800 | 60.0 | 60.0 | 0.987–1.248 | 0.950–1.007 |
| 390×844 | 60.0 | 60.0 | 0.846–0.902 | 0.751–0.757 |
| 844×390 | 60.0 | 60.0 | 0.826–0.962 | 0.874–0.968 |

Earlier stress runs competing with skill/check computation had variable desktop throughput (baseline 50–60 FPS, shield 42.6–60 FPS); their raw reports are retained. The final renderer keeps cached floor glows and draws active bubbles with strokes/fill, removing twenty extra glow-image copies per full frame and preserving team colours. The fixture mutates effect deadlines without allocating a fresh timer map per robot per frame. The final comparison holds 60 FPS throughout, with landscape median draw cost about 0.04 ms above baseline; small differences in either direction are within sample noise. Phone emulation stayed at 60 FPS in every run.

## Server load

After the visual scenes and renderer fixture closed, the production driver ran the actual CLI in a separate process:

`bun run bots -- --url <owned-production-origin> --count 200 --seconds 120 --policy aimer`

All **200 clients joined across 10 arenas**, with **zero errors**. The final 60-second window contained 11,756 tick samples: **p50 1.062 ms, p95 1.931 ms**, passing the p95 <10 ms gate. Scheduler lateness was p50 0.950 ms / p95 2.277 ms. Message rates were approximately 1,644 sent/s and 3,487 received/s. See `production-e3OWNc/bots.json`, `bots.stderr.log` and `report.json` for populations, rates and exact measurements.

The first in-process workload also passed (200 joins, zero errors, tick p95 1.793 ms), but shared server/client execution had scheduler lateness p95 38.053 ms. The separate CLI measurement above better matches the deployed server/client boundary. Skill computation ran concurrently; neither run used an operator server or real player data.

## Skill and fairness

The complete `bun run skill` command finished successfully. Raw output: `.evidence/79/skill.json`; normalized UTF-8 report with every observation: `skill-report.json`; aggregate cohort data: `skill-summary.json`.

| Policy | Median score | Median life (s) | Lives | Deaths | Horizon cutoffs |
| --- | --- | --- | --- | --- | --- |
| mover | 256 | 84.1 | 309 | 149 | 160 |
| aimer | 4446 | 120.8 | 239 | 79 | 160 |

Aimer/mover score ratio: **17.367×**, passing the unchanged ≥2× gate with positive medians over 20 seeds, eight bots and 180 seconds. Fresh aimer newcomer median: **136.85 s**; 480-second joins: **257.575 s**, or **188.217%** of fresh survival (required ≥80%). Comparison: **pass**, observation horizon 600 seconds.

All 61 busy-arena idle join ages (0–900 seconds in 15-second increments), plus both solo controls, pass the unchanged ten-second median gate. Lowest idle median: **21.4 s**. Each cohort below has 20 independent newcomer observations; deaths are completed first lives, cutoffs are censored survivors at the horizon. A ≥ median denotes a censored lower bound.

| Policy | Join age (s) | Incumbents | Median life (s) | Deaths | Cutoffs |
| --- | --- | --- | --- | --- | --- |
| aimer | 0 | 8 | 136.85 | 18 | 2 |
| aimer | 480 | 8 | 257.575 | 16 | 4 |
| idle | 0 | 8 | 31.55 | 20 | 0 |
| idle | 15 | 8 | 21.925 | 20 | 0 |
| idle | 30 | 8 | 22.575 | 20 | 0 |
| idle | 45 | 8 | 22.225 | 20 | 0 |
| idle | 60 | 8 | 21.4 | 20 | 0 |
| idle | 75 | 8 | 21.6 | 20 | 0 |
| idle | 90 | 8 | 21.5 | 20 | 0 |
| idle | 105 | 8 | 22.875 | 20 | 0 |
| idle | 120 | 8 | 21.825 | 20 | 0 |
| idle | 135 | 8 | 21.875 | 20 | 0 |
| idle | 150 | 8 | 22.225 | 20 | 0 |
| idle | 165 | 8 | 22 | 20 | 0 |
| idle | 180 | 8 | 21.4 | 20 | 0 |
| idle | 195 | 8 | 22.175 | 20 | 0 |
| idle | 210 | 8 | 22.05 | 20 | 0 |
| idle | 225 | 8 | 23.975 | 20 | 0 |
| idle | 240 | 8 | 22.525 | 20 | 0 |
| idle | 255 | 8 | 21.95 | 20 | 0 |
| idle | 270 | 8 | 21.8 | 20 | 0 |
| idle | 285 | 8 | 21.775 | 20 | 0 |
| idle | 300 | 8 | 22.225 | 20 | 0 |
| idle | 315 | 8 | 21.85 | 20 | 0 |
| idle | 330 | 8 | 21.675 | 20 | 0 |
| idle | 345 | 8 | 22.9 | 20 | 0 |
| idle | 360 | 8 | 22.15 | 20 | 0 |
| idle | 375 | 8 | 21.95 | 20 | 0 |
| idle | 390 | 8 | 23.425 | 20 | 0 |
| idle | 405 | 8 | 22.525 | 20 | 0 |
| idle | 420 | 8 | 22.675 | 20 | 0 |
| idle | 435 | 8 | 22.6 | 20 | 0 |
| idle | 450 | 8 | 23.175 | 20 | 0 |
| idle | 465 | 8 | 21.625 | 20 | 0 |
| idle | 480 | 8 | 22.375 | 20 | 0 |
| idle | 495 | 8 | 22.3 | 20 | 0 |
| idle | 510 | 8 | 22.45 | 20 | 0 |
| idle | 525 | 8 | 21.925 | 20 | 0 |
| idle | 540 | 8 | 22.225 | 20 | 0 |
| idle | 555 | 8 | 23.025 | 20 | 0 |
| idle | 570 | 8 | 23.075 | 20 | 0 |
| idle | 585 | 8 | 21.4 | 20 | 0 |
| idle | 600 | 8 | 22.475 | 20 | 0 |
| idle | 615 | 8 | 22.125 | 20 | 0 |
| idle | 630 | 8 | 22.3 | 20 | 0 |
| idle | 645 | 8 | 22.325 | 20 | 0 |
| idle | 660 | 8 | 22.7 | 20 | 0 |
| idle | 675 | 8 | 21.95 | 20 | 0 |
| idle | 690 | 8 | 22.825 | 20 | 0 |
| idle | 705 | 8 | 22.1 | 20 | 0 |
| idle | 720 | 8 | 22.325 | 20 | 0 |
| idle | 735 | 8 | 22.125 | 20 | 0 |
| idle | 750 | 8 | 23.175 | 20 | 0 |
| idle | 765 | 8 | 22.25 | 20 | 0 |
| idle | 780 | 8 | 23.225 | 20 | 0 |
| idle | 795 | 8 | 22.275 | 20 | 0 |
| idle | 810 | 8 | 22.475 | 20 | 0 |
| idle | 825 | 8 | 23.3 | 20 | 0 |
| idle | 840 | 8 | 21.5 | 20 | 0 |
| idle | 855 | 8 | 22 | 20 | 0 |
| idle | 870 | 8 | 22.075 | 20 | 0 |
| idle | 885 | 8 | 22.25 | 20 | 0 |
| idle | 900 | 8 | 22.175 | 20 | 0 |
| idle | 0 | 0 | 22.225 | 20 | 0 |
| idle | 480 | 0 | 22.275 | 20 | 0 |
