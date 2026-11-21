# Pickup validation — issue 79

This delivery includes **spread, rapid and shield**. Spread fires three shots in a 20-degree fan for eight seconds. Rapid multiplies volley cadence by 1.8 and halves heat per projectile for eight seconds. Shield blocks one eligible hit or expires after twenty seconds. Weapon effects combine; each kind refreshes its own deadline without stacking. Spread retains the ordinary heat cost per projectile; rapid halves that cost, including spread pellets. A final volley clamps heat to capacity before lockout.

All evidence, scratch homes, temporary files, databases and browser profiles stay under `.evidence/79/`. Run `bun run build` then `bun scripts/validate-pickups.ts` (`CHROME_PATH` can select Chrome). The driver starts its own ephemeral loopback production server and closes all owned clients, servers and processes. It exposes no debug endpoint.

## Host return: merge the landed hive

Merged main `dae2344` into the existing pickup branch. The hive's fifth-wave scheduling, arrival safety, brood/rings, contribution ledger, historical life rewards, HUD and tests are preserved alongside all three pickups, cached artwork and the recording-canvas repair. Hive body/ring damage uses the shared shield-aware damage helper. Hive kills retain their shared reward and do not roll the ordinary-bug pickup stream; the four specified drop rates are unchanged.

The JSON merge preserves maximum health and ring deadlines as named hive fields, and appends life-specific rewards to compact event tuples. Both compact tick-age and main's absolute-tick event rows decode before validation. Binary extensions retain the same fields. Maximum fixtures now include 24 globs, a hive, twenty-recipient rewards, six pickups, all three effects, large entity ids and every downed/out population split across the shared 660 shot/impact budget. The largest measured legacy packet is **62,281 bytes**, leaving **3,255 bytes** below the unchanged cap (`host-return/payload.json`). Both transports round-trip the combined state.

The merged hive health bar initially covered the pickup timer icons. Icons now move below that bar while a hive is visible; a renderer regression checks all three rings against the bar and minimap at desktop, 390 px portrait and phone landscape. The previous distinct-colour, cached glow/geometry, expiry/refresh and no-per-frame-gradient checks remain intact.

`bun run check` passes TypeScript and **547 tests across 70 files**, including the twenty-seed score gate, first-life idle probes, both real-client transports, hive reward persistence and pickup behavior (`host-return/check-final.log`). The production build passes (`host-return/build.log`). The full skill/fairness sweeps and performance numbers in the older sections below describe their recorded pre-hive pickup revisions; they are historical evidence, not a complete sweep of this merged simulation.

Two new independent warmed Chrome comparisons at 1280 by 800 add the hive and its twenty-recipient award animation to the full fixture, with 24 globs and the existing 660 shot/cosmetic slots. Each launch repeats the same ABBA procedure below. **All 80 samples remain 60 FPS**. `frames-HS4R3w` measured off/on median draw **2.219/2.381 ms** (added 0.163 ms); `frames-Gj3WJ5` measured **2.173/2.317 ms** (added 0.144 ms). No measured samples were discarded. The reports, per-block screenshots and `host-return/frame-summary.json` retain the raw measurements.

Fresh production evidence is `production-MKtX5b/`, driven by the checkout-local `host-return/production.ts`. Two independent browser contexts plus eighteen bots repeat every kind's floor/active, refresh/expiry, shield consumption and simultaneous touch scenes. The additional `hive-all-pickups-{desktop,portrait,landscape}.png` captures and authoritative `hiveWithPickups` snapshot show all three icons below the hive bar, clear of the minimap. Screenshots were inspected; browser error/overflow assertions pass. The subsequent actual CLI uses **145 seconds**, covering the fifth-wave boundary: **200 players throughout ten arenas**, no premature disconnects or errors, tick p50/p95/max **1.419/3.753/8.533 ms** over 28,351 samples. `bots.stderr.log` records the 145-second arguments and `bots.json` records the complete measured window; the copied driver's progress label still says 120 seconds. All owned browsers, bots, servers and databases closed afterward.

## Recording-canvas fixture repair

The shared recording canvas now clears retained artwork, the current path and saved context state when either dimension is assigned, including same-size and zero assignments. Drawing styles and transforms return to defaults. Two fixture tests cover both dimensions. Existing pickup assertions still inspect the retained sprites actually blitted; the allowance for fully transparent achromatic gradient endpoints is unchanged.

The reported initialization-order mutation was reproduced only in scratch: moving pickup canvas sizing after painting passed all five presentation tests with the old fixture, but fails four with the repaired fixture. Correctly initialized artwork passes all five. Other cached-canvas producers were audited and already size before painting. No production code changed.

Evidence is in `.evidence/79/fixture-return/`: `mutation-before.log` and `mutation-after.log` record the expected mutation results; `web.log` records all 101 web tests passing. `bun run check` passes TypeScript and **523 tests across 68 files** (`check-final.log`), and the production build passes (`build.log`). The earlier production browser, full skill and warmed frame comparisons below remain applicable and were not rerun for this test-only repair.

## Owner send-back: current main and cached artwork

Merged current main (`afeaba9`) in `7c637f6`, preserving the existing beetle, spitter and compact-snapshot integration, personal-level HUD, copy polish and console views. The import conflict retained both pickup drawing and personal levels; the new main HUD fixture now supplies the required pickup collection. No shared arena simulation, policy, timing, drop chance or transport code changed in this return, so the complete skill/fairness observations below remain applicable.

The repeated desktop slowdown prompted caching the **complete** artwork, rather than only its glow. `pickups/assets.ts` creates three small canvases per kind at renderer construction: combined floor glow/glyph, robot overlay, and static HUD icon/background. Frame hooks blit them and draw only the changing HUD timer arc. Spread/rapid rotate their cached overlay with facing; shield remains world-aligned. No pickup frame hook creates gradients or retraces static glyph/barrel/bubble paths.

Appearance tests inspect the paint inside the sprites actually blitted, including world transforms and blink opacity. Existing distinct-colour, per-kind geometry, glyph-presence, glow, timer and culling guards remain; floor/robot hooks must produce a single blit and attempts to create gradients after initialization fail. Fully transparent gradient endpoints may be achromatic; visible grey still fails the colour guard. `bun run check` passed TypeScript and all **521 tests across 67 files** (`send-back/check.log`); final focused renderer tests passed 19 tests (`send-back/focused-final.log`), and the production build passed (`send-back/build.log`).

Fresh production Chrome evidence is `production-ACXoWx/`: two independent contexts plus eighteen bots, all three floor and active effects, refresh/expiry, shield consumption, portrait/landscape and simultaneous touch input. The merged HUD displays personal levels. Screenshots were inspected for readable cached glyphs, correct barrel facing, bubbles and HUD rings. The initial room samples included cold-start 53.3 FPS desktop / 57.4 portrait; all seven subsequent samples were 60 FPS, with update/draw cost 0.223–0.696 ms desktop and 0.237–0.567 ms portrait. The warmed maximum-arena comparisons below are the desktop performance gate.

After those scenes closed, the actual 200-bot CLI ran for 120 seconds on the owned server: **200 players throughout, ten arenas, zero errors, p50/p95 tick 1.399/2.881 ms**, scheduler lateness p95 2.851 ms. The busiest client averaged **34.975 KB/s**, below the unchanged 40 KB/s gate; byte cross-check difference was about 0.0011%. See `production-ACXoWx/bots.json` and `report.json`. All owned browsers, sockets, servers and databases closed. Earlier measurements and full skill observations are retained below; the new warmed results supersede earlier desktop performance claims.

## Returned findings and coverage

The original shield-only scope was incomplete; both missing kinds now have their own shared definition, procedural drawing factory and simulation tests. The acceptance test requires all three catalog entries, and seeded successful drops must be able to deliver all three. Shared collection, cleanup, parser and bot tests exercise every kind. The audit followed each catalog entry through collection, expiry, both transports, delayed interpolation, robot drawing, HUD and policy observations; these paths deliver all three kinds. The drop-rate oracle specifies the required 2%, 6%, 6%, 15% independently of production configuration.

The engine fixture now carries a real visible pickup through delayed interpolation into drawing. Presentation tests require floor and HUD glyph paints, actual robot-overlay dispatch, timer depletion/refresh/removal, blinking, glow culling and resource caching for all three kinds. They identify the timer by location and arc depletion rather than an arbitrary shade. The random-stream test retains deterministic replay, independence from spawning and floor-cap behavior without reproducing the seed initializer.

The appearance-coverage repair checks the bubble, fanned barrels and highlighted rapid barrel through actual renderer dispatch. It also requires distinguishable colours across kinds, matching floor/HUD/glow hues, and fading radial-gradient paint on the cached surface actually drawn. These checks allow shade and geometry changes rather than fixing exact colours or vertices. Nine appearance faults fail focused tests, including the returned wrong-factory, duplicate-colour and unpainted-glow mutations; three harmless shade/geometry variants pass (`presentation-return/mutations.json`). All mutations were restored. This repair changes tests only; production and skill measurements below were retained, not rerun.

The repaired safety net was mutation-tested (`mutations-integrated.json`): dasher drops at 60%, dropped engine pickup delivery, dropped robot-overlay dispatch, shield-only drop selection, missing glyphs for any kind, wrong rapid cadence and wrong spread angle all fail relevant tests. Shade-only and seed-salt-only changes pass. All mutations were restored before normal validation.

Pure fixed-step tests cover effect behavior, independent duration/refresh, combined firing, per-projectile heat, expiry restoring ordinary fire and heat-cap transitions. Existing shield protection/immunity, downing/revival, floor cap, exact floor expiry and first-touch tests remain in place. Real-server tests verify both clients observe one collection winner and receive the combined boosted fan through legacy JSON and negotiated binary transport. The merge with main retains spitter emission/interception, protection precedence and downing timing; shield blocks eligible acid globs, and pickup seeking checks the proposed route against those globs.

Pickup-seeking safety was tuned from 200/150 units of player/route clearance to **350/300**, retaining the aimer's normal separation while taking detours. Effect strengths, durations and all drop chances remain at the specified values. The first integrated full replay passed score and every idle cohort but failed newcomer fairness (310.475 s fresh, 204.900 s late, 66.0%); its complete observations remain in `skill-integrated-report.json`. Before beetles landed, independent twenty-seed fresh/late probes compared 300/250 (inconclusive because fresh survival was censored) with the selected 350/300 (205.375 s fresh, at least 600 s late, passing). Raw probes are in `safety-300-250/newcomers.json` and `safety-350-300/newcomers.json`; the complete passing pre-beetle replay is `skill-final-report.json`.

The final merge retains main's armoured beetles, shell bounces and flanking policy. Bounces do not roll drops; lethal rear hits do, using the specified 15% rate. Shield blocks beetle contact, and committed flanks take priority over pickup detours. The merged twenty-seed newcomer probe passes with exact medians of 219.675 s fresh and 189.725 s late (`safety-beetle/newcomers.json`). Final full-replay results are recorded below.

## Projectile and transport bounds

Combined spread/rapid permits at most `20 * (ceil(10.8 * 0.9) + 1) * 3 = 660` projectiles including an arriving volley. A consumed projectile becomes an impact event, so live shots and step impacts share that 660-record budget. Rendering still permits its bounded 660-slot cosmetic pool alongside current shots.

Browsers and bots retain main's negotiated binary keyframes/deltas; pickups use a bounded collection and effects use the player extension cell. Legacy JSON uses compact combat tuples to retain the **65,536-byte** limit at combined weapon bounds. Shot records carry a packet-local owner index, explicit life, position, velocity and birth age; events carry tick age; bug records retain kind, movement, health, facing and optional phase state. Large safe-integer entity ids use a shared base. Decoding restores and validates the same named objects used by all consumers. JSON retains three-decimal movement precision; binary precision remains as documented in architecture.md. Malformed lengths, references, ages, ids and shared-budget violations are tested.

The completed payload fixtures include all three effects on twenty active players, six mixed floor pickups, 150 bugs with phased spitter/dasher maxima and mixed beetle/bounce variants, twelve acid globs, every shot/impact mixture sampled at its bounds, every downed/out population split, terminal results and ids near `Number.MAX_SAFE_INTEGER`. Both formats round-trip below the unchanged cap. Maximum measured legacy size is **59,047 bytes**, leaving **6,489 bytes** (`payload-beetle.json`). The twenty-player combined-weapon simulation also round-trips live snapshots while exercising overheat and expiry.

## Production Chrome and touch

Chrome **157.0.8103.51** ran two independent storage contexts plus eighteen aimer bots in one arena. Evidence is `.evidence/79/production-SBqUxQ/`, with authoritative snapshots and assertions in `report.json`.

- `natural-drop-observer-moved.png` records a naturally rolled drop from bot combat; only the protected observer was repositioned for framing.
- `desktop-floor-and-spawn-arcs.png`, the paired `desktop-floor-blink-*.png`, `desktop-active.png`, `desktop-draining-hud.png`, `desktop-refreshed.png` and `desktop-consumed.png` cover shield glow, final-three-second blinking, bubble, ring, refresh and consumption.
- `spread-desktop-floor.png`, `spread-portrait-floor.png`, `spread-desktop-active.png`, `spread-portrait-active.png` and `spread-landscape-twin-sticks.png` show the blue fan glyph, three travelling shots, fanned barrels and draining ring.
- The corresponding `rapid-*.png` captures show the rose lightning glyph, faster shots, hot barrel with bright vents and draining ring.
- Both weapon kinds also have `*-refreshed.png` and `*-expired.png`, with authoritative deadline snapshots. Expiry waits through the actual eight-second deadline; contact immunity prevents an enemy hit from clearing the effect prematurely during that controlled observation.
- Phone layouts are 390×844 and 844×390. Every kind was exercised with simultaneous touch movement and aiming/firing. Both contexts reported no overflow or console errors. Screenshots were inspected for glyph readability, robot effects, timer visibility and HUD/minimap/stick overlap.

Controlled visual stages clear nearby threats and move the evidence bots away between collections. Natural combat and load measurements use ordinary play. The floor selection chances, effect deadlines and actual movement/firing paths are unchanged by the evidence harness.

## Full-arena rendering cost

The fixture retains twenty robots with all three effects, 150 bugs (including twelve swelling spitters and ten armoured beetles), twelve globs, 660 shots, a 660-slot cosmetic pool and six mixed floor pickups. The grid keeps all 660 shot/effect positions inside the world and desktop view. `bun scripts/validate-pickup-frames.ts` now makes this comparison reproducible: one 1280×800 renderer warms for twelve seconds, then runs off/on/on/off twice with four seconds to settle each transition and five fresh one-second samples per block. It asserts populations and rejects **any** measured sample below 59 FPS. It does not reload the page or run competing fixtures. Every raw sample and one screenshot per block are retained.

| Independent Chrome launch | Pickups | Samples | FPS, every sample | Draw ms, range | Median ms |
| --- | --- | --- | --- | --- | --- |
| `frames-kLkZUz` | Off | 20 | 60 | 1.810–2.569 | 2.031 |
| `frames-kLkZUz` | On | 20 | 60 | 1.973–2.390 | 2.148 |
| `frames-48f3jF` | Off | 20 | 60 | 1.962–3.438 | 2.688 |
| `frames-48f3jF` | On | 20 | 60 | 2.697–4.207 | 3.062 |

Both complete comparisons passed: **all 80 samples held 60 FPS**, forty with pickups and forty without. Median added draw cost was about 0.117 ms and 0.375 ms respectively; variation between launches is retained rather than averaged away. Normal Chrome rendering configuration is used, with no forced software rendering and no concurrent validation jobs. Full reports are `.evidence/79/frames-kLkZUz/report.json` and `frames-48f3jF/report.json`; aggregate data is `send-back/frame-summary.json`. An initial launcher attempt failed before opening its debugging port and produced no frame measurements; its log is retained in `send-back/frames-first.log`. The profile layout was corrected to match the working production driver.

The fresh production driver also measured all three viewport sizes at 60 FPS in every maximum-fixture sample: desktop pickups-on 1.875–2.192 ms/frame, portrait 1.523–1.922, landscape 1.782–1.995. Earlier `production-SBqUxQ/`, `renderer-final-F6LzMY/` and software-only `production-AgmAIs/` reports remain historical evidence; their optimistic desktop claims were superseded after review reproduced drops.

## Previous server load (retained)

After visual clients and renderer fixtures closed, the driver ran the actual CLI in a separate process:

`bun run bots -- --url <owned-production-origin> --count 200 --seconds 120 --policy aimer`

All **200 clients joined across ten arenas**, with **zero errors**. The complete 120-second window retained 200 players throughout and 23,414 tick samples: **p50 1.317 ms, p95 2.635 ms**, passing the unchanged p95 <10 ms gate. Scheduler lateness p95 was 2.718 ms. Message rates were approximately 3,855 sent/s and 3,902 received/s. Client/server byte counts differed by 0.0033% across the sampling boundaries; the busiest client averaged **35.396 KB/s**, below main's 40 KB/s gate. See `production-SBqUxQ/bots.json`, `bots.stderr.log` and `report.json`. All owned servers, sockets, Chrome processes and databases closed afterward.

## Checks, skill and fairness

After the appearance-coverage repair, `bun run check` passed TypeScript and all **516 tests across 65 files** (`presentation-return/check.log`). The preceding 515-test delivery passed Linux and Windows CI. Focused integration tests passed 103 tests (`beetle-focused.log`); the final armour payload cases also pass (`protocol-beetle-final.log`). Production build passed (`build-beetle.log`).

The complete `bun run skill` command finished successfully. Raw output: `.evidence/79/skill-beetle.json`; normalized UTF-8 report with every observation: `skill-beetle-report.json`; aggregate cohort data: `skill-beetle-summary.json`.

| Policy | Median score | Median life (s) | Lives | Deaths | Horizon cutoffs |
| --- | --- | --- | --- | --- | --- |
| mover | 224 | 67.85 | 353 | 193 | 160 |
| aimer | 2514 | 86.5 | 293 | 133 | 160 |

Aimer/mover score ratio: **11.223×**, passing the unchanged ≥2× gate with positive medians over 20 seeds, eight bots and 180 seconds. Fresh aimer newcomer median: **219.675 s**; 480-second joins: **189.725 s**, or **86.366%** of fresh survival (required ≥80%). Comparison: **pass**, observation horizon 600 seconds.

All 61 busy-arena idle join ages (0–900 seconds in 15-second increments), plus both solo controls, pass the unchanged ten-second median gate. Lowest idle median: **20.975 s**. Each cohort below has 20 independent newcomer observations; deaths are completed first lives, cutoffs are censored survivors at the horizon. A ≥ median denotes a censored lower bound.

| Policy | Join age (s) | Incumbents | Median life (s) | Deaths | Cutoffs |
| --- | --- | --- | --- | --- | --- |
| aimer | 0 | 8 | 219.675 | 17 | 3 |
| aimer | 480 | 8 | 189.725 | 15 | 5 |
| idle | 0 | 8 | 36.525 | 20 | 0 |
| idle | 15 | 8 | 21.75 | 20 | 0 |
| idle | 30 | 8 | 24.675 | 20 | 0 |
| idle | 45 | 8 | 20.975 | 20 | 0 |
| idle | 60 | 8 | 21.75 | 20 | 0 |
| idle | 75 | 8 | 22.45 | 20 | 0 |
| idle | 90 | 8 | 21.575 | 20 | 0 |
| idle | 105 | 8 | 21.125 | 20 | 0 |
| idle | 120 | 8 | 21.55 | 20 | 0 |
| idle | 135 | 8 | 21.725 | 20 | 0 |
| idle | 150 | 8 | 22.625 | 20 | 0 |
| idle | 165 | 8 | 21.375 | 20 | 0 |
| idle | 180 | 8 | 21.75 | 20 | 0 |
| idle | 195 | 8 | 22.175 | 20 | 0 |
| idle | 210 | 8 | 22.125 | 20 | 0 |
| idle | 225 | 8 | 23.025 | 20 | 0 |
| idle | 240 | 8 | 21.925 | 20 | 0 |
| idle | 255 | 8 | 21.825 | 20 | 0 |
| idle | 270 | 8 | 22.2 | 20 | 0 |
| idle | 285 | 8 | 21.9 | 20 | 0 |
| idle | 300 | 8 | 22.05 | 20 | 0 |
| idle | 315 | 8 | 21.75 | 20 | 0 |
| idle | 330 | 8 | 22 | 20 | 0 |
| idle | 345 | 8 | 21.925 | 20 | 0 |
| idle | 360 | 8 | 21.825 | 20 | 0 |
| idle | 375 | 8 | 21.85 | 20 | 0 |
| idle | 390 | 8 | 22.9 | 20 | 0 |
| idle | 405 | 8 | 21.95 | 20 | 0 |
| idle | 420 | 8 | 21.975 | 20 | 0 |
| idle | 435 | 8 | 22.825 | 20 | 0 |
| idle | 450 | 8 | 22.3 | 20 | 0 |
| idle | 465 | 8 | 22.25 | 20 | 0 |
| idle | 480 | 8 | 22.225 | 20 | 0 |
| idle | 495 | 8 | 21.925 | 20 | 0 |
| idle | 510 | 8 | 22.525 | 20 | 0 |
| idle | 525 | 8 | 21.9 | 20 | 0 |
| idle | 540 | 8 | 21.625 | 20 | 0 |
| idle | 555 | 8 | 21.65 | 20 | 0 |
| idle | 570 | 8 | 22.125 | 20 | 0 |
| idle | 585 | 8 | 22.225 | 20 | 0 |
| idle | 600 | 8 | 23.25 | 20 | 0 |
| idle | 615 | 8 | 22.125 | 20 | 0 |
| idle | 630 | 8 | 22.35 | 20 | 0 |
| idle | 645 | 8 | 21.975 | 20 | 0 |
| idle | 660 | 8 | 21.95 | 20 | 0 |
| idle | 675 | 8 | 22.075 | 20 | 0 |
| idle | 690 | 8 | 23.4 | 20 | 0 |
| idle | 705 | 8 | 22.625 | 20 | 0 |
| idle | 720 | 8 | 22.125 | 20 | 0 |
| idle | 735 | 8 | 22.175 | 20 | 0 |
| idle | 750 | 8 | 22 | 20 | 0 |
| idle | 765 | 8 | 22.075 | 20 | 0 |
| idle | 780 | 8 | 23.775 | 20 | 0 |
| idle | 795 | 8 | 22.175 | 20 | 0 |
| idle | 810 | 8 | 22.475 | 20 | 0 |
| idle | 825 | 8 | 24.025 | 20 | 0 |
| idle | 840 | 8 | 22.6 | 20 | 0 |
| idle | 855 | 8 | 22.325 | 20 | 0 |
| idle | 870 | 8 | 23.7 | 20 | 0 |
| idle | 885 | 8 | 22.25 | 20 | 0 |
| idle | 900 | 8 | 22.35 | 20 | 0 |
| idle | 0 | 0 | 22.225 | 20 | 0 |
| idle | 480 | 0 | 22.225 | 20 | 0 |
