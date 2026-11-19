# Procedural look validation

The renderer uses Canvas 2D commands only. The arena, glows and score glyph are cached on detached canvases; actors and legs are drawn procedurally. No image assets or rendering dependencies are added. Upgrade visuals and the fast gameplay kind remain separate items.

## Repeat the measurement

Install with `bun install --frozen-lockfile`, then start Vite alone:

```sh
bunx vite --host 127.0.0.1 --port 5187 --strictPort
```

Open `http://127.0.0.1:5187/scripts/look-benchmark.html` in a foreground Chrome tab. No API or database is needed; the page does not create runs or submit scores. Keep the viewport and DPR fixed during measurement. Reload to repeat. Use `?burst` for saturation. The page warms for 10 seconds, then records 60 seconds and displays its JSON report; `window.lookBenchmark.result` exposes the same report. `window.lookBenchmark.dispose()` stops it and releases its backing stores.

The fixture replenishes to 150 bugs before every draw, moves the robot continuously, maintains normal auto-fire plus one fixture shot every 200 ms, and forces a contact every two seconds. Burst mode adds 300 squash effects every second, exceeding both particle and label capacity. Fixture work is timed separately from production fixed-step/feedback/FX update and rendering. The initial RAF timestamp is excluded from the interval count. Lowest rolling FPS uses consecutive windows of at least one second. Timing resolution can round short fixture work to zero.

For acceptance on a laptop and mid-range phone, record model, OS, current Chrome version, CSS viewport, device/render DPR, display refresh rate and both reports. The normal laptop sample must sustain at least 58 FPS. Phone emulation is useful for layout only.

## Recorded environment

2026-11-19: Windows 11 Home 10.0.26200, ASUS desktop, AMD Ryzen 9 7950X3D, RTX 3090 host; automated headless Chrome for Testing 159.0.8154.6. Viewport 1280 x 720 CSS pixels, device/render DPR 1, RAF scheduling approximately 60 Hz. Each case used 10 seconds of warmup and a separate 60-second sample. Browser profiles, home and application data were scratch directories; application API calls during UI checks were fulfilled with fixtures. No running API or operator database was used.

This is a desktop headless measurement, not a physical laptop or phone result, nor current stable Chrome certification. The physical-device performance acceptance criteria remain unverified. Headless scheduling and compositing do not establish foreground device throughput.

| Case | Mean FPS | Lowest rolling FPS | Completed frame intervals | Bugs at every draw |
| --- | ---: | ---: | ---: | ---: |
| Normal | 59.982 | 58.994 | 3599 | 150 |
| Burst | 59.999 | 59.988 | 3600 | 150 |

| Case | Update mean / p95 (ms) | Draw mean / p95 (ms) | Fixture mean / p95 (ms) | Peak particles / trails / labels |
| --- | ---: | ---: | ---: | ---: |
| Normal | 0.057 / 0.200 | 0.749 / 1.400 | 0.003 / 0.000 | 29 / 6 / 6 |
| Burst | 0.047 / 0.200 | 0.941 / 1.800 | 0.004 / 0.000 | 1024 / 6 / 256 |

Both samples cover 60.001 seconds of real RAF intervals. These are measured browser timings, not synthetic timestamps. The final normal sample overlapped the required project checks near its start.

## Correctness and visual review

- `bun run check`: TypeScript and all 79 tests pass (11,673 assertions). `bun run build` passes; the benchmark is not a production entry point.
- Pool tests cover fixed storage identity, caps/drop-on-full, expiry, reuse and reset. Feedback tests distinguish shot squashes from contacts, invulnerable contacts, simultaneous kills/hits, shot-before-contact, same-step spawn kills, five catch-up steps, overflow and terminal-hit decay. Three seeded 3,600-step sequences compare the entire observed simulation against the unobserved simulation after every step.
- Browser review at 390 x 844 portrait and 844 x 390 landscape (DPR 2) inspected grid/vignette, rounded glowing robot, beetle facing and legs, shot glow, bursts and bold labels. Touch drag, keyboard movement, rotation, hit flash/shake, third-hit termination and immediate keyboard restart ran without page errors. These are emulated viewport checks, not physical touch-device validation.
- Screenshots of normal portrait/landscape, the full swarm, simultaneous hit/squash and a 320 x 180 stream-sized scene were captured to the task scratch directory for local review. Rendering remains clipped to the fixed arena while the HUD and pointer mapping stay fixed. The small scene retained readable score labels.

### Returned-check repairs

The follow-up changes tests and the recording canvas fixture only; production rendering, effects and simulation remain unchanged from `87451ac`. Catch-up coverage now arranges kills on different fixed steps. Motion assertions require nonzero bounded shake, rising text and displaced, spreading particles. The engine wiring test observes effects passed to the real renderer, including advancement and expiry after the terminal hit. Recorded paints cover the grid/vignette, chassis/core, facing and leg animation, velocity-aligned shots, trails, particles, labels, flash and world-only shake. Cache checks allow any initial cache count while requiring reuse, replacement and disposal.

All 22 destructive mutations tested fail their relevant tests: first-step-only observation; stationary shake/text/particles; disconnected feedback; frozen updates (including only after death); independently missing floor, vignette, facing, gait, shots, trails, particles, labels, flash, rendered shake, chassis, core glow or bright core; a leaked beetle context stack; and per-object shadow blur. Sharing the warm shot glow with particles still passes. Existing pool limits/reuse/expiry, deterministic simulation, input and lifecycle checks remain green. Mutation sources were restored before the final check/build.

No new device performance result was obtained during this repair. The available host reports desktop chassis type 3 and no battery, and no physical laptop environment is connected. A foreground Chrome report from a physical laptop is still required; the desktop figures above must not be used to mark that acceptance criterion complete.

## Allocation evidence and limits

All pool storage and feedback scratch slots are allocated at construction; update and emission code creates no arrays, objects, strings or callbacks and never grows its storage. Tests verify storage identity through repeated emissions/updates/resets. Saturation hits the 1024-particle and 256-label caps without growing them; trail capacity stays 128.

Chrome allocation sampling at a 512-byte interval, with collected objects included, exercised the same warmed function for 100,000 iterations of squash/trail/hit/update using fractional timestamps. One warmed sample attributed no allocations to FX functions; another attributed approximately 109 KB to `advance`/`Pool.update`. Sampling includes runtime optimization/boxing effects and is not proof of literally zero V8 heap allocations. The fixed-capacity and no-explicit-allocation guarantees are structural and tested; stronger runtime allocation evidence remains a limitation. Raw JSON reports and heap profiles were retained in the task scratch directory.
