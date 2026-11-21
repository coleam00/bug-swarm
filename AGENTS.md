# Bug Swarm

A real-time multiplayer arena shooter for a livestream audience: viewers share arenas, aim and shoot through waves of bugs, revive teammates, and race for Tabs or Spaces on a shared top 10. The arena runs at `/`; release 1 gameplay is retired.

- What we're building and why: `PRD.md`
- What's in and out of scope: `direction.md`
- Stack, how it runs, and the shape: `architecture.md`
- Conventions every change follows: `engineering.md`

Quick commands:
- `bun install` then `bun run dev`
- `bun run check` must pass before any pull request.
- `bun run playtest -- --issue <item-number>` runs the factory multiplayer product check using installed headless Chrome (`CHROME_PATH` overrides discovery). Every change to arena gameplay, networking or UI runs the relevant scenarios (`--scenario together|combat|revive|late-join|phone-desktop|restart|boss`) and attaches the JSON report and key screenshots to its pull request. The factory runs the full playtest on every PR; it remains separate from `check`.
- `/` is the arena; `/arena` redirects there. `bun run bots -- --url http://127.0.0.1:3000 --count 18 --seconds 60 --policy aimer` fills a locally started arena; `mover` is also available. Use separate browser storage contexts for different human identities. Press F for frame timings. Evidence: `docs/arena-combat-validation.md`.
- `bun run skill` compares both shared policies over 20 seeds, eight bots and 180 seconds (aimer median score ≥ 2× mover), then measures independent newcomers: eight-minute joins must reach 80% of fresh aimer survival, and idle medians must reach 10 seconds at every 15-second arena age from 0 through 900 seconds. Raw cohort observations and censoring are printed.
- `bun run stats` prints the bet's numbers. `bun run hide "<name>"` hides a name from every board.
- `bun run review` lists held release 1 scores; `bun run approve <run id>` releases one. Release 1 scores strictly above 3,000 await review and do not count on public boards, personal standings or team totals until approved. Authoritative arena lives are saved without a review hold. Commands use `DATA_DIR/app.db` (default `data/app.db`).

## Evidence files

Screenshots, logs and measurements made while validating a change go in `.evidence/<issue number>/` inside this checkout (gitignored), and are summarized in the pull request. Never write files outside the checkout: Archon's workflow and source folders are fingerprinted, and writing into them fails the run.

Playtest defaults to `.evidence/<issue>/playtest/<run-id>/`. `--out <folder>` must resolve inside this checkout, including existing junction/symlink ancestors. It owns its loopback server, scratch data/home and Chrome profiles. Do not point it at an existing server. Reports include each scenario's checks, screenshots, page FPS/frame timings and server tick p95; failures retain diagnostics and exit nonzero. `boss` checks the registered fifth-wave hive's body, health, edge arrow and contributor rewards; it skips only when the hive is unavailable.
