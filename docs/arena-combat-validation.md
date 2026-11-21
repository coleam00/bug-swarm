# Drop-in fairness validation — issue #65

The current spawn and pacing rules supersede the historical #61 results below. Evidence for #65 is kept locally under `.evidence/65/` (gitignored), including raw per-seed JSON, Chrome captures, the validation driver, scratch homes/profiles and databases. The pull request summarizes that evidence.

## Rules and tuning

Join and respawn searches use 64 seeded candidates and a 16×16 grid inside the 450-unit world inset, choosing the greatest nearest-bug distance without overlapping living robots. Crowded spawns push bugs inside 300 units straight outward to 300 without kills, lost bug state or points. Two seconds of pale rotating spawn shimmer prevent contact damage; an emitted shot ends it early. Overheat/cooldown-blocked fire does not end it, and firing preserves independent damage immunity.

Each life accrues its own fractional spawn credits. The final piecewise-linear rate is **0.3/s at 0 s, 1.2/s at 60 s, 3/s at 120 s, 4/s at 240 s**, clamped thereafter. Starting values 0.4/1.2/2/3 produced 438.1 s fresh versus 253.7 s late aimer lives (57.9%), with some idle cohorts below 10 s. Lower opening pressure and stronger later pressure produced shorter fresh lives and the passing results below. Policies, seeds, populations and gates were unchanged.

Bugs spawn 600–900 units from the requesting player, outside every living player's conservative view plus 64 units. They remain shared and chase the nearest living player. Failed or capped requests are discarded, retaining only fractional credit, with persistent round-robin allocation after the last successful room slot. The live cap remains 150. Waves retain their first-step/30-second clock for future kinds/events and add no volume. The HUD shows wave and life m:ss, reset on respawn and frozen on death.

World drawing scales so the longest view dimension is at most 900 units; HUD and touch controls remain in CSS pixels and mouse aiming divides by the world scale. This permits enforceable off-screen placement without adding viewport reports to protocol v1. The 300-unit crowded fallback guarantees physical clearance, but cannot universally guarantee an empty screen.

## Seeded measurements

`bun run skill` retains the 20-seed, eight-bot, 180-second score benchmark:

| Policy | Median score | Median life seconds | Lives | Deaths | Cutoffs |
| --- | ---: | ---: | ---: | ---: | ---: |
| mover | 242 | 75.1 | 346 | 186 | 160 |
| aimer | 3472.5 | 145.55 | 246 | 86 | 160 |

Aimer/mover score ratio: **14.349×**, above 2×.

Newcomer trials pair seeds 0–19 and newcomer policy seeds, with one independent newcomer against eight continuously respawning aimers. Only the newcomer's first life enters the cohort. The common observation window is 600 seconds after joining. A cutoff is a censored lower bound, never a recorded death; both middle observations must be completed lives for an exact median. Inconclusive paired windows extend to 1200 then 1800 seconds and fail if still inconclusive. All medians below are exact; no extension was needed.

| Newcomer | Arena age at join, seconds | Incumbents | Median first life, seconds | Deaths / cutoffs |
| --- | ---: | ---: | ---: | ---: |
| aimer | 0 | 8 | 205.525 | 17 / 3 |
| aimer | 480 | 8 | 168.75 | 18 / 2 |
| idle | 0 | 8 | 47.05 | 20 / 0 |
| idle | 120 | 8 | 10.05 | 20 / 0 |
| idle | 300 | 8 | 10.35 | 20 / 0 |
| idle | 480 | 8 | 10.175 | 20 / 0 |
| idle | 900 | 8 | 10.45 | 20 / 0 |
| idle solo | 0 | 0 | 10.3 | 20 / 0 |
| idle solo | 480 | 0 | 10.3 | 20 / 0 |

Late/fresh survival: **82.107%**, above 80%. Every idle cohort exceeds 10 seconds. Raw observations and constants: `.evidence/65/skill-final.json`.

## Regression and simulation guards

The engine renderer mock records travelling shots and exact changing waves after interpolation delay. Independent mutations dropping shots and zeroing the wave both fail that test. A real RoomManager/LifeWriter/SQLite lifecycle stores literal score 37 and asserts 37 in pending/saved `life_over` and the database; a mutation storing 38 fails. Results are in `.evidence/65/mutation-results.json`.

Deterministic simulation guards cover repeated join/respawn inset and clearance, clustered/crowded placement, coincident pushes without score/state loss, protection boundaries and blocked/emitted fire, independent damage immunity, threat knots/integration by life age, reset/removal, wave independence, annulus/off-screen placement, capacity fairness and exhausted placement. View, engine and recording-canvas tests cover containment, centred spawns, scaled aiming, resize/DPR, independent touch ownership, shimmer and life-clock reset/freeze.

## Production Chrome, touch and capacity

Validated on Windows with Bun 1.4.2 and installed Chrome/Chromium **156.0.8078.4**, using built production assets, a server started on an ephemeral loopback port, and scratch data/home/profile directories inside `.evidence/65/`. The driver never changes arena state to obtain an opening. Eight real WebSocket aimers ran for 555 wall seconds, continuously respawning. Chrome joined with fresh browser storage after **9,825 simulation ticks / 491.25 simulation seconds**, at wave 17, with exactly eight incumbents. No extra probe joined the room.

Captures `spawn-0.png`, `spawn-0_5.png`, `spawn-1_5.png`, `spawn-5.png`, `spawn-10.png` and `spawn-30.png` show the opening and first 30 wall seconds. The initial robot is exactly at screen (640, 400) in 1280×800, with three hits, zero visible bugs and a visible shimmer. The next two captures, at life ages 0.8 and 1.8 seconds, still have no visible bugs and active shimmer. After the neutral opening, real CDP keyboard/mouse events move, aim and fire. The approximately 30-second capture is at authoritative life age 29.85 seconds, wave 18, **587 points and two hits remaining**. The opening, 30-second and touch captures were visually inspected.

Separate fresh contexts at **390×844 portrait** and **844×390 landscape** join the same busy arena while the eight bots remain connected. Spawn and simultaneous two-point touch captures show centred robots, readable HUDs and both sticks; outgoing inputs contain independent movement, aimed fire and `touch:true`. Neither layout overflows, and no browser errors were recorded. Files: `portrait-spawn.png`, `portrait-twin-sticks.png`, `landscape-spawn.png`, `landscape-twin-sticks.png`.

The existing developer fixture holds 20 players, 150 bugs, 140 travelling shots and 140 effect slots, using production rendering and the shared view helper with normal culling. Seven consecutive one-second windows per layout measured:

| Full-arena view | FPS | Update/draw ms per frame |
| --- | ---: | ---: |
| 1280×800 desktop | 60.0 | 0.980–1.070 |
| 390×844 portrait | 60.0 | 0.825–0.890 |
| 844×390 landscape | 60.0 | 0.867–1.072 |

Device scale factor was 1 with no CPU throttling. The readout measures CPU update/draw work, excluding later compositing. Browser flags include `--headless=new`, a scratch `--user-data-dir`, and disabled background timer/render throttling. Captures: `full-arena-desktop.png`, `full-arena-portrait.png`, `full-arena-landscape.png`.

The real bot CLI ran **200 aimers for 120 seconds across 10 rooms**: 200/200 joins, zero errors, tick p50 **0.718 ms**, tick p95 **1.228 ms**, scheduler lateness p95 **1.852 ms**. The eight-bot run also had zero errors, with tick p95 0.757 ms. Tick cost includes simulation, serialization and socket enqueueing. All 244 lives in the scratch database were finished, and every owned server/browser/bot was stopped. Full raw observations, frame windows, input messages and load results are in `.evidence/65/production-report.json`; driver and logs are beside it.

`bun run check` passed **573 tests, zero failures across 58 files**, including the real ephemeral-server integration tests. `bun run skill`, `bun run build`, targeted renderer/engine/SQLite/simulation tests, all three mutation probes and `git diff --check` passed. No dependency was added. The validation driver is `.evidence/65/validate.ts`, run with a scratch environment through `.evidence/65/run.ps1`; raw evidence remains gitignored under the repository's evidence policy. The bounded camera and conservative spawn rejection are the planned smallest implementation; viewport reports, spatial indexing, additional bug kinds and bosses remain outside this item.

---

# Historical arena combat validation — issue #61

Validated on Windows on 2026-11-20 with Bun 1.4.2 and headless Chrome/Chromium 156.0.8078.4. Production play used the Vite build and `createServer({port:0, hostname:'127.0.0.1'})`, private SQLite/home/profile directories, and two independent browser storage contexts. No existing listener or operator database was used. Every owned server, browser and bot was closed before its scratch directory was removed.

## Skill and final rules

`bun run skill` runs seeds 0–19 separately for each policy, with eight bots for exactly 3,600 steps / 180 simulation seconds. Policies have private RNG state; they never consume world randomness. Deaths respawn on the next measured step. Survivors at the horizon are included as cutoff-ended lives, matching shutdown persistence. Medians pool all lives, averaging the middle pair for an even count.

| Policy | Median score/life | Median life seconds | Lives | Deaths | Cutoffs |
| --- | ---: | ---: | ---: | ---: | ---: |
| mover | 236 | 67.825 | 366 | 206 | 160 |
| aimer | 869.5 | 133.95 | 242 | 82 | 160 |

The score ratio is **3.6843×**, above the positive-score **2×** gate. [Raw results](arena-combat-evidence/skill.json) include every seed and the complete constants. The fixed matrix and deterministic replay are regression tests. Mover wanders, dodges and fires along movement; aimer maintains distance, leads using target velocity and pauses at heat 12 until heat 3. Aimer only fires when an intercept lies within shot lifetime. Neither policy was weakened or given hidden simulation information to pass the gate.

No gameplay tuning was needed: requested starting and final values are identical.

| Constant | Initial = final |
| --- | ---: |
| Shot rate / speed / lifetime | 6/s / 900 units/s / 900 ms |
| Shot radius / muzzle offset | 3 / 25 |
| Heat gain / capacity / cooling | 1 / 18 / 6 per second |
| Overheat lockout / warning | 1,500 ms / 80% |
| Crawler speed / radius / health / value | 140 / 12 / 1 / 10 |
| Player speed / radius / hits / immunity | 180 / 14 / 3 / 1,000 ms |
| Wave interval / live bug cap / spawn clearance | 30,000 ms / 150 / 500 |
| Trickle | 0.5 bugs per living player per second |

Shots resolve swept relative-circle entry with stable id ties and creation order. Kills precede player contacts. Expiry/world exit counts one miss, resetting only future multipliers. A hit increases the multiplier before scoring: 11 + 12, then a miss and a hit gives 34 total. Lockout and new-shot travel retain fractional times; no catchup burst is banked. Contacts leave bugs alive. Third-hit death is immediate for this item; revives remain a later slice.

## Production Chrome and controls

Two `/arena` contexts joined as Pilot-A (desktop, Tabs) and Pilot-B (touch, Spaces), alongside **10 aimer WebSocket bots**. Actual CDP mouse/keyboard events aimed, fired, moved and respawned. Device emulation at 390×844 and 844×390 used `maxTouchPoints:2` and simultaneous `Input.dispatchTouchEvent` points. Captured outgoing input had nonzero movement, independently directed aim, held fire and `touch:true`. The driver captures both sticks early, while the phone life is active, and records the outgoing input and life state in [report.json](arena-combat-evidence/report.json). Both layouts had no horizontal overflow. The respawn button is 180×52 CSS pixels.

- [Mouse aim and travelling shots](arena-combat-evidence/desktop-aim-shots.png)
- [Visible kill burst and awarded points](arena-combat-evidence/kill-burst.png)
- [Overheated gun and heat bar](arena-combat-evidence/overheat.png)
- [Portrait twin sticks](arena-combat-evidence/portrait-twin-sticks.png), [landscape twin sticks](arena-combat-evidence/landscape-twin-sticks.png)
- [Life over with save status](arena-combat-evidence/life-over.png), [fresh-key respawn](arena-combat-evidence/respawn.png)
- [Full-room desktop](arena-combat-evidence/full-room-desktop.png), [full-room phone](arena-combat-evidence/full-room-phone.png)
- [Release 1 still playing at `/`](arena-combat-evidence/release-1.png)

Life-over transitions reported pending then saved results; shutdown checks counted all 233 admitted arena lives as finished. In-process failure injection additionally proves transactional rollback, finish recovery after a failed start, final retries, cache-failure isolation, high arena scores without review holds and HTTP refusal before either finish/retry path. A real ephemeral-server test proves both clients observe the travelling shot, kill score, terminal result and exactly one new life after duplicate respawn requests. Input tests cover stationary-cursor aim, independent fire sources, pointer crossing/cancellation, stale-life inputs and held-key/respawn-key protection through release.

## Frame and tick measurements

The final live full-room run used two browser clients and 18 aimer bots for 18 seconds, sampling seven consecutive one-second F-readout windows. The developer-only fixture holds 20 players, 150 bugs, 140 shots and 140 cosmetic pool slots, with normal culling enabled. It uses the production renderer through Vite, separately from production play. Its screenshot is [renderer-bounds.png](arena-combat-evidence/renderer-bounds.png).

| View | FPS range | Update/draw ms per frame |
| --- | ---: | ---: |
| Live desktop, 1280 x 800 | 60.0-60.0 | 0.255-0.372 |
| Live phone, 844 x 390 | 60.0-60.0 | 0.253-0.378 |
| Renderer bounds, 1280 x 800 | 60.0-60.0 | 1.120-2.032 |
| Renderer bounds, 390 x 844 | 60.0-60.0 | 0.770-0.941 |

The F readout measures combined client update/draw CPU work, excluding later compositing. Device scale factor was 1, with no CPU throttling. Browser flags: `--headless=new --no-sandbox --no-first-run --no-default-browser-check --remote-debugging-port=0 --user-data-dir=<scratch-profile> --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`. Chrome device emulation is evidence for this machine, rather than a physical-phone hardware claim.

| Population / measured duration | Joins / errors | Tick p50 / p95 ms | Scheduler lateness p95 ms |
| --- | ---: | ---: | ---: |
| Two browsers + 10 bots / 40 s | 10/10, 0 errors | 0.431 / 0.940 | 1.746 |
| Two browsers + 18 bots / 18 s | 18/18, 0 errors | 0.510 / 0.967 | 1.746 |
| 200 bots, 10 rooms / 120 s | 200/200, 0 errors | 0.691 / 1.176 | 1.712 |

The 200-bot run used the actual CLI in a separate Bun process for 120 seconds. Tick p95 includes simulation, snapshot serialization and socket enqueueing; scheduler lateness is reported separately. Full JSON snapshots and bounded scans meet the 10 ms tick gate, so no spatial index, delta protocol or persistence worker was added. [Raw browser, load and persistence report](arena-combat-evidence/report.json).

## Reproduction and checks

From the repository root:

```text
bun install --frozen-lockfile
bun run check
bun run skill
bun run build
bun docs/arena-combat-evidence/validate.ts
```

Set `CHROME_PATH` to your Chrome/Chromium executable before the last command. The [driver](arena-combat-evidence/validate.ts) creates its own loopback production server, private homes/data/profile, browser contexts and developer fixture server, and replaces the evidence files. It invokes the final load command itself against the origin it owns:

```text
bun run bots -- --url <owned-origin> --count 200 --seconds 120 --policy aimer
```

The interaction/full-room phases call the same bot runner with `(count:10, seconds:40)` and `(count:18, seconds:18)`, both aimer. Real-server tests also execute the CLI and both policies. The manual fixture route is `/scripts/arena-benchmark.html` on an owned Vite instance; it is excluded from the production build.

`bun run check` passed **547 tests, zero failures across 55 files**, including release 1. `bun run skill`, `bun run build`, focused real-server/SQLite/input tests and `git diff --check` passed. No new dependency was added. The final implementation keeps the planned bounded scans/full snapshots and between-tick writer; later bug kinds, revives, pickups and minimap remain out of scope.


## Returned-check repairs

The firing stream now retains its pending cooldown across releases, while still dropping overdue fire. A deterministic alternating-trigger regression reproduces the old 10-shot/s defect and checks that every 20-player snapshot remains within the projectile bound and passes the real parser. Held fire, fractional cadence, heat lockout/recovery, long-release resumption and respawn readiness remain covered.

New shots and bugs now become visible on the existing delayed interpolation timeline, eliminating the latest-position fallback that rewound newly arriving entities. The arrival test covers receipt times, between-snapshot frames, both entity kinds, removal and reset. The analogous remote-player join fallback predates this change and remains outside this repair.

The returned coverage gaps now have observable behavioral guards: mouse and simultaneous touch events pass through the real bindings; a teammate sits on the projectile path; unequal crawler distances oppose id ordering; waves scale with two living players and one dead player and use both spawn regions; actual wave/bug state reaches room snapshots; respawn clears an attacker; simulation duration reaches SQLite; and touch activates the React life-over control. The skill matrix derives participant count and player-seconds from recorded lives and verifies distinct seeds, eight players and 180 seconds. Policy tests exercise dodging and retreat, and the WebSocket bot test inspects distinct outgoing policy inputs rather than an echoed option. Recording-canvas tests cover proportional heat, warning and immunity phases, and changing HUD numbers without exact decorative wording or layout.

The ineffective real-server stale-input duplicate was removed; the deterministic lifecycle guard remains. Other production paths inspected for the same faults (nearest-target policy selection, wave placement/scaling, safe spawning, duration persistence, and input forwarding) required stronger tests rather than implementation changes. All 23 targeted mutation probes were rejected: [mutation results](arena-combat-evidence/fix-mutations.json). The corrected skill result is 869.5 versus 236 points (3.6843x), with unchanged life medians and no constant tuning.


## Combat timeline and phone-boundary repair

The previous arrival repair delayed births but still removed entities using the latest snapshot. That mixed timeline hid projectiles that hit before the 100 ms delay elapsed. Combat now derives births, motion, removals and kill effects from one monotonic delayed view. Historical membership preserves one- and two-snapshot shots; their final interval uses the last observed velocity until the removal tick. Kill bursts use that tick and the same frame timestamp, so feedback neither precedes the travelling shot nor misses its first display frame. Tests run the actual simulation against nearby crawlers, count visible shot frames, verify monotonic travel, delayed matching removal/effect delivery, deduplication and reset, and retain the original no-reversal regression. The pre-existing remote-player arrival fallback is unchanged.

The camera now reserves bounded space outside the world (112 units horizontally, 144 above and 64 below) so the HUD cannot cover the local robot and the name, outward barrel and heat bar remain on-screen. Gameplay/world bounds are unchanged. Recording-canvas tests cover both phone orientations, four aim directions, every edge and every corner (64 poses). Production Chrome additionally uses controlled positions/heat/immunity on our owned server, then real movement and held-fire keys to reach each boundary. These layout-only setup mutations run after the frame measurement; the geometry observer records actual camera/HUD rectangles without affecting the performance samples.

Boundary screenshots: [portrait north](arena-combat-evidence/portrait-north-boundary.png), [east](arena-combat-evidence/portrait-east-boundary.png), [south](arena-combat-evidence/portrait-south-boundary.png), [west](arena-combat-evidence/portrait-west-boundary.png); [landscape north](arena-combat-evidence/landscape-north-boundary.png), [east](arena-combat-evidence/landscape-east-boundary.png), [south](arena-combat-evidence/landscape-south-boundary.png), [west](arena-combat-evidence/landscape-west-boundary.png). Raw boundary positions and clearances are included in report.json.

The renderer now guards nonzero local/remote barrel angles and a streak above the displayed multiplier cap with distinct HUD values. Aggregate and per-seed skill summaries share a tested helper whose odd/even fixture has independently known score and duration medians. All eight targeted mutations were rejected: [timeline/layout/summary mutation results](arena-combat-evidence/timeline-fix-mutations.json). The original cooldown, controls, scoring, life persistence and skill gates remain intact.
