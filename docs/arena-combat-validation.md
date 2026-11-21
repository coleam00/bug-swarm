# Drop-in fairness validation — issue #65

The current rules and measurements include the returned-check correction. Evidence stays inside this checkout under `.evidence/65/` (gitignored), with scratch homes, profiles and databases; the pull request summarizes it.

## Rules and correction

Join and respawn searches use 64 seeded candidates and a 16×16 grid inside the 450-unit world inset, choosing the greatest nearest-bug distance without overlapping living robots. Crowded spawns push bugs inside 300 units straight outward to 300 without kills, lost bug state or points. Two seconds of rotating spawn shimmer prevent contact damage; an emitted shot ends it early. Blocked fire does not end it, and firing preserves independent one-second damage immunity.

The returned checks found a transient pressure peak between the original five sampled ages: unchanged 20-seed idle cohorts at ages 90/150/180 seconds died at medians **8.4 / 9.85 / 9.625 seconds**. This was reproduced in `returned-baseline.json`. Rate-only tuning moved that peak to another age, so birth placement now prefers outer arena regions: sample 32 seeded annulus candidates, choose the valid point farthest from the world centre, and use the same preference in the bounded 192-point fallback if necessary. All births still lie 600–900 units from the requesting player, in bounds, at least 500 from living players and outside every conservative view plus 64 units. This leaves interior openings while bugs still chase the nearest living player.

The final life-age rate is **0.1/s at 0 s, 4/s at 60 s, 5/s at 120 s, 6/s at 240 s**, linearly interpolated and clamped. Stronger later pressure keeps aimed lives short while the reduced opening and outer-region placement give newcomers room. Policies, seeds, populations and thresholds were unchanged. Each life owns its credits; blocked requests discard whole credit, successful allocations rotate through room slots, and the live cap remains 150. Waves retain the 30-second event clock without volume bursts. World view remains bounded to 900 units; HUD/touch stay in CSS pixels, scaled aiming remains correct, and the life clock resets/freezes with the authoritative life.

## Seeded measurements

`bun run skill` passed. The unchanged 20-seed, eight-bot, 180-second score benchmark reports:

| Policy | Median score | Median life seconds | Lives | Deaths | Cutoffs |
| --- | ---: | ---: | ---: | ---: | ---: |
| mover | 222 | 90 | 300 | 140 | 160 |
| aimer | 2178 | 75.85 | 349 | 189 | 160 |

Aimer/mover score ratio: **9.811×**, above 2×. The independent newcomer trials observe exactly one first life per seed against eight continuously respawning aimers, with paired world/newcomer seeds. Fresh/late medians are **123.625 / 114.75 seconds**, or **92.821%**, above 80%. Both medians are exact; two fresh and one late lives are censored at the common 600-second horizon. No extension was needed; inconclusive comparisons would extend both windows to 1200/1800 seconds and fail if still inconclusive.

The idle gate now covers **61 ages, every 15 seconds from 0 through 900**, plus the two solo controls. Together with the aimer pair this is **65 cohorts / 1,300 first-life observations**. Every idle cohort passes: the lowest busy-room median is **11 seconds at arena age 135 seconds**. The returned 90/150/180-second cases now reach **11.675 / 11.975 / 11.7 seconds**. All idle medians are exact. Selected cohorts are below; every observation and final constant is printed in `returned-skill-final.json`.

| Newcomer | Join age, seconds | Incumbents | Median first life, seconds | Deaths / cutoffs |
| --- | ---: | ---: | ---: | ---: |
| aimer | 0 | 8 | 123.625 | 18 / 2 |
| aimer | 480 | 8 | 114.75 | 19 / 1 |
| idle | 0 | 8 | 18.475 | 20 / 0 |
| idle | 30 | 8 | 11.325 | 20 / 0 |
| idle | 45 | 8 | 11.175 | 20 / 0 |
| idle | 60 | 8 | 11.375 | 20 / 0 |
| idle | 90 | 8 | 11.675 | 20 / 0 |
| idle | 120 | 8 | 11.275 | 20 / 0 |
| idle | 135 | 8 | 11 | 20 / 0 |
| idle | 150 | 8 | 11.975 | 20 / 0 |
| idle | 180 | 8 | 11.7 | 20 / 0 |
| idle | 300 | 8 | 11.25 | 20 / 0 |
| idle | 480 | 8 | 12.075 | 20 / 0 |
| idle | 900 | 8 | 11.275 | 20 / 0 |
| idle | 0 | 0 | 12.325 | 20 / 0 |
| idle | 480 | 0 | 12.325 | 20 / 0 |

## Regression guards and neighboring cases

The trial test observes the actual arena tick, life start tick and incumbent identities at admission, including tick 9600 for the eight-minute join. Cohort validation rejects missing ages or populations; gate fixtures reject failures at each returned age, and a short simulation regression retains the 90/150/180-second idle cases in the ordinary check.

The engine mock now records changing authoritative ticks as well as travelling shots and exact waves. The recording-canvas test compares protected/unprotected drawing geometry, checks that it visibly surrounds each robot after transformation and disappears at expiry/early cancellation, and reads the clock without surrounding wording. Decorative colour changes remain acceptable. The ineffective whole-bug inequality and redundant row-to-message comparisons were removed; deterministic pushes and all three literal score-37 assertions remain.

Eight independent bad mutations are rejected: admission at zero, renderer tick zero, shimmer at origin, shimmer never expiring, removal of outer-region preference, dropped shots, zero wave and wrong persisted score. Harmless shimmer-colour and HUD-wording mutations pass. Raw output is in `returned-mutations.json` and `returned-legacy-mutations.json`. Neighboring wave/shot forwarding, benchmark participant/time accounting, protection timing, damage immunity, safe spawn/push behavior, annulus/off-screen bounds, credit reset/allocation/cap, and life-clock reset/freeze were checked and remain covered.

## Repeated production Chrome, touch and capacity

Validated with Bun 1.4.2 and installed **Chrome/156.0.8078.4**, built production assets, an owned ephemeral loopback server, and scratch data/home/profile directories. Eight real WebSocket aimers ran for 555 wall seconds, continuously respawning. Fresh Chrome storage joined with exactly eight incumbents after **9823 ticks / 491.15 simulation seconds**, at wave 17; no extra probe or server-state edits were used.

Opening capture: screen **(640, 400)** in 1280×800, three hits, visible shimmer and no bugs on screen. The 0.5/1.5-second captures remain clear with active shimmer, at authoritative life ages 0.8/1.8 seconds. After the neutral opening, actual CDP keyboard/mouse events move, aim and fire. The 30-second capture is at life age **30.05 seconds**, wave 18, **778 points and 2 hits remaining**. Fresh 390×844 portrait and 844×390 landscape contexts demonstrate simultaneous independent touch movement/aimed fire while the eight bots remain connected, with no overflow or browser errors. Opening, 30-second and touch captures were visually inspected.

Captures and raw report are in `returned-production/`: `spawn-{0,0_5,1_5,5,10,30}.png`, portrait/landscape spawn and twin-stick captures, and three full-arena captures. The driver is `returned-validate.ts` with `run.ps1` supplying scratch environment paths.

The developer fixture holds 20 players, 150 bugs, 140 shots and 140 effect slots with production drawing and normal culling. Seven one-second windows per layout (device scale factor 1, no CPU throttling) report:

| Full-arena view | FPS range | CPU update/draw ms per frame |
| --- | ---: | ---: |
| desktop | 60–60 | 0.828–0.975 |
| portrait | 60–60 | 0.718–0.833 |
| landscape | 60–60 | 0.728–0.857 |

The real CLI ran **200 aimers for 120 seconds in 10 rooms**: 200/200 joins, zero errors, tick p50/p95 **0.771 / 1.292 ms**, scheduler lateness p95 **1.858 ms**. Tick cost includes simulation, serialization and socket enqueueing, and remains below 10 ms p95 despite evaluating more birth candidates. The eight-bot run had zero errors and tick p95 0.739 ms. All **351/351** scratch lives were finished; every owned server/browser/bot stopped.

`bun run check` passed **574 tests, zero failures across 58 files**, including real-server integration tests. `bun run build`, `bun run skill`, targeted simulation/renderer/engine/SQLite tests, type checking, all mutation expectations and `git diff --check` passed. The original spawn, protection, personal-pressure and event-wave requirements still hold. No dependency or protocol version change was added.

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
