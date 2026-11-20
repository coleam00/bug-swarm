# Bug Swarm

A 2-minute browser survival game for a livestream audience: steer a robot through a growing swarm of bugs, pick upgrades, and land on a shared top 10 and a Tabs vs Spaces team race.

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
