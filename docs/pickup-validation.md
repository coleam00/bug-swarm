# Pickup validation — issue 79

This delivery includes **spread, rapid and shield**. Spread fires three shots in a 20-degree fan for eight seconds. Rapid multiplies volley cadence by 1.8 and halves heat per projectile for eight seconds. Shield blocks one eligible hit or expires after twenty seconds. Weapon effects combine; each kind refreshes its own deadline without stacking. Spread retains the ordinary heat cost per projectile; rapid halves that cost, including spread pellets. A final volley clamps heat to capacity before lockout.

All evidence, scratch homes, temporary files, databases and browser profiles stay under `.evidence/79/`. Run `bun run build` then `bun scripts/validate-pickups.ts` (`CHROME_PATH` can select Chrome). The driver starts its own ephemeral loopback production server and closes all owned clients, servers and processes. It exposes no debug endpoint.

## Returned findings and coverage

The original shield-only scope was incomplete; both missing kinds now have their own shared definition, procedural drawing factory and simulation tests. The acceptance test requires all three catalog entries, and seeded successful drops must be able to deliver all three. Shared collection, cleanup, parser and bot tests exercise every kind. The drop-rate oracle specifies the required 2%, 6%, 6%, 15% independently of production configuration.

The engine fixture now carries a real visible pickup through delayed interpolation into drawing. Presentation tests require floor and HUD glyph paints, actual robot-overlay dispatch, timer depletion/refresh/removal, blinking, glow culling and resource caching for all three kinds. They identify the timer by location and arc depletion rather than an arbitrary shade. The random-stream test retains deterministic replay, independence from spawning and floor-cap behavior without reproducing the seed initializer.

The repaired safety net was mutation-tested (`mutations-repair.json`): dasher drops at 60%, dropped engine pickup delivery, dropped robot-overlay dispatch, shield-only drop selection, missing glyphs for any kind, wrong rapid cadence and wrong spread angle all fail relevant tests. Shade-only and seed-salt-only changes pass. All mutations were restored before normal validation.

Pure fixed-step tests cover effect behavior, independent duration/refresh, combined firing, per-projectile heat, expiry restoring ordinary fire and heat-cap transitions. Existing shield protection/immunity, downing/revival, floor cap, exact floor expiry and first-touch tests remain in place. Real-server tests verify both clients observe one collection winner and receive the combined boosted fan through the new transport.

## Projectile and transport bounds

Combined spread/rapid permits at most `20 * (ceil(10.8 * 0.9) + 1) * 3 = 660` projectiles including an arriving volley. A consumed projectile becomes an impact event, so live shots and step impacts share that 660-record budget. Rendering still permits its bounded 660-slot cosmetic pool alongside current shots.

To retain the existing **65,536-byte** limit, serialization uses compact combat tuples. Shot records carry a packet-local owner index, explicit life, position, velocity and birth age; events carry tick age; bug records retain kind, movement, health, facing and optional phase state. Decoding validates bounds and restores the same named objects used by rendering, bots and simulation. Three-decimal wire precision and protocol v1's coordinated build-id reload deployment remain unchanged. Malformed tuple lengths, references, ages and shared-budget violations are tested.

The completed payload fixture includes all three effects on twenty active players, six mixed floor pickups, every shot/impact mixture sampled at its bounds, every downed/out population split and terminal results. Maximum measured size is **56,239 bytes**, leaving **9,297 bytes** below the cap (`payload.json`). The twenty-player combined-weapon simulation also round-trips live snapshots while exercising overheat and expiry.

## Production Chrome and touch

Chrome **157.0.8103.51** ran two independent storage contexts plus eighteen aimer bots in one arena. Evidence is `.evidence/79/production-XWjwZ7/`, with authoritative snapshots and assertions in `report.json`.

- `natural-drop-observer-moved.png` records a naturally rolled drop from bot combat; only the protected observer was repositioned for framing.
- `desktop-floor-and-spawn-arcs.png`, the paired `desktop-floor-blink-*.png`, `desktop-active.png`, `desktop-draining-hud.png`, `desktop-refreshed.png` and `desktop-consumed.png` cover shield glow, final-three-second blinking, bubble, ring, refresh and consumption.
- `spread-desktop-floor.png`, `spread-portrait-floor.png`, `spread-desktop-active.png`, `spread-portrait-active.png` and `spread-landscape-twin-sticks.png` show the blue fan glyph, three travelling shots, fanned barrels and draining ring.
- The corresponding `rapid-*.png` captures show the rose lightning glyph, faster shots, hot barrel with bright vents and draining ring.
- Both weapon kinds also have `*-refreshed.png` and `*-expired.png`, with authoritative deadline snapshots. Expiry waits through the actual eight-second deadline; contact immunity prevents an enemy hit from clearing the effect prematurely during that controlled observation.
- Phone layouts are 390×844 and 844×390. Every kind was exercised with simultaneous touch movement and aiming/firing. Both contexts reported no overflow or console errors. Screenshots were inspected for glyph readability, robot effects, timer visibility and HUD/minimap/stick overlap.

Controlled visual stages clear nearby threats and move the evidence bots away between collections. Natural combat and load measurements use ordinary play. The floor selection chances, effect deadlines and actual movement/firing paths are unchanged by the evidence harness.

## Full-arena rendering cost

The expanded developer fixture includes twenty robots with all three effects, 150 bugs, 660 shots, the 660-slot hit/kill pool and six mixed floor pickups. `?baseline` keeps the same combat pressure while removing pickup effects. Four one-second samples per viewport:

| Viewport | Baseline FPS | All pickups FPS | Baseline ms/frame | All pickups ms/frame |
| --- | --- | --- | --- | --- |
| 1280×800 | 60 | 60 | 1.426–1.657 | 1.690–1.755 |
| 390×844 | 60 | 60 | 1.210–1.503 | 1.534–1.652 |
| 844×390 | 60 | 60 | 1.321–1.490 | 1.798–2.052 |

The largest measured fixture draw cost was 2.052 ms/frame, with every sampled window at 60 FPS. Approximate median additions were 0.29 ms desktop, 0.29 ms portrait and 0.40 ms landscape. Floor glows are cached; robot effects use bounded strokes/fills. Raw samples and benchmark screenshots remain in the report. This run competed with skill computation on the shared factory machine.

## Server load

After visual clients and renderer fixtures closed, the driver ran the actual CLI in a separate process:

`bun run bots -- --url <owned-production-origin> --count 200 --seconds 120 --policy aimer`

All **200 clients joined across ten arenas**, with **zero errors**. The final 60-second window had 11,781 tick samples: **p50 1.042 ms, p95 1.799 ms**, passing the unchanged p95 <10 ms gate. Scheduler lateness p95 was 1.896 ms. Message rates were approximately 3,180 sent/s and 3,900 received/s. See `production-XWjwZ7/bots.json`, `bots.stderr.log` and `report.json`. All owned servers, sockets, Chrome processes and databases were closed afterward.

## Checks, skill and fairness

`bun run check` passed TypeScript and all **441 tests across 59 files** (`check-repair-final.log`). Focused pickup tests also pass after extending shield/weapon coexistence and downing cleanup assertions.

The complete `bun run skill` command finished successfully. Raw output: `.evidence/79/skill-repair.json`; normalized UTF-8 report with every observation: `skill-repair-report.json`; aggregate cohort data: `skill-repair-summary.json`.

| Policy | Median score | Median life (s) | Lives | Deaths | Horizon cutoffs |
| --- | --- | --- | --- | --- | --- |
| mover | 239 | 83.175 | 312 | 152 | 160 |
| aimer | 3284 | 92.1 | 269 | 109 | 160 |

Aimer/mover score ratio: **13.741×**, passing the unchanged ≥2× gate with positive medians over 20 seeds, eight bots and 180 seconds. Fresh aimer newcomer median: **232.925 s**; 480-second joins: **386.975 s**, or **166.137%** of fresh survival (required ≥80%). Comparison: **pass**, observation horizon 600 seconds.

All 61 busy-arena idle join ages (0–900 seconds in 15-second increments), plus both solo controls, pass the unchanged ten-second median gate. Lowest idle median: **21.175 s**. Each cohort below has 20 independent newcomer observations; deaths are completed first lives, cutoffs are censored survivors at the horizon. A ≥ median denotes a censored lower bound.

| Policy | Join age (s) | Incumbents | Median life (s) | Deaths | Cutoffs |
| --- | --- | --- | --- | --- | --- |
| aimer | 0 | 8 | 232.925 | 15 | 5 |
| aimer | 480 | 8 | 386.975 | 14 | 6 |
| idle | 0 | 8 | 29.975 | 20 | 0 |
| idle | 15 | 8 | 22.875 | 20 | 0 |
| idle | 30 | 8 | 27 | 20 | 0 |
| idle | 45 | 8 | 21.75 | 20 | 0 |
| idle | 60 | 8 | 21.65 | 20 | 0 |
| idle | 75 | 8 | 21.85 | 20 | 0 |
| idle | 90 | 8 | 21.9 | 20 | 0 |
| idle | 105 | 8 | 22.05 | 20 | 0 |
| idle | 120 | 8 | 21.425 | 20 | 0 |
| idle | 135 | 8 | 22.75 | 20 | 0 |
| idle | 150 | 8 | 21.675 | 20 | 0 |
| idle | 165 | 8 | 21.8 | 20 | 0 |
| idle | 180 | 8 | 22.15 | 20 | 0 |
| idle | 195 | 8 | 21.175 | 20 | 0 |
| idle | 210 | 8 | 22.375 | 20 | 0 |
| idle | 225 | 8 | 21.45 | 20 | 0 |
| idle | 240 | 8 | 21.95 | 20 | 0 |
| idle | 255 | 8 | 22.8 | 20 | 0 |
| idle | 270 | 8 | 21.95 | 20 | 0 |
| idle | 285 | 8 | 21.6 | 20 | 0 |
| idle | 300 | 8 | 21.825 | 20 | 0 |
| idle | 315 | 8 | 22.3 | 20 | 0 |
| idle | 330 | 8 | 22 | 20 | 0 |
| idle | 345 | 8 | 21.7 | 20 | 0 |
| idle | 360 | 8 | 21.95 | 20 | 0 |
| idle | 375 | 8 | 21.425 | 20 | 0 |
| idle | 390 | 8 | 21.95 | 20 | 0 |
| idle | 405 | 8 | 23.475 | 20 | 0 |
| idle | 420 | 8 | 21.6 | 20 | 0 |
| idle | 435 | 8 | 22 | 20 | 0 |
| idle | 450 | 8 | 21.875 | 20 | 0 |
| idle | 465 | 8 | 22.1 | 20 | 0 |
| idle | 480 | 8 | 22.825 | 20 | 0 |
| idle | 495 | 8 | 22.15 | 20 | 0 |
| idle | 510 | 8 | 23.125 | 20 | 0 |
| idle | 525 | 8 | 21.475 | 20 | 0 |
| idle | 540 | 8 | 22.9 | 20 | 0 |
| idle | 555 | 8 | 21.625 | 20 | 0 |
| idle | 570 | 8 | 21.325 | 20 | 0 |
| idle | 585 | 8 | 22 | 20 | 0 |
| idle | 600 | 8 | 23.925 | 20 | 0 |
| idle | 615 | 8 | 21.425 | 20 | 0 |
| idle | 630 | 8 | 23.875 | 20 | 0 |
| idle | 645 | 8 | 21.9 | 20 | 0 |
| idle | 660 | 8 | 23.075 | 20 | 0 |
| idle | 675 | 8 | 22.1 | 20 | 0 |
| idle | 690 | 8 | 23.725 | 20 | 0 |
| idle | 705 | 8 | 23.125 | 20 | 0 |
| idle | 720 | 8 | 22.325 | 20 | 0 |
| idle | 735 | 8 | 22.6 | 20 | 0 |
| idle | 750 | 8 | 22.85 | 20 | 0 |
| idle | 765 | 8 | 22.05 | 20 | 0 |
| idle | 780 | 8 | 22.8 | 20 | 0 |
| idle | 795 | 8 | 23.025 | 20 | 0 |
| idle | 810 | 8 | 23.675 | 20 | 0 |
| idle | 825 | 8 | 22.275 | 20 | 0 |
| idle | 840 | 8 | 21.825 | 20 | 0 |
| idle | 855 | 8 | 23.55 | 20 | 0 |
| idle | 870 | 8 | 23.75 | 20 | 0 |
| idle | 885 | 8 | 22.3 | 20 | 0 |
| idle | 900 | 8 | 22.175 | 20 | 0 |
| idle | 0 | 0 | 22.225 | 20 | 0 |
| idle | 480 | 0 | 22.275 | 20 | 0 |