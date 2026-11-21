# Arena stream-scale proof (#77)

The production arena passed the required 200-bot, 120-second aimer workload on one factory machine and one server process. Every populated arena and the pooled tick p95 stayed below 10 ms; every connection's complete-window mean stayed below 40,000 payload bytes/s. The independent concurrent run kept all 200 bots connected while Chrome played beside 19 bots in a full arena. Chrome recorded 65 one-second F observations at 60.0 FPS, with no frame gaps over 50 ms.

The matched JSON compatibility run demonstrates the bandwidth failure. Compact shared deltas reduced aggregate payload bandwidth by 93.3%. No simulation frequency, bug cap, kind behaviour or registry changed. Legacy JSON clients remain compatible but do not meet this bandwidth target; current browsers/bots negotiate the compact codec.

## Reproduction and environment

- Factory: AMD Ryzen 9 7950X3D 16-Core Processor, 32 logical CPUs, 127.2 GiB RAM, win32 10.0.26200.
- Bun 1.4.2; factory Chrome/157.0.8103.51, headless at 1280 x 720, device scale 1.
- Production build id/source commit: `be840213a20401a6830cae3d3a411ecf162cc25c`. All three final runs used the same built assets; SHA-256 hashes are committed in [the results](arena-load-results.json).
- Run date: 2026-11-21. Server, bot collector/workers and Chrome ran on this machine. The server used the same `createServer` as the production entry, serving `dist/` in a separate Bun process on an ephemeral loopback port.
- Each run had a fresh database, scratch home, temporary directory and Chrome profile under its evidence directory. No load-limit override or compression was enabled. Owned processes and sockets were closed; final `cleanup.json` files record exits and server stderr.

Build once, then run these sequentially:

```sh
bun run build
bun scripts/validate-load.ts --baseline
bun scripts/validate-load.ts
bun scripts/validate-load.ts --browser
```

Each harness invocation starts its own production server and executes exactly:

```sh
bun run bots -- --url <owned-origin> --count 200 --seconds 120 --policy aimer
```

Only the baseline sets `BOT_SNAPSHOT_ENCODING=json`. It intentionally returns nonzero for the reproduced bandwidth failure; both compact runs return zero. The load generator uses ten worker threads of at most 20 sockets and one separate report collector. Each socket has its own decoder/policy state. Inputs begin after all welcomes and clock calibration, at monotonic 50 ms deadlines with no catch-up or queued inputs.

## Measurement contract

Rates use an exact server-monotonic half-open window, aligned to 50 ms boundaries, lasting 120,000 ms. Joining/calibration traffic and normal teardown are separate. Completed contiguous intervals are collected every 30 seconds, within the server's 180-second retention. Completeness, population exposure and sample counts are checked; raw timing observations are pooled for overall percentiles, never averages of room/window percentiles. The default stats endpoint still exposes its rolling minute separately. Arenas use fresh random seeds; these are comparable workload samples rather than paired simulations.

Bandwidth means decimal KB (1 KB = 1,000 bytes) of **application WebSocket payload accepted for enqueue**, including queued frames and JSON controls. HTTP, WebSocket framing, TCP and TLS are excluded. Attempts, accepted sends, accepted-but-queued sends, rejected sends and backpressure skips are separate. The 40 KB/s gate applies to **every connection's mean over the full window**; one-second peaks are exposed separately and may exceed 40 KB/s. Tick duration includes input application, simulation, lifecycle enqueueing, encoding and socket enqueueing. Scheduler lateness is separate.

The bot collector independently counts received payloads and compares them with server output for those bot identities, excluding the extra browser. Boundary receive/enqueue differences are printed; the diagnostic tolerance is the larger of 1% or one maximum-sized frame per bot. This is a cross-check, not a subtraction from server-measured bandwidth. In the final primary run the difference was -21,280 bytes (-0.00259%); concurrent difference was -44,096 bytes (-0.00543%).

- JSON baseline: `[1050, 121050)` ms; 23,553 pooled ticks; clock uncertainty 0.146 ms.
- Compact primary: `[1750, 121750)` ms; 23,478 pooled ticks; clock uncertainty 0.116 ms.
- Compact concurrent: `[2150, 122150)` ms; 25,722 pooled ticks; clock uncertainty 0.182 ms.

## Before and after

| Run | Bot joins / arenas | Pooled tick p50 / p95 / max (ms) | Server messages/s in / out | Aggregate payload out (KB/s) | Highest player mean out (KB/s) | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Matched JSON baseline | 200 / 10 | 1.149 / 2.125 / 9.472 | 3,887.167 / 3,925.500 | 102,428.832 | 521.099 | 1 |
| Compact primary | 200 / 10 | 1.358 / 2.544 / 10.220 | 3,855.500 / 3,913.000 | 6,836.451 | 35.063 | 0 |
| Compact + Chrome | 200 / 11 | 1.509 / 2.648 / 9.789 | 3,862.267 / 3,916.700 | 6,803.309 | 34.782 | 0 |

Concurrent traffic includes the extra browser. Its 200 bot joins occupied eleven arenas; Chrome added the 201st player. The temporary placeholder left before the measured window. Primary population stayed exactly 200 in ten full arenas. All 200 primary per-player rates and one-second peaks, and all 201 concurrent connection records, are committed in [arena-load-results.json](arena-load-results.json).

| Run | Attempted | Accepted | Queued (subset) | Rejected | Skipped | Rate-limit drops | Transport / save errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| JSON baseline | 471,060 | 471,060 | 0 | 0 | 0 | 0 | 0 / 0 |
| Compact primary | 469,560 | 469,560 | 0 | 0 | 0 | 0 | 0 / 0 |
| Compact + Chrome | 470,004 | 470,004 | 0 | 0 | 0 | 0 | 0 / 0 |

All malformed, unknown, oversized, sequence and handshake drops were zero in the final compact windows. Premature disconnects were zero, and all 200 bot sockets completed normal teardown in each final run. Server stderr was empty. One-second output peaks reached 44.498 KB for a primary player; complete-window means determine the bandwidth gate.

The shortest observed bot input-send gap was 50.253 ms in the primary run and 50.335 ms concurrently. Primary client messages/s out/in were 3,855.500 / 3,912.917; received payload was 6,836.274 KB/s. Server and client directions are deliberately explicit.

### JSON baseline arenas

| Arena id | Players min-max | Tick samples | Tick p50 / p95 / max (ms) | Per-player mean out range (KB/s) |
| --- | ---: | ---: | ---: | ---: |
| `8bc27823-8f2a-494e-9ac3-d3474a6aad1d` | 20-20 | 2,356 | 1.132 / 2.088 / 5.542 | 521.099-521.099 |
| `dc62fd0b-a9d3-436a-872c-13cba9b31c92` | 20-20 | 2,356 | 1.149 / 2.107 / 6.050 | 512.677-512.677 |
| `a0a45275-ba7a-4d4c-8449-49c02cf487f2` | 20-20 | 2,356 | 1.127 / 2.091 / 9.472 | 501.942-501.942 |
| `82f397aa-147f-4f3c-bf62-94842ebbd657` | 20-20 | 2,355 | 1.154 / 2.062 / 3.944 | 510.910-510.910 |
| `418eedad-4319-4bc5-ac15-d809ddef9281` | 20-20 | 2,355 | 1.188 / 2.151 / 3.874 | 514.788-514.788 |
| `84a65b9e-66cd-4e33-a0fe-a8e950922ca0` | 20-20 | 2,355 | 1.188 / 2.242 / 4.378 | 519.200-519.200 |
| `58d2c6d1-2ae2-4a03-835d-0c7fad6bca0c` | 20-20 | 2,355 | 1.162 / 2.169 / 5.720 | 514.821-514.821 |
| `c21c6f36-9b67-4d8b-bbd9-b9ce1b493465` | 20-20 | 2,355 | 1.153 / 2.153 / 4.420 | 512.380-512.380 |
| `86e82f05-544c-47e4-b52b-3b478590075c` | 20-20 | 2,355 | 1.128 / 2.150 / 6.293 | 511.200-511.200 |
| `9a43aeb7-3370-46bc-be0b-95ff93b9fd14` | 20-20 | 2,355 | 1.107 / 2.018 / 5.481 | 502.425-502.425 |

### Compact primary arenas

| Arena id | Players min-max | Tick samples | Tick p50 / p95 / max (ms) | Per-player mean out range (KB/s) |
| --- | ---: | ---: | ---: | ---: |
| `731a23c0-47a1-4d46-b570-5d0ae15d204e` | 20-20 | 2,348 | 1.355 / 2.546 / 8.224 | 34.069-34.069 |
| `64a21335-2e94-4a2e-8d95-985920568764` | 20-20 | 2,348 | 1.339 / 2.567 / 5.395 | 34.335-34.335 |
| `fcf3dace-54c4-41bd-861a-9f436f8cf7ec` | 20-20 | 2,348 | 1.330 / 2.599 / 5.459 | 33.596-33.596 |
| `734cd78b-30ea-4598-899f-20e85bf511eb` | 20-20 | 2,347 | 1.350 / 2.610 / 6.050 | 33.994-33.994 |
| `041e0f9e-9830-4d92-8e82-f5fa0f616399` | 20-20 | 2,348 | 1.385 / 2.595 / 8.199 | 34.136-34.136 |
| `9074e9d3-a30c-4823-a2e2-602fe63d8ba0` | 20-20 | 2,348 | 1.382 / 2.566 / 6.810 | 34.229-34.229 |
| `7461cefa-548d-4da8-aa81-89189d8cc48c` | 20-20 | 2,348 | 1.359 / 2.515 / 6.920 | 33.855-33.855 |
| `559d0e22-0096-4099-bf82-36b650a842f4` | 20-20 | 2,348 | 1.363 / 2.563 / 5.352 | 34.371-34.371 |
| `d64f6c0d-6835-4b5f-aa18-47925daff112` | 20-20 | 2,348 | 1.357 / 2.502 / 5.120 | 34.175-34.175 |
| `e735b7f1-ab16-4c64-8e8d-07467af5a5c9` | 20-20 | 2,347 | 1.370 / 2.438 / 10.220 | 35.063-35.063 |

Primary pooled scheduler lateness p50/p95/max: 0.924 / 2.371 / 61.512 ms. Nominal scheduling remains 20 Hz. Occasional maxima above 10 ms are reported; the acceptance gate is p95.

### Compact concurrent arenas

| Arena id | Players min-max | Tick samples | Tick p50 / p95 / max (ms) | Per-player mean out range (KB/s) |
| --- | ---: | ---: | ---: | ---: |
| `9ebad82f-105e-4f32-978d-face51bddab3` | 19-20 | 2,339 | 1.646 / 2.784 / 7.938 | 32.991-33.108 |
| `e09c85ed-7d40-4f70-9af0-0d2ee4f8b3a6` | 20-20 | 2,338 | 1.571 / 2.725 / 7.633 | 34.782-34.782 |
| `44d9f83d-c609-49d1-87fa-9dae7b81a1d8` | 20-20 | 2,338 | 1.552 / 2.620 / 4.365 | 32.899-32.902 |
| `ca50c669-aba8-4da8-a3da-f88e15daf295` | 20-20 | 2,339 | 1.589 / 2.608 / 5.457 | 34.524-34.524 |
| `1137a0dd-03d6-48c4-8391-1119a3d23c00` | 20-20 | 2,338 | 1.606 / 2.762 / 7.894 | 34.460-34.463 |
| `ac235c3e-aa22-4f90-b0b8-3ce0787441d8` | 20-20 | 2,338 | 1.578 / 2.615 / 5.268 | 33.822-33.822 |
| `e2c4cd4a-010c-4332-a067-bc0a261e7066` | 20-20 | 2,338 | 1.602 / 2.749 / 7.091 | 34.311-34.311 |
| `a72bd644-99b7-47c7-99cb-5d3858e84f4a` | 20-20 | 2,338 | 1.584 / 2.648 / 9.789 | 34.430-34.430 |
| `c898421e-6895-4e5f-a561-8bb9251ae18f` | 20-20 | 2,338 | 1.590 / 2.718 / 5.902 | 34.225-34.225 |
| `03824577-accb-47fa-aea0-0f6d4f1d2221` | 20-20 | 2,339 | 1.530 / 2.584 / 5.197 | 33.436-33.436 |
| `ac739198-1369-44e8-8c47-780edc7c13d8` | 1-1 | 2,339 | 0.208 / 0.488 / 4.841 | 3.459-3.459 |

The browser's arena was `9ebad82f-105e-4f32-978d-face51bddab3`. The harness first admitted a placeholder and all 200 bots, then removed only the placeholder and joined Chrome through the normal name/team screen. The fullest-room rule placed Chrome beside 19 bots. Every one-second browser population assertion proved 201 connected players, eleven arenas and 20 members in Chrome's arena.

## Snapshot sizes and fan-out

| Accepted snapshot kind | Recipient observations | p50 / p95 / max bytes per recipient per tick | p50 x 20 Hz (KB/s per recipient) |
| --- | ---: | ---: | ---: |
| all | 469,560 | 1,717 / 2,311 / 6,887 | 34.34 |
| keyframe | 23,400 | 5,206 / 6,107 / 6,887 | 104.12 |
| delta | 446,160 | 1,704 / 2,030 / 2,497 | 34.08 |

These are accepted **recipient observations** over the complete primary window, including periodic keyframes and recovery frames; histograms are combined by count. Values are not JSON estimates. Each room encodes a shared keyframe/delta once and reuses it for up to 20 recipients. Median all-frame room fan-out was 34,340 bytes per tick; p95 frame size times 20 recipients is 46,220 bytes. Multiplication by 20 Hz in the table is an equivalent rate, not the observed mean: keyframes recur every 20 simulation ticks (about once per second), with deltas between them. Controls add a small amount. The observed aggregate mean divided by 200 was 34.182 KB/s/player.

Positions use 1/8 world unit, velocities 1/16 unit/s and facing 1/1024 radian for players and 1/2048 for bugs on the wire. Other fractions retain three decimals; integer ids, scores, acknowledgements and ticks remain exact. Decoded snapshots retain the whole arena. Rejected/skipped recipients recover through a current keyframe before resuming deltas. See [architecture.md](../architecture.md#snapshot-transport-and-load-measurement) for format, bounded storage and per-tick work.

## Concurrent Chrome motion and F evidence

After five seconds of warm-up, normal keyboard/mouse actions exercised movement and shooting over 65 seconds; Enter used the normal respawn path when needed (observed life number reached 3). The F readout stayed at 60.0-60.0 FPS. Canvas update/draw cost p50/p95/max was 0.793 / 1.157 / 1.275 ms. Animation-frame gaps: 3,900 samples, p50/p95/max 16.700 / 16.800 / 17.100 ms; no gaps over 50 ms.

Snapshot receipt cadence p50/p95/max was 51.000 / 54.100 / 111.700 ms. There were no browser console/protocol errors, missing-base warnings or visible freezes in the inspected movement/combat sequence. Screenshots show the 20-player HUD and F readout. Chrome stayed connected until the bot window and report retrieval finished.

Local evidence (intentionally gitignored, all inside this checkout):

- JSON baseline: `.evidence/77/baseline-HsKhA6/` (`bots.json`, `run.json`, server logs and `cleanup.json`).
- Primary: `.evidence/77/load-avpHHN/`.
- Concurrent: `.evidence/77/concurrent-PrWuAF/`, including `admission.json` and `browser.json`.
- Readout screenshots: `.evidence/77/concurrent-PrWuAF/full-room-F-10.png`, `full-room-F-40.png` and `full-room-F-64.png`.
- Motion: `.evidence/77/concurrent-PrWuAF/motion-00.png` through `motion-11.png` (twelve actual frames during movement/combat).
- Committed numeric evidence: [arena-load-results.json](arena-load-results.json), including all player rates, browser samples, frame gaps and snapshot cadence.

## Investigation and regression checks

The initial instrumented JSON run (`.evidence/77/baseline-kR5XMu/`) joined 200 but reached 420.994 KB/s for its busiest player, with 31,504 backpressure skips and 1,206 input-rate drops. The old CLI's hard-coded zero errors and final-minute tick percentile concealed those failures.

Failed compact probes remain under `.evidence/77/`: `load-YPkjOU` (collector timeout under decoder work), `concurrent-MjfXVv` (browser smooth but load failed on input bursts and intentional Chrome teardown), `concurrent-OT7laz` (195 welcomes before a hello timeout), and `load-d8rzC5` (1,927 measured input-rate drops; minimum send gap 2.291 ms). Validated-name caching, isolated worker cohorts, post-admission input start and deadlines without catch-up corrected the generator pressure. Holding Chrome through report retrieval removed intentional teardown from the measured window. The final matched JSON run uses this corrected generator too, isolating the snapshot-format comparison.

The branch integrates the landed dasher change (base c5af313) without modifying bug behaviours or registries. Common HP/facing/phase/timer fields and fractional hit/kill events are encoded directly; a per-frame string dictionary compresses repeated owners/kinds/phase labels. Finer bug-facing quantization preserves the existing committed-motion validator. Earlier crawler-only probes are investigation evidence; the final matched runs include both kinds.

Codec tests cover committed dasher phases/headings, fractional event values, safe integers, quantization, truncated/oversized frames, collection bounds, births/removals/reordering, immutable history, life/save transitions and base resets. Room tests cover two recipients with independent skip/rejection/queued-send recovery and terminal delivery. Metrics tests cover exact boundaries, expiration, weighted sizes, maxima and unequal-room pooled percentiles. Real-server reporting fixtures inject deterministic tick costs to avoid timing assertions in the ordinary suite; the production load runs use actual wall-clock timing. Real-server tests cover full-window directional reporting, incomplete-data failure, worker teardown, cancellation and protocol negotiation. `bun run check` passed (418 tests across 54 files; `.evidence/77/check-dasher.log`); the final production build and both compact acceptance runs passed. Earlier check logs are retained, including a cold child-process timeout and corrected old-report assertions.
