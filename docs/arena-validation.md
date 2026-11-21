# Arena movement validation — issue #57

Validated on Windows on 2026-11-20 with Bun 1.4.2 and headless Chromium 156.0.8078.4. The production Vite build ran through `createServer`, bound only to `127.0.0.1`, with a temporary SQLite directory and private HOME/USERPROFILE/AppData/cache/temp directories. Two independent browser storage contexts joined as Pilot-A (Tabs) and Pilot-B (Spaces). Every server, browser and bot process was started for this validation and stopped afterward.

## Full-room run

Final command, against the server started for this run:

```text
bun run bots -- --url http://127.0.0.1:54490 --count 18 --seconds 60
```

Two earlier 60-second runs on our own port-3000 server also passed the issue's exact default-URL command, `bun run bots -- --count 18 --seconds 60`. The final run used an OS-assigned port after a fresh bind to 3000 was refused; no request was sent to that existing listener.

| Result | Measured |
| --- | --- |
| Bot joins | 18 / 18 |
| Arena population | 20: two humans and 18 bots, one room |
| Bot errors | 0 |
| Bot messages sent / received | 21,233 / 21,447 |
| Bot messages per second, sent / received | 353.84 / 357.41 |
| Server tick p50 / p95 | 0.363 / 0.861 ms |
| Tick samples in the last minute | 1,181 |

Tick work includes movement, snapshot creation/serialization and enqueueing to all sockets. Scheduler delay is recorded separately in `/api/arena/stats`; neither value includes waiting for a network delivery. Full JSON snapshots intentionally favor a simple first slice. This proves this movement-only 20-player room, not the release-wide 200-player/combat target.

Raw [bot output](arena-evidence/bots.json) and [browser assertions and frame samples](arena-evidence/report.json) are committed alongside the screenshots.

## Browser frames and layouts

Each row uses seven consecutive one-second samples while all 20 players were connected. F displays combined client update/draw CPU time; it excludes the browser's later compositing work. Both desktop pages kept rendering while focus moved between them. Browser flags were `--disable-background-timer-throttling`, `--disable-renderer-backgrounding` and `--disable-backgrounding-occluded-windows`. Device scale factor was 1, with no CPU throttling. Phone evidence uses real Chrome touch/device emulation, not a physical-phone performance claim.

| View | FPS | Combined update/draw ms per frame, sampled range |
| --- | --- | --- |
| Pilot-A, 1280 × 800 | 60.0 | 0.195–0.243 |
| Pilot-B, 1280 × 800 | 60.0 | 0.198–0.250 |
| Portrait, 390 × 844 | 60.0 | 0.188–0.218 |
| Landscape, 844 × 390 | 60.0 | 0.193–0.285 |

- [Tabs page: Pilot-A, Pilot-B and bots](arena-evidence/desktop-tabs.png)
- [Spaces page: Pilot-B, Pilot-A and bots](arena-evidence/desktop-spaces.png)
- [Portrait with an active floating stick](arena-evidence/phone-portrait-touch.png)
- [Landscape arena](arena-evidence/phone-landscape.png)
- Entry: [portrait](arena-evidence/phone-entry-portrait.png) and [landscape](arena-evidence/phone-entry-landscape.png)
- [Release 1 still playing at `/`](arena-evidence/release-1.png)

Real-browser assertions verified mutual authoritative displacement in both human clients and wandering bots in both views. CDP `Emulation.setTouchEmulationEnabled` used `maxTouchPoints: 2`: a left touch acquired the floating stick, a simultaneous right touch moved independently without stealing it, and the robot kept moving. `Input.dispatchTouchEvent` cancellation stopped movement; rotation cleared an active stick. Entry buttons measured at least 44 × 44 CSS pixels in both phone shapes, with no horizontal overflow.

For the 100 ms connection case, the browser delayed WebSocket sends and application receipt callbacks by 50 ms each. The player moved, stopped and converged within 10 world units of authoritative position after queued traffic drained. This explicitly delays WebSocket traffic; HTTP-only network emulation would not prove it. Closing the human socket produced a new welcome automatically and restored a two-human room without duplicate ownership. The root game was started with a fresh identity and keyboard movement, with no page errors. The complete browser run recorded zero console/page errors.

## Reproduction and automated checks

Delivery checks passed: `bun run check` completed with **516 passing tests, zero failures** across 48 files, and `bun run build` produced the release 1, board and lazy arena bundles. `git diff --check` was clean.

Run `bun install`, `bun run check` and `bun run build`. To start a production server with private data/home and an ephemeral loopback port from the repository root:

```text
bun -e "import {createServer} from './src/server/server.ts'; import {mkdtempSync,mkdirSync} from 'node:fs'; import {tmpdir} from 'node:os'; import {join} from 'node:path'; const scratch=mkdtempSync(join(tmpdir(),'arena-local-')); const home=join(scratch,'home'); mkdirSync(home); for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME']) process.env[key]=home; const app=createServer({port:0,hostname:'127.0.0.1',dataDir:join(scratch,'data'),env:{NODE_ENV:'production'}}); console.log(app.server.url.href); process.once('SIGINT',async()=>{await app.stop();process.exit(0);});"
```

Use the printed origin for two fresh browser storage contexts at `/arena` and the bots command above. Press F in both pages, move each human, then repeat at 390 × 844 and 844 × 390 with two-point touch emulation. Stop the server with Ctrl+C. Never point bots at a listener whose data you do not own.

Focused tests cover deterministic seeded stepping, extreme/analog input clamping and bounds; UTF-8 byte caps and all five directional protocol types; room packing/overflow, applied sequence acknowledgements, stale inputs, rolling limits, backpressure, moderation and timing expiry; prediction convergence/history limits, interpolation, camera and pointer ownership; entry, reconnect/build reload and mount cleanup. Real-server integration uses port 0 and temporary SQLite, proves both clients observe movement, isolates the 21st sequential join, rejects a refused name, removes a live hidden name and exercises successful/interrupted bot cleanup. Release 1 checks remain part of `bun run check`.
