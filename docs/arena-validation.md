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

Original delivery checks passed: `bun run check` completed with **516 passing tests, zero failures** across 48 files, and `bun run build` produced the release 1, board and lazy arena bundles. `git diff --check` was clean.

Run `bun install`, `bun run check` and `bun run build`. To start a production server with private data/home and an ephemeral loopback port from the repository root:

```text
bun -e "import {createServer} from './src/server/server.ts'; import {mkdtempSync,mkdirSync} from 'node:fs'; import {tmpdir} from 'node:os'; import {join} from 'node:path'; const scratch=mkdtempSync(join(tmpdir(),'arena-local-')); const home=join(scratch,'home'); mkdirSync(home); for(const key of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME']) process.env[key]=home; const app=createServer({port:0,hostname:'127.0.0.1',dataDir:join(scratch,'data'),env:{NODE_ENV:'production'}}); console.log(app.server.url.href); process.once('SIGINT',async()=>{await app.stop();process.exit(0);});"
```

Use the printed origin for two fresh browser storage contexts at `/arena` and the bots command above. Press F in both pages, move each human, then repeat at 390 × 844 and 844 × 390 with two-point touch emulation. Stop the server with Ctrl+C. Never point bots at a listener whose data you do not own.

Focused tests cover deterministic seeded stepping, extreme/analog input clamping and bounds; UTF-8 byte caps and all five directional protocol types; room packing/overflow, applied sequence acknowledgements, stale inputs, rolling limits, backpressure, moderation and timing expiry; prediction convergence/history limits, interpolation, camera and pointer ownership; entry, reconnect/build reload and mount cleanup. Real-server integration uses port 0 and temporary SQLite, proves both clients observe movement, isolates the 21st sequential join, rejects a refused name, removes a live hidden name and exercises successful/interrupted bot cleanup. Release 1 checks remain part of `bun run check`.

## Returned-check repairs

Admission now separates an attempted session from the accepted identity. A refused new name remains editable with both team choices, and is not written to storage. A subsequent `welcome` commits the identity. The existing saved/legacy identity paths and team-conflict retry retain permanent identity rules; the connection layer itself never writes browser storage. Tests cover both teams through mounting and persistence, refusal before admission, correction after reload, and fixed identity after admission.

Name tags now measure glyph bounds and reserve stroke padding when creating the cached canvas. Both local and remote robots use the same label path; the fixed floor/glow canvases contain no dynamic text. A recording-canvas test verifies both bodies and identities are actually painted, their measured text fits, labels stay centered, and the second draw reuses the cached surfaces.

The other repairs extend the existing fixtures at the boundaries missed by the original assertions:

| Boundary | Regression guard |
| --- | --- |
| Shared stepping | Oversized/extreme inputs move one speed-limited step; different seeds produce different spawns while equal seeds reproduce |
| Room selection | Populations `[1,19]` become `[1,20]` when the fuller room was inserted later |
| Scheduling | Server tick and client input fixtures assert the requested 50 ms interval |
| Input delivery | All WASD/arrow directions and captured touch moves reach emitted inputs; connection sends the actual wire message |
| Scheduled frames | Frames render predicted then reconciled local positions, remote interpolation and matching camera coordinates |
| Tick stats | The manager aggregates samples across two rooms, giving p50=50 and p95=95 for values 1–100; empty/expired windows remain covered |
| Bot CLI | The owned ephemeral server observes displacement for both bots; the real CLI JSON contains joins, arena ids/count, rates, errors and tick percentiles |

The tests were challenged with the 16 reported behavioral mutations plus premature persistence and fixed-width labels: **all 18 regressions failed their focused tests**. Cancellation wording and highest-free-slot allocation both passed, confirming the two implementation-specific assertions were removed. [Mutation results](arena-evidence/fix-mutations.json) record every case; each temporary edit was restored before continuing.

Production Chrome repeated first-time hidden-name refusal and correction, refusal then reload, accepted identity reload/rejoin, both team choices, and a later hide of an accepted identity. Both wide 16-character names were checked against real glyph metrics on both local and remote robots. [Browser/load report](arena-evidence/fix-report.json), [editable refusal](arena-evidence/fix-name-refusal.png), [Spaces view](arena-evidence/fix-wide-spaces.png), [Tabs view](arena-evidence/fix-wide-tabs.png) and [portrait touch](arena-evidence/fix-wide-portrait-touch.png) capture the result. The two humans were separated before the screenshots so overlapping tags would not obscure label legibility. Validation again used an owned loopback server, private home/profile/data directories and 18 bots for 60 seconds.

The repaired build passed `bun run check`: **517 tests, zero failures across 49 files**; `bun run build` and `git diff --check` also passed. The repeated load joined all 18 bots in one 20-player arena with zero errors and tick p50/p95 **0.346/0.784 ms**. Both desktop views sampled **60 FPS** for seven seconds, with combined update/draw costs **0.210–0.282 ms/frame**. Real glyph bounds required 214 px and 206 px cached canvases for the two wide names, including padding. Measurement happens once per cached label; drawing still uses cached images. Every owned browser, bot and server process finished before delivery.

## Saved-name guidance and remaining renderer guards

Hidden saved identities now receive “This identity cannot rejoin because its name is hidden. Saved names are permanent.” Live removals send that explanation directly. The client also selects it for saved identities refused before welcome, including after reload and for a saved legacy identity without a database registration. First-time editable attempts retain the instruction to pick another name. The stable `name-hidden` error code selects the message; tests cover its delivery through the engine and both entry states.

Production Chrome at 390 px verified first-time correction and admission, removal through the real `bun run hide` command against the owned scratch database, saved re-entry after reload, and the unregistered legacy case. [The screenshot](arena-evidence/hidden-saved-identity.png) and [browser report](arena-evidence/hidden-identity-report.json) show the permanent-name explanation alongside the read-only saved name. No storage was cleared, and all owned processes finished.

The canvas fixture now records pattern sources. The renderer test checks contrasting horizontal/vertical grid lines and use of their repeated pattern on the floor, plus an outer ring around the local robot with no corresponding ring around the remote robot. It avoids exact colours, radii and label offsets. Bot displacement is grouped by player id rather than numbered-name formatting. [Mutation checks](arena-evidence/render-rule-mutations.json) reject a solid floor, a removed local ring, rings on remote robots, lost error codes and incorrect refusal-state selection; moving a label one pixel or removing bot-name zero-padding both pass. The final `bun run check` again passed **517 tests**, and the production build and diff checks passed. This follow-up adds no work to rendering or simulation ticks; the recorded load/frame evidence above remains applicable.
