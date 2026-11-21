# Hive boss validation (issue 84)

Validated on Windows with Bun 1.4.2 and factory Chrome 157.0.8103.51. Evidence is gitignored under `.evidence/84/`; application databases, temporary directories, browser profiles and child-process homes stayed inside this checkout. Every HTTP/WebSocket origin belonged to a server started by the validation process; all servers, sockets and Chrome processes were closed afterward.

## Rules and bounds

Implemented tuning: radius 48, speed 80 units/s, cluster radius 300, frozen HP `120 + 60 * living players`, three crawlers every four seconds, and twelve 180-unit/s globs every six seconds. Active and downed lives count toward initial HP. Solo kills are allowed. A surviving encounter consumes later fifth-wave triggers. Ordinary spawning reserves one of the shared 150 bug slots; brood consumes available slots without debt. Twelve spitter globs plus twelve hive globs bound the collection at 24.

Placement checks every connected player's position. It evaluates clipped Voronoi candidates rather than relying on random sampling. When no point has 600 units of clearance, the best-clearance location receives a two-second harmless arrival warning. A fixed-step test covers the final warning interval and exact 600-unit activation boundary.

Rewards are **300 + 50N** for N eligible contributors, not a universal 500 points. Integer largest-remainder shares conserve the 300-point pool; ended lives leave the denominator. Tests prove four unequal contributors receive 80/110/140/170 (500 total), a solo receives 350, and a tiny contributor can receive the 50-point minimum. Downed credit survives; life termination, departure and replacement cannot inherit old credit. The existing authoritative life writer persists the awards and team attribution without a migration.

JSON combat events now use documented positional rows, expanded in shared validation used by both JSON entry paths. Canonical objects remain accepted. Binary transport uses existing extension cells for max HP, the next ring deadline, glob source and rewards. Maximum fixtures cover twenty long identities/names, 150 bugs including a maximum-HP hive and twelve spitters, 140 shots/events, 24 globs, twenty rewards, and every downed/out population split. JSON, binary keyframes and deltas fit the unchanged 65,536-byte cap. With the ring deadline, the active-population fixture measures 62,138 bytes as JSON and 17,574 bytes as a binary keyframe (`.evidence/84/return/payload.json`).

The initial 50-unit/s speed failed the full newcomer comparison: fresh aimer median 163.325 seconds versus late median 27.8 seconds (17.02%). All idle cohorts and the score gate passed. Traces showed long-lived hives changing incumbent clustering and the pressure encountered by isolated arrivals. Tuning speed to 80 (still below crawler speed 140 and player speed 180) restored the focused twenty-seed comparison: fresh median 159.7 seconds, late median at least 600 seconds (nine deaths / eleven cutoffs). HP, attacks, personal pressure, bot policies and all gates remain unchanged. Initial raw observations are retained in `.evidence/84/skill-50.json`; focused tuned observations are in `newcomers-80.json`.

## Production encounter and Chrome

Run `bun run build`, then `bun scripts/validate-hive.ts`. The harness starts an ephemeral loopback production server, two independent Chrome storage contexts and fifteen real aimer bots. The natural run never advances the wave clock artificially. `--scenes-only` repeats controlled presentation/touch fixtures without repeating the natural encounter and load measurement.

Primary run: `.evidence/84/chrome-AxvqPR/` (`report.json`, `natural-spawn.json`, `scenes.json`, `load.json`). Wave five appeared at snapshot tick 2401, after the scheduled 120,000 ms boundary. All seventeen players were connected; fifteen had active/downed lives, so the hive spawned with 1,020 HP. Its natural ring attacks were observed. The complete measured 17.95-second boss-active window contained 353 ticks: tick p50 **1.60 ms**, p95 **2.90 ms**, maximum **4.59 ms**. These include simulation, encoding and socket enqueueing. Scheduler lateness was measured separately: p95 **1.88 ms**, maximum **5.87 ms**.

Screenshots:

- `natural-wave-five.png`: natural encounter and global health bar.
- `controlled-boss-health-minimap.png`: procedural shell, pulse, top bar and minimap diamond.
- `controlled-ring.png`: twelve outward globs with visible gaps.
- `controlled-edge-arrow.png`, `390x844-boss-touch.png`, `844x390-boss-touch.png`: direction marker, boss HUD and simultaneous touch controls.
- `controlled-kill-banner.png`, `controlled-kill-banner-phone.png`: arena banner and large +200 award for each of two contributors.

Readable body/ring/kill captures deliberately use **controlled in-process fixtures** after the natural encounter: positions, attack deadline, HP and contribution setup are recorded in `scenes.json`. They exercise the production simulation, transport and renderer and introduce no debug route. They do not claim a natural bot kill. The same tuned run captures `390x844-downed-arrival.png` and `844x390-downed-arrival.png`, showing the warning marker, boss bar, minimap and downed countdown/name/rings without overlap.

## Frame and load measurements

The developer fixture `scripts/arena-benchmark.html?hive` draws twenty players, 150 bugs, 140 shots, 24 globs, combat effects and twenty reward effects. Seven one-second samples per layout measured:

| Chrome viewport | FPS in every sample | Average update/draw ms per sample |
| --- | --- | --- |
| 1280 x 720 | 60.0 | 1.062 to 1.325 |
| 390 x 844 | 60.0 | 0.958 to 1.263 |
| 844 x 390 | 60.0 | 1.023 to 1.208 |

These are factory desktop Chrome measurements with mobile emulation, not measurements on a physical phone. Production F-readout captures and two-point move/fire assertions accompany the fixture measurements. No browser console errors were recorded.

The owned production server then ran **200 aimer bots for 145 seconds**, long enough for wave-five bosses across ten rooms. Population remained exactly 200; all 200 connections closed normally. There were zero errors, premature disconnections, malformed/oversized/rate-limited messages, skipped snapshots or save errors. Tick p50 **1.48 ms**, p95 **2.66 ms**, maximum **14.49 ms**; scheduler lateness p95 **2.68 ms**, maximum **78.18 ms**. Maximum individual mean output was **35.91 KB/s**, below the existing 40 KB/s/player gate. The observer recorded one hive per room and hive globs; combined live globs reached 23. All existing tick/bandwidth gates passed.

## Automated checks

`bun install --frozen-lockfile`, `bun run check` and `bun run build` passed. The check runs strict TypeScript and 463 tests, including the real-server JSON/binary hive encounter and idempotent persistence/team totals. Focused simulation, protocol, codec and renderer checks also passed. `bun run skill` passed with exit code 0 (`.evidence/84/skill-80.json`, plus its `.exit.json` record). The twenty-seed/eight-bot/180-second score matrix measured mover median 213 points and aimer median 2,631 points: **12.35x**, above the unchanged 2x gate. Fresh aimer newcomers had an exact median **159.7 seconds** (18 deaths / 2 cutoffs). Eight-minute joins reached a **600-second censored lower bound** (9 deaths / 11 cutoffs), at least **375.70%** of fresh survival versus the required 80%. All **63 idle cohorts** passed, covering every 15-second arena age from 0 through 900 seconds plus solo controls. The minimum idle median was **18.625 seconds**, above the 10-second gate. All 65 cohorts contain twenty seeds: **1,300 raw newcomer observations** with censoring retained.

The implementation was validated from the worktree based on `61ab6b7` and committed as `2a69014`; GitHub CI for that commit also passed on Linux and Windows. That complete sweep describes the hive before the later armoured-beetle merge; combined validation follows.


## Integration with armoured beetles

Main advanced to `833a996` (armoured beetles and flanking aimers) while the tuned full sweep was running. Merged it into the same hive branch. Both registered kinds, beetle shell blocking, zero-point bounces, elapsed-time steering and the flanking policy are preserved. Hive damage credit runs only after the shell-blocking hook accepts damage; JSON event rows carry both bounces and hive rewards. The benchmark now includes ten visible beetles alongside the hive, twelve spitters and 24 globs.

The combined `bun run check` passed **478 tests / 29,957 assertions**, with TypeScript clean. Production build passed. The focused twenty-seed newcomer comparison passes at the same 80-unit/s hive speed: fresh median **156.225 seconds** (18 deaths / 2 cutoffs), eight-minute median **at least 540.825 seconds** (10 deaths / 10 cutoffs).

Fresh production evidence is `.evidence/84/chrome-IjEuZO/`, including the same body/bar/ring/arrow/minimap/kill, downed arrival and touch screenshots listed above. Two isolated Chrome identities plus fifteen aimers again reached natural wave five at tick 2401, with seventeen connected / fifteen living players and 1,020 hive HP. Its measured 18-second boss window contains 352 ticks: tick p50/p95/max **1.58 / 3.46 / 7.04 ms**, scheduler lateness p95/max **2.34 / 12.56 ms**.

Seven full-arena samples per viewport again held **60.0 FPS**. Average update/draw ranges were **1.023-1.438 ms** desktop, **0.852-1.436 ms** portrait and **1.055-1.705 ms** landscape. The full bounds include both boss award effects and beetle bounces. No browser console errors occurred.

The repeated **200-aimer / ten-room / 145-second** workload passes all gates: tick p50/p95/max **1.39 / 2.52 / 9.32 ms** over 28,364 ticks; scheduler lateness p95/max **2.47 / 58.94 ms**; maximum player mean output **36.09 KB/s**. Population stayed exactly 200; all connections closed normally, with zero errors or drops. Live globs reached the complete **24-glob bound**, with natural hive rings observed.

The complete combined `bun run skill` passed with exit code 0: `.evidence/84/skill-merged.json` and its `.exit.json` record retain all 1,300 observations across 65 cohorts. Mover median score **204**, aimer **2,133**, ratio **10.46x**. The full run confirms fresh survival **156.225 seconds** and late survival **at least 540.825 seconds**, or **346.18%** of fresh survival. Every idle cohort passes: minimum with eight incumbents **20.6 seconds** (arena age 105 seconds), and minimum including solo controls **18.625 seconds**. The score, newcomer, idle, frame, tick and bandwidth gates are all preserved. Combined-code GitHub CI passed on both Linux and Windows.


The final presentation review found the hive HUD leaving centered text alignment on the canvas, which clipped the FPS prefix of the following F readout. The helper now saves/restores its drawing state; the existing renderer test checks the caller's alignment. The complete check passes again (478 tests / 29,957 assertions), as does production build. `.evidence/84/chrome-6vEJSe/` repeats the controlled boss/ring/kill, arrival/downed and two-point-touch captures with a fully visible active-play F readout. All seven samples per layout remain 60.0 FPS; average draw ranges are 1.012-1.958 ms desktop, 0.943-1.490 ms portrait and 0.872-1.507 ms landscape. This presentation-only correction changes no simulation or transport behavior.

## Returned review: historical rewards, celebration layout and ring tell

Fixed three fault classes from the returned review:

- **Historical events were coupled to live membership.** Award validation now checks the original UUID, positive safe life number, unique identity, bounded amount/position and conserved total without looking up the recipient's current player/life. Case variants cannot duplicate one recipient. RoomManager tests cover both departure and a rewarded downed life expiring, respawning and then admitting another player before the next tick. Both JSON and binary clients receive the retained original awards and all nineteen subsequent snapshots through the periodic keyframe, with no decoder errors or missing baselines; persisted team credit remains 200 and the replacement life starts at zero. Both JSON decoding paths and binary reconstruction also round-trip historical identities directly. Eligibility at lethal damage, contribution cleanup, live shot ownership and current life-result validation were checked and retain their existing rules.
- **The banner covered world feedback.** The banner is compact and chooses a position clear of every award's complete 1.6-second floating trajectory. Landscape prefers the lower screen; awards retain their own world positions. Renderer tests observe two distinct recipients, their amounts/positions and non-overlap at 50 ms intervals plus 180/800 ms in desktop, portrait and landscape. They also prove natural two-second banner expiry without resetting. Existing cached art, health fill, minimap, arrival/downed UI, reset/deduplication and touch checks remain green.
- **The continuous pulse did not forecast an attack.** The hive now publishes its actual next `ringAt` deadline, replacing the duplicate private ring deadline. During the last 1,000 ms, a contracting amber ring, twelve world-aligned lane marks and a short label warn of emission. The tell uses delayed combat time, disappears at emission and stays absent during arrival. Tests cover the first and second warning, plus twelve globs exactly at six and twelve seconds with no early emission. HP, speed, attack intervals, scoring and eligibility are unchanged.

The other requested regressions now have explicit checks: scheduled placement clears active, downed **and out** players when a safe pocket exists; arrow geometry points to the boss from six directions; every recipient receives its own floating amount; and the banner expires naturally. The two test notes were simplified where those tests changed: health-title case/spacing and the choice between equally safe placement corners are no longer required. Bounds, clearance, deterministic reordered inputs, health values and proportional fill remain checked.

Eight in-memory mutation probes all fail the intended tests: restore current-membership/life reward validation, restore the overlapping banner, remove the tell, double the repeat ring interval, ignore inactive placement sites, zero arrow rotation, drop later award recipients, and keep the banner forever. Harmless title capitalization and reversed equal-clearance tie preference both pass. Probes changed module loading only, not project files; results and logs are `.evidence/84/return/probes.json` and `probes-final.log`.

Final `bun run check` passes **484 tests / 31,615 assertions**, with TypeScript clean; `bun run build` passes. Targeted simulation, wire, codec, RoomManager, real-server and renderer tests pass. Logs are `.evidence/84/return/check-final.log*`, `build-final.log*` and `focused.log*`. An earlier check overlapped a deadline-validation edit and used mixed module versions; its single wire-test failure is superseded by the frozen-source check. The full `bun run skill` sweep was not repeated: the complete combined sweep above remains applicable because attack timing and combat/scoring rules are unchanged; the normal check reruns its score and newcomer tests.

Fresh full production validation is `.evidence/84/chrome-vqCK2N/` (exit 0). Two isolated Chrome identities and fifteen aimers naturally reached wave five at tick 2401, with seventeen connected / fifteen living players and 1,020 HP. Over 351 ticks in a complete 17.95-second boss window, tick p50/p95/max were **2.41 / 4.81 / 8.51 ms**; scheduler lateness p95/max were **2.63 / 13.26 ms**. The subsequent **200-aimer / ten-room / 145-second** workload observed hive rings and all 24 glob slots: tick p95 **3.08 ms**, maximum player mean output **35.25 KB/s**, constant population 200, no errors or premature disconnects, and all 200 connections closed normally. These runs overlapped automated checks; their load tick maximum was 106.66 ms and scheduler lateness maximum 299.22 ms, while the unchanged p95/bandwidth gates passed.

The final production build was also checked in an isolated scene/frame run, `.evidence/84/chrome-jzKbs1/` (exit 0). All seven full-arena samples per viewport held **60.0 FPS**, including twenty award effects and the active ring tell: average draw ranges **1.850-2.137 ms** desktop, **1.710-2.169 ms** portrait, **1.682-2.343 ms** landscape. The earlier concurrent run had one 53-FPS portrait sample; both reports are retained. No browser errors occurred. Both runs exercised two-point touch and arrival/downed layouts. Screenshot names `controlled-ring-tell-first.png`, `controlled-ring-tell-second.png` and `controlled-ring-second.png` show successive warnings/emissions; `controlled-kill-banner-phone.png`, `controlled-kill-banner-phone-800ms.png` and `controlled-kill-banner-phone-1500ms.png` show the banner clear of the local +200 throughout its animation. Capture ages are approximate wall-clock delays; deterministic renderer checks cover the full interval. These are labeled controlled fixtures; the natural encounter is recorded separately. All owned browsers, servers and bot processes finished and closed.

## Returned test check: slow movement and large rewards

The next test check exposed two acceptance gaps without finding a gameplay defect. The existing movement test now requires observed positive speed below both player and crawler speed, independently of `HIVE_SPEED`. The existing recipient test now requires each recorded font, after its canvas transform, to be at least 24 CSS pixels and vertically inside each supported viewport. Existing direction, bounds, multiple-recipient positions, banner separation and expiry checks remain. The copied rise formula was replaced with relative upward motion from each award's birth position.

In-memory probes reproduce both returned mutations: speed 800 fails the movement test against the 140-unit/s arena bound; removing only the world-award font assignment fails the recipient test at 10 CSS pixels. Tuning speed to 90, font to 28px or the rise divisor to 40 passes the focused tests. Results and logs are under `.evidence/84/return-2/` (`probes.json`, `probes-precise.log*`, `focused.log*`, `check.log*`, `build.log*`). Production code and tuning did not change, so the accepted Chrome, load and full skill evidence above was retained rather than repeated.

The focused run passes all **27 tests / 7,811 assertions**. `bun run check` passes TypeScript and **484 tests / 32,235 assertions**; production build also passes. All commands used the checkout's scratch home/data/temp wrapper. Linux CI was not executed locally.
