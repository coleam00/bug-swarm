# Bug Swarm Arena: a multiplayer skill shooter a whole livestream plays together

> **Release:** 2 (Arena) · **Kind:** real-time multiplayer browser game · **Owner:** coleam00 · Release 1 history: `docs/prd-release-1.md`

## Problem

Release 1 was a single-player survival game where the robot fired on its own: you only dragged around, so there was no skill, nothing to get better at, and no reason to care that other viewers were playing. On Sat 11/28 (9:00 AM CT) several hundred livestream viewers need something they actually want to play together for an hour or more, on phones and laptops, while the owner's AI software factory ships chat's ideas into it live.

## The bet

- **Hypothesis:** If viewers drop into shared arenas where they aim, fight the swarm together and race for their team, at least 150 viewers will play during the stream and the median player will play at least 3 lives, because skill, other people and the team race make "one more life" compelling.
- **Command:** `bun run stats -- --since <ISO> --until <ISO>` prints the same four lines as release 1, where a **run is one life** in the arena (spawn to out): `players`, `finished_runs`, `median_runs_per_player`, `touch_share` (share of lives played with touch controls).
- **Threshold:** `players` ≥ 150 and `median_runs_per_player` ≥ 3.0 during the stream window (Sat 11/28 9:00 to 11:00 AM CT).
- **Skill is measurable:** a scripted bot that aims (leads its target, fires in bursts, keeps distance) must score far more than a bot that only moves and fires straight ahead, in the same seeded arena. The first item that adds aiming reports both bots' numbers; the owner then fixes the threshold in this file.

## Outcome

- Opening the link shows a clean start screen: the title, a name field and two team buttons (Tabs, Spaces). Return visitors skip straight to one tap.
- Joining drops you into the arena that has room (up to 20 players). You see the other players, their names and team colours, live.
- You move and aim separately and shoot by holding fire. Shots travel; the gun overheats if held too long. Swarm pressure starts low with each life and rises with that life's age, so late joiners get an opening. Bugs chase the nearest player, so groups share pressure. The 30-second wave clock unlocks kinds and events; it never multiplies spawn volume. Each kind needs a different answer (dodge the dasher's lunge, sidestep the spitter's shots, flank the armoured beetle).
- 3 hits put you down. A teammate who stands next to you for 2 seconds revives you; if nobody does within 10 seconds, your life ends, your score is saved and one tap drops you back in.
- Kills score by bug kind; consecutive hits build an accuracy multiplier that a miss resets; reviving a teammate scores too. Every point counts for your team.
- Pickups dropped by bugs (spread shot, rapid fire, shield) give short boosts you have to go and grab.
- Every few waves a boss arrives that only a group can take down.
- `/board` shows the top 10 lives, the Tabs vs Spaces totals and how many people are playing right now, readable on a stream.
- Merges during the stream redeploy the game; players are reconnected automatically and nobody loses a life's score to a deploy.

## Invariants

- Opening the link to playing: under 10 seconds on a first visit, under 2 on a return visit.
- The server simulation is authoritative. Clients send only inputs (move direction, aim direction, fire held, revive intent). Scores, hits and kills are decided by the server.
- Each arena holds at most 20 players; a full arena sends new players to another arena. One server process (one Railway instance) handles at least 200 connected players across arenas with a server tick under 10 ms at p95, measured by the bot load test.
- Clients render at 60 fps with a full arena on a mid-range laptop and phone (desktop Chrome with device emulation counts as evidence).
- 20 Hz server ticks; clients interpolate other entities and predict their own movement so controls feel immediate on a 100 ms connection.
- Redeploy-safe: on server shutdown every life in progress is ended and saved with its score; clients reconnect with backoff and reload when the server's build id changes.
- Every name shown passes the name rules (2 to 16 characters; blocked words refused) and `bun run hide "<name>"` removes the name from every board and from live arenas within 5 seconds.
- No account, no purchases, no ads, no audio.

## Acceptance (the whole release)

- [ ] Two browsers and 18 bots share one arena; each browser sees the others move, shoot, get hit, go down and be revived, in real time.
- [ ] Desktop: WASD/arrows move, the mouse aims, holding the mouse button or Space fires. Phone (two-point touch emulation counts): left thumb moves, right thumb aims and fires while held.
- [ ] Shots travel and can miss; holding fire overheats the gun; the aiming bot out-scores the moving-only bot by the release's threshold over seeded arenas.
- [ ] At least four bug kinds with distinct behaviours and visible tells; waves unlock kinds and events independently of personal pressure; a boss every fifth wave needs several players.
- [ ] Downed players can be revived by teammates; lives end after 10 s down; one tap respawns.
- [ ] Scores are server-side; the top 10, best, team totals and `/board` show arena lives; `bun run stats` counts lives.
- [ ] `bun run bots -- --url <base> --count 200 --seconds 120` runs 200 WebSocket bots across arenas and reports server tick p50/p95, message rates and errors; p95 tick < 10 ms.
- [ ] Killing the server mid-arena saves every life in progress; restarting it, clients reconnect without a manual reload, and a changed build id reloads them.
- [ ] The start screen is the title, a name field, two team buttons and nothing else (errors appear only when something is wrong).

## How the work is filed

There are no phase gates: the factory takes small items in dependency order from the owner (the orchestrator), each one pull request, each leaving `main` playable. The arena runs at `/` through the shared start screen; `/arena` redirects there. Release 1 gameplay is retired.

## Non-goals

- Accounts, sign-in, saved progress, purchases, ads, audio.
- Player-versus-player damage (no friendly fire).
- Reading YouTube chat or any outside service.
- A matchmaking service, regions or more than one server process.

## Decided by the owner (11/20/2026)

- Release 1's mechanics (auto-fire, drag-only, pause-for-upgrade every 20 s) are retired; the upgrade pause can't exist in a shared arena and is replaced by pickups.
- A run is one life. Teams stay Tabs vs Spaces. Names, moderation, `hide`, `stats`, `reset`, Railway hosting and the Dockerfile stay.
- Scores are computed by the server, so the release 1 score plausibility check and the 3,000-point review hold do not apply to arena lives.
- Evidence of frame rate, touch and layout: Chrome on the factory's machine, headless or with device emulation, counts. Never ask for a physical device.
