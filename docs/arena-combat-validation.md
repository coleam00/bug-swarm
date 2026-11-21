# Arena combat validation — issue #61

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
| Live desktop, 1280 x 800 | 60.0-60.0 | 0.297-0.457 |
| Live phone, 844 x 390 | 60.0-60.0 | 0.298-0.442 |
| Renderer bounds, 1280 x 800 | 60.0-60.0 | 0.978-1.160 |
| Renderer bounds, 390 x 844 | 59.0-60.0 | 0.755-0.958 |

The F readout measures combined client update/draw CPU work, excluding later compositing. Device scale factor was 1, with no CPU throttling. Browser flags: `--headless=new --no-sandbox --no-first-run --no-default-browser-check --remote-debugging-port=0 --user-data-dir=<scratch-profile> --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`. Chrome device emulation is evidence for this machine, rather than a physical-phone hardware claim.

| Population / measured duration | Joins / errors | Tick p50 / p95 ms | Scheduler lateness p95 ms |
| --- | ---: | ---: | ---: |
| Two browsers + 10 bots / 40 s | 10/10, 0 errors | 0.349 / 0.735 | 1.699 |
| Two browsers + 18 bots / 18 s | 18/18, 0 errors | 0.427 / 1.068 | 1.912 |
| 200 bots, 10 rooms / 120 s | 200/200, 0 errors | 0.695 / 1.163 | 1.693 |

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

`bun run check` passed **542 tests, zero failures across 55 files**, including release 1. `bun run skill`, `bun run build`, focused real-server/SQLite/input tests and `git diff --check` passed. No new dependency was added. The final implementation keeps the planned bounded scans/full snapshots and between-tick writer; later bug kinds, revives, pickups and minimap remain out of scope.


## Returned-check repairs

The firing stream now retains its pending cooldown across releases, while still dropping overdue fire. A deterministic alternating-trigger regression reproduces the old 10-shot/s defect and checks that every 20-player snapshot remains within the projectile bound and passes the real parser. Held fire, fractional cadence, heat lockout/recovery, long-release resumption and respawn readiness remain covered.

New shots and bugs now become visible on the existing delayed interpolation timeline, eliminating the latest-position fallback that rewound newly arriving entities. The arrival test covers receipt times, between-snapshot frames, both entity kinds, removal and reset. The analogous remote-player join fallback predates this change and remains outside this repair.

The returned coverage gaps now have observable behavioral guards: mouse and simultaneous touch events pass through the real bindings; a teammate sits on the projectile path; unequal crawler distances oppose id ordering; waves scale with two living players and one dead player and use both spawn regions; actual wave/bug state reaches room snapshots; respawn clears an attacker; simulation duration reaches SQLite; and touch activates the React life-over control. The skill matrix derives participant count and player-seconds from recorded lives and verifies distinct seeds, eight players and 180 seconds. Policy tests exercise dodging and retreat, and the WebSocket bot test inspects distinct outgoing policy inputs rather than an echoed option. Recording-canvas tests cover proportional heat, warning and immunity phases, and changing HUD numbers without exact decorative wording or layout.

The ineffective real-server stale-input duplicate was removed; the deterministic lifecycle guard remains. Other production paths inspected for the same faults (nearest-target policy selection, wave placement/scaling, safe spawning, duration persistence, and input forwarding) required stronger tests rather than implementation changes. All 23 targeted mutation probes were rejected: [mutation results](arena-combat-evidence/fix-mutations.json). The corrected skill result is 869.5 versus 236 points (3.6843x), with unchanged life medians and no constant tuning.
