# Arena root cutover — issue 73

The production game opens at `/` through StartScreen. Both `/arena` aliases return 307 redirects with their query parameters. Release 1 gameplay, its executable workload/pacing tools and obsolete probes are removed; historical data and compatibility endpoint tests remain.

Validated on Windows with Bun 1.4.2 and factory Chrome 157.0.8103.51. Evidence lives under `.evidence/73/` in this checkout, including private homes, profiles, SQLite databases, logs and screenshots. Reproduce after `bun run build` with `bun scripts/validate-cutover.ts`; `--edges-only` runs entry failure cases independently. The driver owns ephemeral loopback listeners and closes its server, browser and bots.

## Production Chrome

`chrome-93YKuE/report.json` and its PNGs cover first and return visits at **1280 × 720, 844 × 390 and 390 × 844**, each with desktop keyboard/mouse and simultaneous two-point touch. A second isolated human context and 18 aimer bots filled the room. Captures include each entry, joined hint, movement/aim/fire, shot-dismissed hint, returning entry/play, F readout, timeout dismissal, saved results, respawn and `/board`. Both team colours, the local marker, world outline and faint swarm dots were inspected. No horizontal/entry overflow occurred; entry buttons measured 60 px high. No persistent instructions or legacy run POSTs appeared.

Automated first-entry timings (including local page load, screenshot and name entry) were 0.61–2.33 seconds. Return activation to a living snapshot was 55–99 ms. These local automation measurements exclude human typing, WAN latency and a physical phone.

`chrome-kjer1A/` adds production screenshots and assertions for a hidden fresh name remaining editable and unpersisted, a returning duplicate identity displaying an error beside one Play button, authoritative team restoration, and play with unavailable localStorage. The storage scenario logged the expected identity/hint failures and continued playing.

`redeploy-WlMjPm/` records production `main.ts` restarts at `/`: same-build reconnect, changed-build automatic reload/resume, rollback, another redeploy, a delayed save, and portrait/landscape touch continuity. All five recorded save/rejoin scenarios passed, with no browser exceptions. Windows validation invokes the registered SIGTERM handler through an owned stdin harness; actual Unix OS-signal behavior remains covered by CI. Reproduce from a clean committed checkout with `bun scripts/validate-redeploy.ts`.

Full-room F samples reported **60.0 FPS, 0.285–0.473 ms/frame** across the six layouts. The retained renderer fixture simultaneously drew 20 players, 150 bugs, 140 shots and 140 kill effects at **60.0 FPS, 1.083 ms/frame** on 1280 × 720. This is factory desktop Chrome emulation evidence.

The 200-aimer-bot/120-second capacity run joined all 200 players across ten rooms with **zero errors**, tick p50 **1.049 ms**, p95 **1.690 ms** (6,313 samples). Scheduler lateness p95 was 85.75 ms: this reproduction runs clients and server in the same Bun process and includes their scheduling contention. Tick cost meets the 10 ms target; this does not claim independent production-client scheduling latency.

## Bundle comparison

Baseline: `97f91a2a0bb2592ed445455922f84ea4b14f858a`. `bundle-before.json` and `bundle-after.json` enumerate every emitted JS/CSS file, measured with the same embedded build identifier. Totals sum raw bytes and each file independently compressed with Node zlib's default gzip settings; HTML, build manifest and generated share images are excluded consistently.

| Emitted JS/CSS | Before raw | After raw | Before gzip | After gzip |
| --- | ---: | ---: | ---: | ---: |
| All routes | 248,009 | 204,465 | 84,999 | 69,826 |
| Root and its dependencies | 205,450 | 192,014 | 68,992 | 65,340 |
| Arena JS chunk | 27,721 | 36,997 | 10,567 | 13,716 |
| Arena CSS chunk | 2,387 | 5,191 | 956 | 1,788 |
| Retired App JS/CSS chunks | 53,108 | 0 | 17,870 | 0 |

Total reduction: **43,544 raw bytes (17.6%)**, **15,173 gzip bytes (17.9%)**. Arena now includes StartScreen and the retained drawing/results components; comparing only renamed route chunks would miss the retirement savings. `/board` stays lazily isolated.

## Regression coverage

`bun run check` passed strict types and **359 tests, zero failures** (20,574 assertions). Focused changes cover the actual production/development redirect boundaries, board route isolation, history-state preservation, welcome-only identity persistence, editable rejection, legacy team selection, authoritative correction, results/review polling, read-only API deadlines, minimap projection/deduplication/dead players, authoritative one-line HUD population and large scores, and first-life hint expiry/shot/storage/lifecycle behavior.

The minimap adds bounded O(players + bugs) canvas work with no per-frame DOM updates or entity collections. HUD formatting and measurements are cached until values or viewport change. Boss markers and simulation/protocol changes are outside this item.
