# Direction

Bug Swarm is a real-time multiplayer arena for a livestream audience: everyone who opens the link drops into a shared arena with other viewers, aims and shoots their way through waves of bugs, keeps teammates alive, and climbs a shared top 10 and a Tabs vs Spaces team race the stream shows live.

This is release 2. Release 1 (a single-player, auto-fire survival game) shipped and was judged not fun: no aiming, no skill, and no reason to care that other people were playing. Release 1's PRD is kept in `docs/prd-release-1.md` for history only. Where release 1 code, docs or tests contradict this file, this file wins.

## It is
- A browser game that opens from a link in seconds, with a name, a team and no account.
- **Multiplayer for real:** you see the other players in your arena move, shoot, get hit and revive each other, live. A busy stream fills several arenas; each arena holds up to 20 players.
- **A skill game:** you aim every shot. Shots travel, so you lead moving targets. The gun overheats if you hold the trigger, so bursts beat spraying. Bugs dodge, lunge, spit and shield themselves, so where you stand and when you shoot matter. A good player scores many times what a player who only runs around scores.
- **Co-op inside, competitive outside:** everyone in an arena fights the same swarm; a downed player is revived by a teammate standing next to them. Every point counts for your team, Tabs or Spaces.
- Controls: on a computer, WASD or arrows to move, the mouse to aim, hold the mouse button (or Space) to fire. On a phone, twin sticks: the left thumb moves, the right thumb aims and fires while held. Landscape is the best phone layout; portrait still works.
- Short lives, instant respawn: a life usually lasts 1 to 4 minutes, and one tap drops you back in.
- A big-type board page for the stream: top 10, the team race and how many people are playing right now.

## It is not
- Single-player. No mode where you play alone against a local simulation.
- Auto-aim or auto-fire. Nothing shoots for you.
- An account system or saved progress between lives.
- Monetized: no purchases, no ads.
- Audio, this release.
- Connected to YouTube chat or any other outside service.

## The look
Drawn entirely in code on the canvas (no image files, no art pipeline), and it should feel like a real arcade game:
- **Arena:** a large dark floor with a faint glowing grid; the camera follows you, and a small minimap shows teammates and the swarm.
- **Players:** rounded robots in their team colour (Tabs orange, Spaces teal) with a name tag, a glowing core, a short trail, and a barrel that points where they aim. You are always easy to find: a brighter ring around your own robot.
- **Bugs:** beetle-like bodies with animated legs; every kind has its own colour, size and a readable "tell" before it does something dangerous (a dasher crouches and glows before it lunges; a spitter swells before it fires).
- **Shots:** bright streaks with a glow; hits spark, kills burst into particles with a floating score.
- **Heat:** a small bar by your robot fills as you fire and flashes before it overheats.
- **Text:** big, bold, readable on a phone and on a stream shown small. Screens are clean: no rule lists, no fine print.
The look never costs frames: 60 fps with a full arena (20 players, 150 bugs, their shots) on a mid-range laptop and phone.

## Principles
- **Skill decides the score.** Every mechanic is judged by whether it makes aiming, moving and timing matter more. A change that lets you score without aiming doesn't ship.
- **Other players matter.** Seeing, helping and racing other people is the point; every screen shows that you're not alone.
- **The server is the referee.** The arena simulation runs on the server; clients send inputs and draw what the server says. Scores come from the server, never from a client.
- **Merges happen live.** The game redeploys on every merge during the stream: clients reconnect on their own, reload to the new version, and a player's life in progress is saved, never lost silently.
- **Time to the next life beats everything:** no menus or confirmations between going down and dropping back in.
- **Clean screens:** the start screen is a title, a name field and two team buttons. Rules appear only as a short message when something is wrong.
- Anything a viewer types that appears on screen passes the name rules first. The stream is public.
- Every new bug, weapon pickup or effect is small enough to ship in one pull request, because chat will ask for them live.

## Current release
See `PRD.md`.
