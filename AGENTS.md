# Bug Swarm

A real-time multiplayer arena shooter for a livestream audience: viewers share arenas, aim and shoot through waves of bugs, revive teammates, and race for Tabs or Spaces on a shared top 10. Release 2 (Arena) is in progress; release 1's single-player game still runs at `/` until it is replaced.

- What we're building and why: `PRD.md`
- What's in and out of scope: `direction.md`
- Stack, how it runs, and the shape: `architecture.md`
- Conventions every change follows: `engineering.md`

Quick commands:
- `bun install` then `bun run dev`
- `bun run check` must pass before any pull request.
- `bun run stats` prints the bet's numbers. `bun run hide "<name>"` hides a name from every board.
- `bun run review` lists held scores; `bun run approve <run id>` releases one. Scores strictly above 3,000 await review, including honest outliers, and do not count on public boards, personal standings or team totals until approved. Commands use `DATA_DIR/app.db` (default `data/app.db`).
- Pacing reports review candidates without failing on them.
