# Load validation and pre-stream reset

Run only against a server and data directory you own. The harness writes real scores and players. Keep benchmark data separate from stream data. No dependencies beyond the project's Bun install are required.

## Reproduce

Build with `bun install --frozen-lockfile` and `bun run build`. Use two terminals with an explicit scratch home/data directory and a dedicated unused port. The examples use 43125; if startup reports an occupied port, choose another before making requests. Wait for the newly started server's `App on ...` message, then verify its `/health` response is `ok`.

PowerShell, server terminal:

```powershell
$taskScratch = Join-Path ([IO.Path]::GetTempPath()) ('swarm-load-' + [guid]::NewGuid())
$taskHome = Join-Path $taskScratch 'home'
New-Item -ItemType Directory -Force $taskHome | Out-Null
$env:HOME = $taskHome
$env:USERPROFILE = $taskHome
$env:APPDATA = Join-Path $taskHome 'AppData/Roaming'
$env:LOCALAPPDATA = Join-Path $taskHome 'AppData/Local'
$env:DATA_DIR = Join-Path $taskScratch 'data'
$env:PORT = '43125'
$env:NODE_ENV = 'production'
$env:LOAD_TEST_START_LIMIT = '10000'
bun run start
```

In the client terminal set its own scratch `HOME`, `USERPROFILE`, `APPDATA` and `LOCALAPPDATA` as above, then:

```powershell
Invoke-RestMethod http://127.0.0.1:43125/health
bun run load -- --url http://127.0.0.1:43125 --players 5 --seconds 6
```

Stop the server with Ctrl+C. Select a **fresh** scratch `DATA_DIR` and restart before the measured run:

```powershell
bun run load -- --url http://127.0.0.1:43125 --players 500 --seconds 60
# In a terminal targeting the server's scratch DATA_DIR:
bun run stats
Invoke-RestMethod http://127.0.0.1:43125/api/leaderboard
Invoke-RestMethod http://127.0.0.1:43125/api/teams
```

POSIX, server terminal (keep the printed directory for stats/reset):

```sh
task_scratch=$(mktemp -d)
mkdir -p "$task_scratch/home"
echo "$task_scratch"
HOME="$task_scratch/home" XDG_CONFIG_HOME="$task_scratch/home/.config" \
XDG_CACHE_HOME="$task_scratch/home/.cache" DATA_DIR="$task_scratch/data" \
PORT=43125 NODE_ENV=production LOAD_TEST_START_LIMIT=10000 bun run start
```

POSIX, client terminal:

```sh
task_client=$(mktemp -d)
export HOME="$task_client" XDG_CONFIG_HOME="$task_client/.config" XDG_CACHE_HOME="$task_client/.cache"
curl --fail http://127.0.0.1:43125/health
bun run load -- --url http://127.0.0.1:43125 --players 5 --seconds 6
# Stop the server, use a fresh DATA_DIR, and restart it before measuring:
bun run load -- --url http://127.0.0.1:43125 --players 500 --seconds 60
# Set DATA_DIR to the measured server's scratch directory for this command:
DATA_DIR=/path/to/measured/scratch/data bun run stats
curl --fail http://127.0.0.1:43125/api/leaderboard
curl --fail http://127.0.0.1:43125/api/teams
```

The generator and server may share the factory machine; record that fact, hardware, OS, Bun version, source commit, empty/populated starting database, settings, duration, accepted starts/finishes, every route's latency/count and failures. A passing run needs 500 starts and finishes, zero failed requests/5xx, and at least 95% of all requests succeeding below 200 ms. The harness exits nonzero otherwise. Keep the default workload unchanged when investigating a failed target. See [architecture.md](../architecture.md#capacity-validation) for request timing, validation and polling details. This is a one-minute capacity check, not a database-growth soak test or a remote-network benchmark.

## Before the stream

Stop the deployed server. Set `DATA_DIR` to the **intended stream database** and run:

```sh
bun run reset
# Read the resolved path in the refusal, then confirm:
bun run reset -- --yes
bun run stats
```

This deletes all gameplay history, including real players, abandoned runs and legacy events. It preserves hidden-name moderation and the schema. It cannot delete only the `load-` players. Restart the server with `LOAD_TEST_START_LIMIT` unset (PowerShell: `Remove-Item Env:LOAD_TEST_START_LIMIT`; POSIX: `unset LOAD_TEST_START_LIMIT`). Restarting clears the read caches and rate-limit buckets as well. The defaults are 300 starts per client IP and 40 per player id per rolling ten minutes. The load override changes only the IP ceiling; use distinct player ids for the workload. Before enabling `TRUST_PROXY_HOPS=1` on Railway, follow [pre-stream proxy verification](../architecture.md#pre-stream-proxy-verification) on an isolated deployment.

## Factory evidence

Measured 2026-11-19, ending at 22:12:32 UTC, at source commit `78312ff5ae9ac6e38cafb31fb10e9f5601cd84aa`. These historical measurements predate the proxy-hop and two-budget limiter changes.

- Machine: Windows 11 Home 10.0.26200; AMD Ryzen 9 7950X3D, 16 cores / 32 logical processors; 127.2 GiB OS-visible RAM; Bun 1.4.2 (`744846f84`). This is the factory workstation; server and generator ran together on it, using loopback TCP, without other project checks running during measurement.
- Built with `bun run build`; server launched with `bun run start`, `NODE_ENV=production`, `PORT=63788`, `LOAD_TEST_START_LIMIT=10000`, a fresh empty scratch `DATA_DIR`, and a scratch home. Production's normal listener remained `0.0.0.0`; the generator targeted `http://127.0.0.1:63788`. No proxy headers or plausibility overrides.
- Measured command: `bun run load -- --url http://127.0.0.1:63788 --players 500 --seconds 60`. Default one-run workload and polling, five-second request timeout. Scheduling 60.001 s; drain 0.016 s; complete CLI elapsed 60.078 s.
- Requested players 500; accepted starts **500**; accepted finishes **500**; requests **28,312**. Failures by HTTP status/category: **{}** (none); **zero 5xx**, timeouts, transport failures or invalid responses. All required reads observed successfully. Exit code **0**, capacity **PASS**.
- **98.54%** of all requests succeeded in strictly under 200 ms, above the 95% target. The synchronized start burst has higher tail latency, visible below; percentiles include every request and are nearest rank, not averages of route percentiles.

| Method and route | Requests | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| POST /api/runs | 500 | 477.75 | 870.98 | 905.15 |
| POST /api/runs/:runId/finish | 500 | 1.99 | 3.91 | 20.43 |
| GET /api/players/:playerId/best | 1,000 | 1.72 | 3.38 | 17.98 |
| GET /api/leaderboard | 13,156 | 0.22 | 1.64 | 3.62 |
| GET /api/teams | 13,156 | 0.20 | 1.73 | 3.82 |
| Overall | 28,312 | 0.22 | 2.80 | 421.63 |

Post-run `bun run stats` reported `players: 500`, `finished_runs: 500`, `median_runs_per_player: 1.0`, `touch_share: 50%`. The leaderboard returned ten valid `load-` entries; team totals were `{ "tabs": 52414, "spaces": 52211 }`. After stopping the owned server process tree, `bun run reset -- --yes` deleted 1,000 events, 500 runs and 500 players.

A separate fresh-server smoke test preceded measurement: 5 players / 6 seconds, 54 requests, 5 accepted starts and finishes, no failures/5xx, 100% under 200 ms; overall p50/p95/p99 5.45/13.87/14.41 ms. Stats counted all five finishes, and reset deleted 10 events, 5 runs and 5 players before the measured server was created with a different scratch database. Both server process trees were stopped by their owned PIDs. The timed workloads remain outside CI.

`bun run check` passed on this machine: TypeScript clean, 158 tests passed, zero failed across 27 files. This includes CLI parsing, mixed-outcome request totals and per-route report data, virtual-clock HTTP workload tests against the real Hono/SQLite app, the 95% capacity boundary with successful slow responses, full-body timeout/drain coverage, reset rollback/confirmation/isolation, default rate-limit/spoof/expiry coverage and production startup override validation. Linux verification is left to the existing Windows/Linux CI matrix.

## Proxy and start-limit regression evidence (2026-11-20)

Validated the issue #33 change on the factory's Windows machine with Bun 1.4.2. `bun run check` passed (223 tests, zero failures, TypeScript clean); `bun run pacing` passed the default 20-case matrix and all four gates. `bun run build` passed. No per-frame code changed.

The existing `runLoad` harness ran its default 500-player, 60-second workload against the real production entry point and a fresh scratch database with `LOAD_TEST_START_LIMIT=10000`. A temporary launcher replaced only Bun's listener configuration with an owned socket inside the scratch directory; the harness fetch adapter connected through that socket. Server and generator shared the factory process/machine, so these figures are local regression evidence rather than TCP or Railway capacity measurements. The app used a scratch home, and no operator data or existing server was accessed.

- Accepted starts/finishes: **500/500**; requests: **28,184**; failures: **{}**; zero 5xx; all required read routes observed; **PASS**.
- Scheduling/drain: **60.001/0.029 seconds**. **97.68%** of requests succeeded under 200 ms. Overall p50/p95/p99: **3.61/59.88/551.00 ms**. Start p95: **1018.18 ms**; finish p95: **169.06 ms**.
- With the same IP override, a repeated player received 201 for attempts 1–40 and 429 with positive `Retry-After` for attempt 41. Automated proxy tests separately accepted 600 starts from 300 distinct forwarded IPs through one peer, and verified the default shared-IP 300/301 boundary.

Headless installed Chrome **157.0.8103.51**, with touch emulation, loaded the production bundle through an interception adapter to an owned socket server with a separate scratch database. A player whose start budget was exhausted still played to death and displayed exactly “Too many runs right now. Your next run will save.” At **390×844**, the paragraph occupied 342×48 px; at **844×390**, 500.61×24 px. Neither layout overflowed horizontally; the 115×48 px restart button remained reachable by scrolling in landscape. Screenshots were inspected. Tapping restarted in **83.52/84.03 ms**, respectively, while the subsequent start response was deliberately held for two seconds. No browser page errors occurred. Owned servers and Chrome were stopped afterward.

These checks do **not** verify Railway's ingress headers. The isolated, two-network [pre-stream proxy verification](../architecture.md#pre-stream-proxy-verification) remains the deployment procedure before enabling `TRUST_PROXY_HOPS=1`.

## Name-moderation aggregation regression (issue #35, 2026-11-20)

Validated the issue #35 implementation based on `ecca27f3258ddc0f4ca04a62a50dc61e8df5e073` on the same Windows 11 factory workstation and Bun 1.4.2 described above. `bun run check` passed TypeScript and all 393 tests; `bun run pacing` passed the default 20-case matrix and all four gates; `bun run build` passed. No frame-loop work or dependencies were added.

The unchanged `runLoad` harness exercised the real production entry point with 500 players for 60 seconds, `NODE_ENV=production`, `LOAD_TEST_START_LIMIT=10000`, a fresh scratch database and a scratch home. As in the issue #33 measurement, a temporary launcher replaced only `Bun.serve`'s listener options with `{ unix: <scratch-directory>/app.sock, fetch: options.fetch }`; the harness runtime used `fetch(url, { ...init, unix: socket })`, real monotonic time and the existing sleep function. No TCP listener or existing server was used. Server and generator shared the factory machine/process, with no project checks running during measurement. These are local aggregation regression measurements, not Railway or network capacity evidence. The owned socket server was stopped in `finally`, and the launcher process exited after each run.

- A separate smoke process/database first passed 5 players / 6 seconds: 54 requests, 5 accepted starts and finishes, zero failures, 100% under 200 ms; overall p50/p95/p99 **0.80/22.65/22.67 ms**.
- Measured workload: **500/500** accepted starts/finishes, **27,902** requests, failures **{}**, zero 5xx/timeouts/transport/invalid-response failures, all required reads observed; **PASS** (exit 0).
- Scheduling/drain: **60.003/0.020 seconds**. **96.69%** of requests succeeded in strictly under 200 ms, above the 95% target. The synchronized start burst remains the slowest route.

| Method and route | Requests | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| POST /api/runs | 500 | 1007.16 | 1931.70 | 1931.76 |
| POST /api/runs/:runId/finish | 500 | 107.72 | 199.39 | 333.51 |
| GET /api/players/:playerId/best | 1,000 | 86.79 | 199.23 | 333.79 |
| GET /api/leaderboard | 12,951 | 3.36 | 136.78 | 212.46 |
| GET /api/teams | 12,951 | 3.35 | 137.36 | 215.65 |
| Overall | 27,902 | 3.72 | 150.82 | 1006.86 |

Post-run stats reported `players: 500`, `finished_runs: 500`, `median_runs_per_player: 1.0`, `touch_share: 50%`. The leaderboard contained ten valid entries, and team totals were `{ "tabs": 52414, "spaces": 52211 }`. Automated legacy fixtures separately prove that newly blocked/reserved players disappear from both boards while all stored rows, personal bests, events and bet contributions survive.
