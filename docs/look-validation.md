# Procedural look validation

The renderer uses Canvas 2D commands only. The full rectangular world's grid and vignette, glows and score glyph are cached on detached canvases; actors and legs are drawn procedurally. Base beetles are coral; fast beetles are smaller, bright gold and have a quicker gait, selected through `BUG_STYLES[bug.kind]`. Collision dimensions and all simulation rules remain those merged from main in #10. No image assets, rendering dependencies or upgrade visuals are added.

## Evidence required by the owner

The [issue #7 owner ruling](https://github.com/coleam00/bug-swarm/issues/7) accepts this PR's benchmark on the factory desktop in Chrome, including headless Chrome, plus the operator's browser check before merge. No laptop or phone measurement is required for this item. The owner plays on real devices after deploy.

## Repeat the measurement

Install with `bun install --frozen-lockfile`, then start Vite alone:

```sh
bunx vite --host 127.0.0.1 --port 5191 --strictPort
```

Open `http://127.0.0.1:5191/scripts/look-benchmark.html`. No API or database is needed; the page does not create runs or submit scores. Keep the viewport and DPR fixed during measurement. Reload to repeat. Use `?burst` for saturation. The page warms for 10 seconds, then records 60 seconds and displays its JSON report; `window.lookBenchmark.result` exposes the same report. `window.lookBenchmark.dispose()` stops it and releases its backing stores.

The fixture samples the screen-shaped world once at start and replenishes to 150 bugs before every draw, mixing one fast bug per four fixture spawns. It records minimum/maximum total and fast-bug counts and the world dimensions. It moves the robot continuously, maintains normal auto-fire plus one fixture shot every 200 ms, and forces a contact every two seconds. Burst mode adds 300 squash effects every second, exceeding both particle and label capacity. Fixture work is timed separately from production fixed-step/feedback/FX update and rendering. The initial RAF timestamp is excluded from the interval count. Lowest rolling FPS uses consecutive windows of at least one second. Timing resolution can round short fixture work to zero.

## Recorded environment and results

2026-11-19: Windows 11 Home 10.0.26200, ASUS desktop, AMD Ryzen 9 7950X3D, RTX 3090 host; automated headless Chrome for Testing 159.0.8154.6. Viewport 1280 x 720 CSS pixels, device/render DPR 1, 800 x 450 logical world, RAF scheduling approximately 60 Hz. Each case used 10 seconds of warmup and a separate 60-second sample. Browser profiles, home and application data were scratch directories. The project checks finished before measurement; no parallel benchmark or project-check workload ran during these samples.

| Case | Mean FPS | Lowest rolling FPS | Completed frame intervals | Bugs at every draw | Fast bugs (min-max) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 59.999 | 59.994 | 3600 | 150 | 24-46 |
| Burst | 59.999 | 59.988 | 3600 | 150 | 22-39 |

| Case | Update mean / p95 (ms) | Draw mean / p95 (ms) | Fixture mean / p95 (ms) | Peak particles / trails / labels |
| --- | ---: | ---: | ---: | ---: |
| Normal | 0.055 / 0.200 | 0.632 / 1.000 | 0.002 / 0.000 | 29 / 6 / 6 |
| Burst | 0.061 / 0.200 | 0.968 / 1.700 | 0.004 / 0.000 | 1024 / 6 / 256 |

Both samples cover 60.001 seconds. Burst mode reaches the fixed particle/label caps without growing storage. No page errors occurred.

These are measured browser timings from real RAF intervals, not synthetic timestamps. They are the desktop evidence specified by the owner; they do not predict device throughput on other hardware.

## Correctness and visual review

- `bun run check`: TypeScript and all 104 tests pass (12,143 assertions). `bun run build` passes; the benchmark is not a production entry point.
- Pool tests cover fixed storage identity, caps/drop-on-full, expiry, reuse, reset, displaced particles, rising text and bounded nonzero shake. Feedback tests distinguish both kinds' shot squashes from contacts, invulnerable contacts, simultaneous kills/hits, shot-before-contact, same-step spawn kills, kills on different catch-up steps, overflow and terminal-hit decay. Three seeded 3,600-step sequences in portrait, landscape and square worlds compare the complete observed and unobserved simulation after every step.
- Renderer tests retain the prior feature and cache coverage and verify rectangular grid/vignette backing paints, world clipping, independent expected pixel bounds, edge labels, rotation, same-canvas world replacement on restart, and the fast kind's smaller bright shell and quicker gait. Engine coverage retains actual feedback wiring, expiry after death, steering, focus resets and screen-shaped restarts.
- The previous test repair exercised 22 destructive mutations, all rejected by their relevant tests, while allowing sharing a cached warm glow. That mutation campaign was on the earlier renderer; the updated rectangular/kind integration is covered by the tests above.

The latest test-only repair retains radial circle geometry and the creation transform in the canvas fixture. Existing assertions sample opacity inside the cache surface and painted bounds: glow centres/inner areas must be visible and fade toward the corners; the vignette must leave the centre clear while darkening sides and corners in every world shape. Animated leg strokes require opacity and floor contrast for both kinds. Bun's built-in colour parser replaces the limited custom parser, accepting equivalent CSS colours such as HSL white. All 16 destructive mutations failed, including off-surface, oversized/tiny and displaced-paint glows, oversized/corner-only vignettes and invisible or camouflaged legs. Four harmless controls each passed the full check: HSL white, modest gradient tuning, equivalent gradient/paint transforms, and combined leg-colour/zero-blur/six-particle tuning. The count-independent particle assertions and consolidated Pool contract remain intact. Production rendering, simulation and effects are unchanged from `f2abea0`; browser timings, heap profiling and the operator's own browser check were not repeated by this test repair.

Automated Chrome checks at 390 x 844 portrait and 844 x 390 landscape (DPR 2) inspected the full grid/vignette, both beetle silhouettes/colours, glowing robot, streaks, bursts and labels. Portrait and landscape fixtures each contained 37 fast bugs during capture. Rotating the portrait run preserved its 450 x 800 world; restarting in landscape adopted 800 x 450. A 320 x 180 scene retained bold readable labels. Touch drag, keyboard movement, hit/squash feedback, terminal-hit expiry and immediate restart completed with no page errors. Application API calls were fulfilled by fixtures, with no API server or operator database used.

Screenshots and raw benchmark JSON are retained in the task scratch directory for local review. The operator's browser check before merge is the normal next review step specified by the owner; these automated checks do not claim to be that human check.

## Allocation evidence and limits

All pool storage and feedback scratch slots are allocated at construction; update and emission code creates no arrays, objects, strings or callbacks and never grows its storage. Tests verify storage identity through repeated emissions/updates/resets. Saturation occupancy is recorded above; pool capacities remain 1024 particles, 128 trails and 256 labels.

Historical Chrome allocation sampling at a 512-byte interval, with collected objects included, exercised the same warmed function for 100,000 iterations of squash/trail/hit/update using fractional timestamps. One warmed sample attributed no allocations to FX functions; another attributed approximately 109 KB to `advance`/`Pool.update`. Sampling includes runtime optimization/boxing effects and is not proof of literally zero V8 heap allocations. The fixed-capacity and no-explicit-allocation guarantees are structural and tested. Pool/coordinator runtime code is unchanged by this rectangular-world integration.
