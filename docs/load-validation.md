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

This deletes all gameplay history, including real players, abandoned runs and legacy events. It preserves hidden-name moderation and the schema. It cannot delete only the `load-` players. Restart the server with `LOAD_TEST_START_LIMIT` unset (PowerShell: `Remove-Item Env:LOAD_TEST_START_LIMIT`; POSIX: `unset LOAD_TEST_START_LIMIT`). Restarting clears the read caches and rate-limit buckets as well. The default is again 30 starts per IP per ten minutes.

## Factory evidence

Measurements are recorded below after running the production server on the factory machine.
