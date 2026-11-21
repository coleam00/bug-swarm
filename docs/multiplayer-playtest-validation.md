# Multiplayer browser playtest validation — item 86

Factory Chrome `157.0.8103.51`, Windows, headless with GPU enabled by default. All servers, databases, homes, Chrome profiles and artifacts were isolated inside this checkout. No browser player sent protocol messages or modified game state; desktop actors used WASD, mouse aiming and Space bursts, and phone actors used concurrent two-point touch.

`bun run playtest` passed in **196.57 seconds**, including build, Chrome startup and cleanup. Reports and screenshots: `.evidence/86/playtest/9759ecce/`.

| Scenario | Result | Seconds | Live server tick p95 (ms) |
| --- | --- | ---: | ---: |
| together | pass | 19.12 | 1.531 |
| combat | pass | 89.19 | 1.680 |
| revive | pass | 34.98 | 0.962 |
| late-join | pass | 15.44 | 2.560 |
| phone-desktop | pass | 23.15 | 1.062 |
| restart | pass | 12.77 | 0.927 |
| boss | explicit skip: no registered boss | 0.00 | — |

Combat includes an A-only kill visibly painted by B, then a full 60-second fight, positive scores for both combat players, natural life expiry, independently verified SQLite results, exact best/standing/next-gap text, matching `/board` rows and fresh-input respawn. Life-over remains standing-only. Revive uses ordinary damage and keyboard approach, records all three screens at downed/meter/active checkpoints and verifies the rescuer's exact 50-point reward after subtracting combat points. Late-join advances 6,000 ordinary bot-only ticks before admitting humans, verifies admission-time spawn clearance and centering, and observes ten uninterrupted real seconds of survival. Restart verifies final frozen runs, one finish each, automatic rejoin and working input. The existing UI truthfully displays `Score saved: <score>. Rejoining...` during graceful restart; the harness also accepts `Reconnecting...`.

The focused `bun run playtest -- --scenario phone-desktop --bots 16` passed in **24.22 seconds** with **20 participants** on every page. It additionally requires both phone twin sticks simultaneously alongside desktop firing, changed aim, shots painted by peers, authoritative touch attribution and screenshots with the F timing readout. Evidence: `.evidence/86/playtest/a5f28427/` (including `twin-sticks-PilotC.png` and `twin-sticks-PilotD.png`).

| Page | Viewport | Mean FPS | Mean frame cost (ms) | Frame-cost p95 (ms) |
| --- | --- | ---: | ---: | ---: |
| PilotA | desktop 1280×720 | 59.92 | 0.501 | 0.642 |
| PilotB | desktop 1280×720 | 59.87 | 0.530 | 0.677 |
| PilotC | touch 844×390 | 60.03 | 0.486 | 0.688 |
| PilotD | touch 390×844 | 60.02 | 0.535 | 0.667 |

Live server tick p95 was **2.401 ms**. These are total instrumented frame/tick costs with a full player population, rather than a separately measured overhead delta or a maximum-entity renderer benchmark. Accelerated setup is excluded from live tick timing. The ordinary production build contains none of `__arenaDebug`, `reviveRing`, `receivedAt` or `observedAt`; its build manifest has no playtest marker. Observation allocation/recording runs only in the explicitly instrumented build.

Harness tests cover interpolation and tolerance boundaries, membership, painted colours/minimap/HUD, score/life/status mismatches, missing effects and their deadline, frozen/stale frames, restart generations, incomplete history, results and ordered boards. Startup/path tests cover instrumentation guards, ephemeral real-server sockets, junction escapes, fresh output folders, missing-Chrome failure reports, and bot-only warm-up equivalence including respawns. `bun run check` passed **479 tests**; `bun run build` and the normal-bundle exclusion check passed. Focused reports `.evidence/86/playtest/712790c1/` (restart) and `.evidence/86/playtest/9b6b6b6a/` (phone/desktop) also pass with the final generation-history reset and independent interpolation-timing checks.

Reviewed screenshots include the shared kill on B, saved life-over standing, downed/revive progression, both phone orientations/twin sticks, board pages and every reconnecting screen. Raw failed development attempts remain under `.evidence/86/playtest/` for diagnosis; the two run IDs above identify the passing acceptance evidence.
