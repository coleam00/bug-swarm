# Multiplayer browser playtest validation — item 86

Factory Chrome `157.0.8103.51`, Windows, headless with GPU enabled by default. Servers, databases, homes, Chrome profiles and artifacts are isolated inside the checkout. Players use keyboard/mouse or simultaneous two-point touch; they do not send protocol messages or modify game state.

## Returned-check validation

The corrected combat scenario credits **60 seconds with both actors active and receiving fresh browser input**. Every five credited seconds requires repeated aim dispatches, observed fire and authoritative shots from each actor. Downed time, saved-result validation and UI respawn earn no time. Ended browser lives are independently checked against SQLite and rendered results before respawning. The report retains the twelve activity windows. A fixture replacing 50 seconds with idle/dead players fails.

Revive now prepares all browser pages before admitting humans, keeps guards near the casualty, waits for the rescuer's gun to cool before approaching and continues normal defensive bursts during contact. Three independent runs of the final plan passed without retries. Every page painted the downed body, positive meter and active body, retaining the same life/run/score. The duplicated exact-reward calculation was removed; deterministic simulation tests protect that rule.

These are focused invocations, each using `bun run playtest -- --scenario <name> --out .evidence/86/returned/<run>`. The factory runs the whole suite; it was not rerun as one command during this correction.

| Scenario | Passing run | Scenario seconds | Live tick p95 (ms) |
| --- | --- | ---: | ---: |
| together | `together-2` | 17.43 | 2.151 |
| combat | `combat-3` | 106.27 | 2.000 |
| revive | `revive-8`, `revive-9`, `revive-10` | 31.58 / 32.29 / 31.57 | 1.350 / 1.272 / 1.228 |
| late-join | `late-join-1` | 18.39 | 3.453 |
| phone-desktop | `phone-desktop-2` | 24.39 | 0.940 |
| restart | `restart-1` | 21.79 | 1.354 |

Together includes ten bots. Late-join includes eight bots, 6,000 ordinary warm-up ticks, admission clearance/centering and ten seconds of uninterrupted survival with observed movement and firing. Phone-desktop covers 1280×720 desktop, 844×390 touch and 390×844 touch concurrently. Restart checks saved lives, automatic rejoin and working input. Boss detection/explicit absence skip is unchanged. Life-over stays standing-only; top-10 agreement remains on `/board`.

Negative probes retained under `.evidence/86/returned/` demonstrate that:

- Stopping robot painting after five seconds fails continuous agreement (`probes-3/probe-missing-robots/run/`), while fixtures allow off-screen and out players to be unpainted.
- Removing FPS/frame-time accumulation fails report completeness (`.evidence/86/fps-mut/`). Every participating page now requires finite paired measurements before a pass.
- Constructing the observation hook unconditionally fails the actual built/served production-client test (`probe-production-hook/`). The same test joins through browser input and requires a completed observation in the explicitly instrumented client.
- Deleting the snapshot-age condition fails the repaired fixture, whose interpolation and positions are otherwise valid (`probe-snapshot-age/`).

The opt-in configuration test passed ten repetitions with one bounded child per test and a deadline longer than that child's timeout. Cold `Page.enable` startup has its own 15-second bound and recorded duration; ordinary commands and frame/snapshot freshness limits remain unchanged. Screenshots inspected include the latest combat, revive meter and portrait twin sticks. Failed development attempts are retained alongside passing reports.

## Performance and limits

Paired measurements from the passing four-browser phone run:

| Page | Mean FPS | Mean frame cost (ms) | Frame-cost p95 (ms) |
| --- | ---: | ---: | ---: |
| PilotA | 59.97 | 0.255 | 0.343 |
| PilotB | 60.05 | 0.251 | 0.325 |
| PilotC | 60.01 | 0.237 | 0.339 |
| PilotD | 60.02 | 0.243 | 0.352 |

The optional `phone-desktop --bots 16` stress invocation (`phone-desktop-1`) **failed**, correctly retaining an invalid reconstructed-snapshot error from bot-02. Before that failure, 108 samples per page measured mean FPS 59.86–60.03, mean frame cost 0.659–0.838 ms and frame-cost p95 0.933–1.135 ms with 20 participants; live tick p95 was 2.755 ms. These diagnostic measurements are not a passing stress result. They measure total instrumented costs, not a separate overhead delta or maximum-entity benchmark.

A separate failed rescue development run captured an authoritative player heat of 18.7 while the protocol caps heat at 18 (`rejected-snapshot.json`, reproduced by `replay-snapshots.ts`). The existing combat simulation can overshoot the cap when held fire resumes after partial cooling. Gameplay/codec code is unchanged by this correction; snapshot and freshness assertions remain strict. The stress run's rejected frame was not captured, so its cause is not established.

Harness fixtures cover viewport membership, interpolation/tolerance boundaries, status/life/score, effects, freshness, restart generations, incomplete history, saved results and ordered boards. Startup/path/warm-up tests remain in place. Normal production assets exclude observation code; actual production-client exclusion is exercised by `bun run check` in addition to bundle inspection.

`bun run check` passed **487 tests** across 66 files (138.53 seconds), including type checking. `bun run build` passed; emitted JavaScript contains none of `__arenaDebug`, `reviveRing`, `receivedAt` or `observedAt`, and the normal build manifest has no playtest marker. Logs are in `.evidence/86/returned/check/` and `.evidence/86/returned/build/`.

## Screenshot evidence follow-up

Scenario completion now requires a screenshot reference for every arena player and verifies that **every referenced capture**, including board pages and later key moments, is a nonempty regular file. Missing evidence fails the report after cleanup. Existing performance checks and the explicit boss skip are preserved.

The screenshot fixture fakes only the CDP response and exercises the actual browser capture writer. It accepts complete captures and rejects missing player coverage, missing files, zero-byte files and directory paths. Removing only the screenshot file write fails both this fixture and the real `together` scenario with `Missing screenshot file`; the mutated scenario lists eight captures but produces zero PNGs. Restoring the writer passes `together` in 22.1 scenario seconds with all eight nonempty PNGs, and `boss` still skips explicitly. Evidence is in `.evidence/86/ssfix/` (`unit-errors.log`, `mutant/`, `passing/`, `boss/`). The shared-movement screenshot was visually inspected.

For this follow-up, `bun run check` passed **488 tests** across 66 files, including type checking (184.24 seconds), and `bun run build` passed. Logs are in `.evidence/86/ssfix/check/` and `.evidence/86/ssfix/build/`. The full browser suite remains the factory's check; this correction ran the relevant focused scenarios.
