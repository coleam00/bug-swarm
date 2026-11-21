# Pickup validation — issue 79

This delivery includes **spread, rapid and shield**. Spread fires three shots in a 20-degree fan for eight seconds. Rapid multiplies volley cadence by 1.8 and halves heat per projectile for eight seconds. Shield blocks one eligible hit or expires after twenty seconds. Weapon effects combine; each kind refreshes its own deadline without stacking. Spread retains the ordinary heat cost per projectile; rapid halves that cost, including spread pellets. A final volley clamps heat to capacity before lockout.

All evidence, scratch homes, temporary files, databases and browser profiles stay under `.evidence/79/`. Run `bun run build` then `bun scripts/validate-pickups.ts` (`CHROME_PATH` can select Chrome). The driver starts its own ephemeral loopback production server and closes all owned clients, servers and processes. It exposes no debug endpoint.

## Returned findings and coverage

The original shield-only scope was incomplete; both missing kinds now have their own shared definition, procedural drawing factory and simulation tests. The acceptance test requires all three catalog entries, and seeded successful drops must be able to deliver all three. Shared collection, cleanup, parser and bot tests exercise every kind. The audit followed each catalog entry through collection, expiry, both transports, delayed interpolation, robot drawing, HUD and policy observations; these paths deliver all three kinds. The drop-rate oracle specifies the required 2%, 6%, 6%, 15% independently of production configuration.

The engine fixture now carries a real visible pickup through delayed interpolation into drawing. Presentation tests require floor and HUD glyph paints, actual robot-overlay dispatch, timer depletion/refresh/removal, blinking, glow culling and resource caching for all three kinds. They identify the timer by location and arc depletion rather than an arbitrary shade. The random-stream test retains deterministic replay, independence from spawning and floor-cap behavior without reproducing the seed initializer.

The repaired safety net was mutation-tested (`mutations-integrated.json`): dasher drops at 60%, dropped engine pickup delivery, dropped robot-overlay dispatch, shield-only drop selection, missing glyphs for any kind, wrong rapid cadence and wrong spread angle all fail relevant tests. Shade-only and seed-salt-only changes pass. All mutations were restored before normal validation.

Pure fixed-step tests cover effect behavior, independent duration/refresh, combined firing, per-projectile heat, expiry restoring ordinary fire and heat-cap transitions. Existing shield protection/immunity, downing/revival, floor cap, exact floor expiry and first-touch tests remain in place. Real-server tests verify both clients observe one collection winner and receive the combined boosted fan through legacy JSON and negotiated binary transport. The merge with main retains spitter emission/interception, protection precedence and downing timing; shield blocks eligible acid globs, and pickup seeking checks the proposed route against those globs.

Pickup-seeking safety was tuned from 200/150 units of player/route clearance to **350/300**, retaining the aimer's normal separation while taking detours. Effect strengths, durations and all drop chances remain at the specified values. The first integrated full replay passed score and every idle cohort but failed newcomer fairness (310.475 s fresh, 204.900 s late, 66.0%); its complete observations remain in `skill-integrated-report.json`. Independent twenty-seed fresh/late probes compared 300/250 (inconclusive because fresh survival was censored) with the selected 350/300 (205.375 s fresh, at least 600 s late, passing). Raw probes are in `safety-300-250/newcomers.json` and `safety-350-300/newcomers.json`. Final full-replay results are recorded below.

## Projectile and transport bounds

Combined spread/rapid permits at most `20 * (ceil(10.8 * 0.9) + 1) * 3 = 660` projectiles including an arriving volley. A consumed projectile becomes an impact event, so live shots and step impacts share that 660-record budget. Rendering still permits its bounded 660-slot cosmetic pool alongside current shots.

Browsers and bots retain main's negotiated binary keyframes/deltas; pickups use a bounded collection and effects use the player extension cell. Legacy JSON uses compact combat tuples to retain the **65,536-byte** limit at combined weapon bounds. Shot records carry a packet-local owner index, explicit life, position, velocity and birth age; events carry tick age; bug records retain kind, movement, health, facing and optional phase state. Large safe-integer entity ids use a shared base. Decoding restores and validates the same named objects used by all consumers. JSON retains three-decimal movement precision; binary precision remains as documented in architecture.md. Malformed lengths, references, ages, ids and shared-budget violations are tested.

The completed payload fixtures include all three effects on twenty active players, six mixed floor pickups, 150 phased bugs including twelve spitters, twelve acid globs, every shot/impact mixture sampled at its bounds, every downed/out population split, terminal results and ids near `Number.MAX_SAFE_INTEGER`. Both formats round-trip below the unchanged cap. Maximum measured legacy size is **59,047 bytes**, leaving **6,489 bytes** (`payload-integrated.json`). The twenty-player combined-weapon simulation also round-trips live snapshots while exercising overheat and expiry.

## Production Chrome and touch

Chrome **157.0.8103.51** ran two independent storage contexts plus eighteen aimer bots in one arena. Evidence is `.evidence/79/production-WqYaDq/`, with authoritative snapshots and assertions in `report.json`.

- `natural-drop-observer-moved.png` records a naturally rolled drop from bot combat; only the protected observer was repositioned for framing.
- `desktop-floor-and-spawn-arcs.png`, the paired `desktop-floor-blink-*.png`, `desktop-active.png`, `desktop-draining-hud.png`, `desktop-refreshed.png` and `desktop-consumed.png` cover shield glow, final-three-second blinking, bubble, ring, refresh and consumption.
- `spread-desktop-floor.png`, `spread-portrait-floor.png`, `spread-desktop-active.png`, `spread-portrait-active.png` and `spread-landscape-twin-sticks.png` show the blue fan glyph, three travelling shots, fanned barrels and draining ring.
- The corresponding `rapid-*.png` captures show the rose lightning glyph, faster shots, hot barrel with bright vents and draining ring.
- Both weapon kinds also have `*-refreshed.png` and `*-expired.png`, with authoritative deadline snapshots. Expiry waits through the actual eight-second deadline; contact immunity prevents an enemy hit from clearing the effect prematurely during that controlled observation.
- Phone layouts are 390×844 and 844×390. Every kind was exercised with simultaneous touch movement and aiming/firing. Both contexts reported no overflow or console errors. Screenshots were inspected for glyph readability, robot effects, timer visibility and HUD/minimap/stick overlap.

Controlled visual stages clear nearby threats and move the evidence bots away between collections. Natural combat and load measurements use ordinary play. The floor selection chances, effect deadlines and actual movement/firing paths are unchanged by the evidence harness.

## Full-arena rendering cost

The expanded fixture includes twenty robots with all three effects, 150 bugs (including twelve swelling spitters), twelve globs, 660 shots, a 660-slot cosmetic pool and six mixed floor pickups. The corrected grid keeps all 660 shot/effect positions inside the world and desktop view. Earlier combat/revive/spitter reports retain their original fixture measurements; this report supersedes those capacity measurements for the current renderer. Four one-second samples per viewport compared the same fixture with pickup effects off/on:

| Viewport | Baseline FPS | All pickups FPS | Baseline ms/frame | All pickups ms/frame |
| --- | --- | --- | --- | --- |
| 1280×800 | 60 | 60 | 2.397–3.331 | 2.517–3.015 |
| 390×844 | 60 | 60–61.5 | 2.051–2.298 | 1.787–3.020 |
| 844×390 | 60 | 60 | 1.692–2.772 | 2.163–2.743 |

Every final sample met the nominal 60 FPS target while the full skill computation continued. Approximate median additions were 0.07 ms desktop, 0.25 ms portrait and 0.07 ms landscape. Floor glows are cached and robot strokes/fills remain bounded. Raw samples and inspected screenshots are in `production-WqYaDq/report.json`. Chrome uses its normal rendering configuration, matching the other arena drivers; the driver no longer forces software rendering. An independent corrected-grid repeat in `.evidence/79/renderer-final-F6LzMY/` also held 60 FPS in every sample (pickup draw cost 1.761–2.490 ms/frame). The initial software-only pass with the earlier grid remains in `production-AgmAIs/report.json` (about 50 FPS desktop for both baseline and pickups, 60 FPS on phones).

## Server load

After visual clients and renderer fixtures closed, the driver ran the actual CLI in a separate process:

`bun run bots -- --url <owned-production-origin> --count 200 --seconds 120 --policy aimer`

All **200 clients joined across ten arenas**, with **zero errors**. The complete 120-second window retained 200 players throughout and 23,324 tick samples: **p50 1.637 ms, p95 3.196 ms**, passing the unchanged p95 <10 ms gate. Scheduler lateness p95 was 3.482 ms. Message rates were approximately 3,841 sent/s and 3,887 received/s. Client/server byte counts differed by 0.0075% across the sampling boundaries; the busiest client averaged **35.328 KB/s**, below main's 40 KB/s gate. See `production-WqYaDq/bots.json`, `bots.stderr.log` and `report.json`. All owned servers, sockets, Chrome processes and databases closed afterward.

## Checks, skill and fairness

`bun run check` passed TypeScript and all **497 tests across 64 files** (`check-final.log`); Linux and Windows CI also passed. Final fixture/decoder simplifications passed 34 focused tests (`final-integration-focused.log`), and TypeScript passed again (`tsc-final.log`). Production build passed (`build-final.log`).

The complete `bun run skill` command finished successfully. Raw output: `.evidence/79/skill-final.json`; normalized UTF-8 report with every observation: `skill-final-report.json`; aggregate cohort data: `skill-final-summary.json`.

| Policy | Median score | Median life (s) | Lives | Deaths | Horizon cutoffs |
| --- | --- | --- | --- | --- | --- |
| mover | 221 | 64.325 | 362 | 202 | 160 |
| aimer | 2326 | 80.95 | 323 | 163 | 160 |

Aimer/mover score ratio: **10.525×**, passing the unchanged ≥2× gate with positive medians over 20 seeds, eight bots and 180 seconds. Fresh aimer newcomer median: **205.375 s**; 480-second joins: **at least 600 s**, or **at least 292.149%** of fresh survival (required ≥80%). Comparison: **pass**, observation horizon 600 seconds. The late median is a censored lower bound: eight first lives ended and twelve reached the horizon.

All 61 busy-arena idle join ages (0–900 seconds in 15-second increments), plus both solo controls, pass the unchanged ten-second median gate. Lowest idle median: **21 s**. Each cohort below has 20 independent newcomer observations; deaths are completed first lives, cutoffs are censored survivors at the horizon. A ≥ median denotes a censored lower bound.

| Policy | Join age (s) | Incumbents | Median life (s) | Deaths | Cutoffs |
| --- | --- | --- | --- | --- | --- |
| aimer | 0 | 8 | 205.375 | 12 | 8 |
| aimer | 480 | 8 | ≥600 | 8 | 12 |
| idle | 0 | 8 | 30 | 20 | 0 |
| idle | 15 | 8 | 22.875 | 20 | 0 |
| idle | 30 | 8 | 23.75 | 20 | 0 |
| idle | 45 | 8 | 21.725 | 20 | 0 |
| idle | 60 | 8 | 21.2 | 20 | 0 |
| idle | 75 | 8 | 22.175 | 20 | 0 |
| idle | 90 | 8 | 21.525 | 20 | 0 |
| idle | 105 | 8 | 21.3 | 20 | 0 |
| idle | 120 | 8 | 21 | 20 | 0 |
| idle | 135 | 8 | 21.25 | 20 | 0 |
| idle | 150 | 8 | 21.3 | 20 | 0 |
| idle | 165 | 8 | 21.5 | 20 | 0 |
| idle | 180 | 8 | 21.275 | 20 | 0 |
| idle | 195 | 8 | 21.7 | 20 | 0 |
| idle | 210 | 8 | 21.8 | 20 | 0 |
| idle | 225 | 8 | 22.3 | 20 | 0 |
| idle | 240 | 8 | 22.7 | 20 | 0 |
| idle | 255 | 8 | 21.675 | 20 | 0 |
| idle | 270 | 8 | 21.625 | 20 | 0 |
| idle | 285 | 8 | 22.125 | 20 | 0 |
| idle | 300 | 8 | 21.95 | 20 | 0 |
| idle | 315 | 8 | 21.85 | 20 | 0 |
| idle | 330 | 8 | 21.975 | 20 | 0 |
| idle | 345 | 8 | 21.875 | 20 | 0 |
| idle | 360 | 8 | 23.15 | 20 | 0 |
| idle | 375 | 8 | 21.6 | 20 | 0 |
| idle | 390 | 8 | 22.8 | 20 | 0 |
| idle | 405 | 8 | 21.5 | 20 | 0 |
| idle | 420 | 8 | 23.75 | 20 | 0 |
| idle | 435 | 8 | 22.55 | 20 | 0 |
| idle | 450 | 8 | 23.825 | 20 | 0 |
| idle | 465 | 8 | 22.2 | 20 | 0 |
| idle | 480 | 8 | 24 | 20 | 0 |
| idle | 495 | 8 | 23.875 | 20 | 0 |
| idle | 510 | 8 | 22.9 | 20 | 0 |
| idle | 525 | 8 | 22.575 | 20 | 0 |
| idle | 540 | 8 | 24.175 | 20 | 0 |
| idle | 555 | 8 | 22.825 | 20 | 0 |
| idle | 570 | 8 | 22.85 | 20 | 0 |
| idle | 585 | 8 | 23.175 | 20 | 0 |
| idle | 600 | 8 | 24.6 | 20 | 0 |
| idle | 615 | 8 | 23.15 | 20 | 0 |
| idle | 630 | 8 | 23.525 | 20 | 0 |
| idle | 645 | 8 | 24.375 | 20 | 0 |
| idle | 660 | 8 | 24.625 | 20 | 0 |
| idle | 675 | 8 | 24.375 | 20 | 0 |
| idle | 690 | 8 | 22.15 | 20 | 0 |
| idle | 705 | 8 | 23.225 | 20 | 0 |
| idle | 720 | 8 | 26.5 | 20 | 0 |
| idle | 735 | 8 | 24 | 20 | 0 |
| idle | 750 | 8 | 24.825 | 20 | 0 |
| idle | 765 | 8 | 24.05 | 20 | 0 |
| idle | 780 | 8 | 22.15 | 20 | 0 |
| idle | 795 | 8 | 24.55 | 20 | 0 |
| idle | 810 | 8 | 24 | 20 | 0 |
| idle | 825 | 8 | 22.85 | 20 | 0 |
| idle | 840 | 8 | 21.85 | 20 | 0 |
| idle | 855 | 8 | 23.425 | 20 | 0 |
| idle | 870 | 8 | 24.425 | 20 | 0 |
| idle | 885 | 8 | 24.2 | 20 | 0 |
| idle | 900 | 8 | 25.325 | 20 | 0 |
| idle | 0 | 0 | 22.225 | 20 | 0 |
| idle | 480 | 0 | 22.225 | 20 | 0 |
