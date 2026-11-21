# Edge arrows and hive warning validation (issue 91)

The renderer gives Help and Hive markers shared slots below the HUD/minimap. It measures the full arrow/label envelope once at 16px bold, leaves an 8px viewport inset and 8px between occupied bounds, and uses inward lanes when an edge fills. Slot geometry is cached by viewport and top clearance. Marker/occupancy storage and insertion sorting are reused, bounded by 21 markers and 441 cells. Triangles point from their final anchors to delayed combat targets.

The warning uses authoritative snapshot ticks and encounter scheduling, independently of personal level, animation and delayed combat positions. Exactly 10,000ms remaining is hidden; 9,950ms displays `10s`. The first scheduled boundary retains `0s` at tick 2400, and tick 2401 establishes spawning. Arrival phases use their authoritative deadline and retain the warning until activation. An active hive suppresses warnings for encounters it prevents. Active/downed clients see the canvas banner; out clients see its noninteractive DOM equivalent above Life over. Visibility/second changes publish from snapshot handling, with clearing on restart, disconnect and disposal.

## Reproduce

Run `bun run check`, `bun run skill`, `bun run build`, then `bun scripts/validate-edge-markers.ts`. The Chrome harness starts its own loopback server on an ephemeral port with an isolated database, browser contexts, profile and scratch home under `.evidence/91/`. It closes its servers and Chrome when finished. `--fixtures-only` reruns the crowded-marker screenshots and frame measurements without waiting for the live schedule. Set `CHROME_PATH` if Chrome is elsewhere.

For project commands in an isolated validation shell, point HOME/USERPROFILE and TEMP/TMP/TMPDIR at directories inside `.evidence/91/` first. The harness supplies its own Chrome directories. No production debug route or gameplay/transport change is used.

## Evidence on factory Chrome

Chrome 157.0.8103.51, Bun 1.4.2, Windows. Final live, controlled arrival, crowded-marker and frame evidence: `.evidence/91/chrome-BK13Sh/`. All PNGs and JSON reports remain gitignored in this checkout.

- Natural clock: two isolated identities and 18 aiming bots share one 20-player arena for 60 seconds. A third identity joins during the scheduled warning and immediately sees `The hive is coming 9s`. The original out players see the same countdown above Life over in portrait and landscape. Natural arrival occurs at tick 2401/wave 5; activation removes the warning.
- Controlled scenes (explicit fixtures): scheduled warning and downed arrival at 1280x720, 390x844 and 844x390, followed by activation without the banner. `*-controlled-readable-arrows.png` places 19 Help markers and Hive toward the same edge in all three viewports. Separate `*-full-arena-crowded-arrows.png` fixtures retain 20 players, 150 bugs, 140 shots, 24 globs, combat effects and the F readout.
- Two-point Chrome touch in both phone orientations moves and fires simultaneously, with no horizontal overflow or browser application errors.
- Each full-arena viewport supplies seven steady-state one-second frame samples after resize warmup. All final samples report 60.0 FPS. Median/max measured client frame cost: desktop 1.149/1.285ms, portrait 0.945/1.033ms, landscape 0.992/1.035ms. The marker search adds bounded local drawing work and no server work.
- CLI bot tick p95: 2.754ms (1181 samples, 20 connected players throughout), below 10ms. The CLI passes with exit 0, zero drops/errors, zero premature disconnects and zero scheduler skips.

Earlier attempts with browser rate-limit bursts and a CDP context-creation timeout are retained. The final complete run passes using one context across benchmark resizes.

## Automated validation

`bun run check`: 493 tests pass, including geometry, warning boundaries, renderer, engine callback lifecycle and React Life over coverage. Existing health, awards, ring, projection and canvas-state tests pass. `bun run build` passes. Full skill results are recorded after completion in the pull request and `.evidence/91/skill.log`.
