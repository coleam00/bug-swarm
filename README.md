# Bug Swarm

A real-time multiplayer arena shooter for a livestream audience. Open the link, pick a name and a team (Tabs or Spaces), and drop into a shared arena of up to 20 players: aim every shot, revive your teammates, and climb the top 10 and the team race.

**Play:** https://bug-swarm-production.up.railway.app · **Stream board:** https://bug-swarm-production.up.railway.app/board

Built by an AI software factory ([Archon](https://github.com/coleam00/Archon)): every change was planned, built, reviewed and validated as its own pull request.

## Run it locally

```bash
bun install
bun run dev        # API server + Vite dev server
bun run check      # type-check + tests
bun run bots -- --url http://localhost:3000 --count 20 --seconds 60
bun run playtest   # multi-browser playtest
```

## Docs

- `direction.md` and `PRD.md`: what the game is and the release 2 bet
- `architecture.md`, `engineering.md`, `validation.md`: how it is built and checked
- `docs/`: per-feature validation evidence; `docs/prd-release-1.md` is release 1 history

## Factory runtime

The factory's working files for this repo (item bodies, run log, probes, the Railway deploy and test-bot helpers) live in a separate private repo: [coleam00/bug-swarm-runtime](https://github.com/coleam00/bug-swarm-runtime).
