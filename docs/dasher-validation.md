# Dasher validation (issue 71)

The dasher and multi-kind seam use the existing fixed-step arena. Initial and final combat tuning are identical: 2 HP, 25 base points, radius 16, approach 140 units/s, trigger 240 units, wind-up 700 ms, dash 490 units/s for 450 ms, recovery 1,000 ms at 35 units/s. The trigger is deliberately reduced from the issue's approximate 280: 220.5 units of travel plus 30 units of combined contact radius reaches a stationary target from 240. Spawn share is 1/6 at wave 3, rising linearly to 1/4 at wave 8. Personal spawn pressure is unchanged.

`bun install --frozen-lockfile`, `bun run check` (603 tests), focused simulation/protocol/rendering/real-server tests and `bun run build` passed. Tests cover locked targeting, exact phase boundaries, perpendicular escape versus stationary contact, recovery, wall stops, swept grazing, surviving-hit accuracy, two-hit scoring, different shooters, capped awards, registered spawning and validation, delayed state/effects (including pose transitions across missing snapshots) and two real clients observing nonlethal and lethal hits. The maximum payload fixture includes 150 phased dashers, maximum shot/event collections and four terminal results, and remains below 64 KiB. Dash direction validation accounts for independently rounded .001-radian facing and velocity components. Existing changed-build reload tests remain green.

The aimer retains its chosen perpendicular side through wind-up/dash, but blends a 0.75 escape force with existing retreat/crowd avoidance only while within the 60-unit corridor and dash reach. A full movement override caused a newcomer regression by steering clear players into other bugs; the blended response avoids that. Combat tuning and mover behavior stay unchanged. The long admission-observation test has an explicit ten-second runner timeout for its several thousand simulated seconds; gameplay/skill/fairness thresholds and cohort coverage are unchanged.

## Production Chrome

Chrome 157.0.8103.51 on Windows, built production assets, an owned loopback production server and isolated SQLite/home/profile directories. Two independent browser storage contexts plus 18 aimer bots shared a 20-player arena. Natural dashers appeared at tick 1207, wave 3, before controlled evidence scenes. Both 390 x 844 portrait and 844 x 390 landscape exercised real two-point touch movement/aim/fire; no overflow or browser errors were observed.

The tell/dodge sequence used controlled positions on that same server, real keyboard input and authoritative snapshots. At tick 1217 the dasher was winding up at (960, 1200), facing 0, toward a player at (1200, 1200). At tick 1229 the dash was at (1033.5, 1200), still facing 0, while the player had sidestepped to (1200, 1281). By recovery at tick 1239 the player was at (1200, 1371), still with all three hits and both protection/immunity timers zero. A separate single-shot scene captured HP 2 -> 1, multiplier 1.1 and a spark with no kill/score label. Screenshots were inspected for the compressed hot silhouette, locked warning line, straight dash, dodge and hit feedback.

The F readout and the developer renderer fixture measured seven one-second windows for each layout. The fixture holds 20 players, 150 bugs, 140 shots and a 140-slot hit/kill effect pool; mixed mode exercises every phase, and `?windup` exercises the worst glow/warning view. All measured windows reported 60.0 FPS.

| Layout | Mixed update/draw ms | All wind-up update/draw ms |
| --- | ---: | ---: |
| 1280 x 800 | 0.903-1.208 | 0.942-1.292 |
| 390 x 844 | 0.633-0.752 | 0.800-0.875 |
| 844 x 390 | 0.715-0.885 | 0.849-1.265 |

Ranges are per-window mean update/draw costs, not whole-frame GPU times. Phone evidence uses desktop Chrome device/touch emulation. The renderer caches the dasher glow at construction and reuses the bounded effect pool; physics reuses per-bug motion records and scans at most two segments per shot/bug pair.

The production CLI `bun run bots -- --url <owned-origin> --count 200 --seconds 120 --policy aimer` joined all 200 across ten arenas with zero errors. Over 11,742 room ticks in the final rolling minute: tick p50 **1.157 ms**, p95 **2.038 ms**; separate scheduler lateness p50 **0.957 ms**, p95 **2.491 ms**. All owned browsers, sockets, servers and database handles were closed afterward.

## Reproduction and evidence

All scratch homes, databases, browser profiles, screenshots, logs and drivers stay under `.evidence/71/` (gitignored). Set HOME/USERPROFILE, APPDATA/LOCALAPPDATA and TEMP/TMP to checkout-contained scratch directories before running Bun. The saved `env.ps1` creates and sets these on Windows; `validate.ts` runs the production/browser/load scenarios, and ignores its own scratch directory when watching the developer fixture. The developer fixture is `scripts/arena-benchmark.html` through an owned loopback Vite server; it is excluded from production assets. Use `CHROME_PATH` for a different Chrome installation. Never run the older combat evidence driver unchanged: its temporary paths predate this checkout-only requirement.

[Uploaded evidence and drivers](https://gist.github.com/coleam00/65c1db1485705125664e78a847317807): download `gallery.html` and open it locally for the embedded original PNG screenshots; `report.json` contains the matching authoritative snapshots and all frame samples, and `load.json` contains the CLI report.
