# Bug Swarm

A real-time multiplayer arena shooter for a livestream audience: viewers share arenas, aim and shoot through waves of bugs, revive teammates, and race for Tabs or Spaces on a shared top 10. Release 2 (Arena) is in progress; release 1's single-player game still runs at `/` until it is replaced.

- What we're building and why: `PRD.md`
- What's in and out of scope: `direction.md`
- Stack, how it runs, and the shape: `architecture.md`
- Conventions every change follows: `engineering.md`

Quick commands:
- `bun install` then `bun run dev`
- `bun run check` must pass before any pull request.
- `/arena` is the release 2 combat slice. `bun run bots -- --url http://127.0.0.1:3000 --count 18 --seconds 60 --policy aimer` fills a locally started arena; `mover` is also available. Use separate browser storage contexts for different human identities. Press F for frame timings. Evidence: `docs/arena-combat-validation.md`.
- `bun run skill` compares both shared policies over 20 seeds, eight bots and 180 seconds; it requires the aimer median score to be at least twice the mover's.
- `bun run stats` prints the bet's numbers. `bun run hide "<name>"` hides a name from every board.
- `bun run review` lists held release 1 scores; `bun run approve <run id>` releases one. Release 1 scores strictly above 3,000 await review and do not count on public boards, personal standings or team totals until approved. Authoritative arena lives are saved without a review hold. Commands use `DATA_DIR/app.db` (default `data/app.db`).
- Pacing reports review candidates without failing on them.

## Evidence files

Screenshots, logs and measurements made while validating a change go in `.evidence/<issue number>/` inside this checkout (gitignored), and are summarized in the pull request. Never write files outside the checkout: Archon's workflow and source folders are fingerprinted, and writing into them fails the run.
