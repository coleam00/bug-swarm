# Personal level and screen copy (#88)

The HUD presents personal pacing milestones as Lv 1/2/3/4 at life ages
0/60/120/240 seconds, capped at four. Authoritative tick and startedTick set
the level; animation time, arena wave and delayed combat time do not.
Revival retains age, respawn resets it, and terminal results freeze it.
Boss presentation remains in #84 under the owner's scope split.

`level.test.ts` checks each milestone immediately before, at and after its
boundary, negative age and an hour-old life. `draw.test.ts` checks an old-arena
join with conflicting prediction/time, cache refresh across milestones,
revival, respawn, terminal identity and duration, fallback without a snapshot,
exact downed wording, and large-score fitting with 20 connected players at
1280x720, 844x390 and 390x844. Board tests distinguish unavailable totals from
zero and require the exact document title. The production copy scan checks
decoded TypeScript/TSX literals and templates, JSX text/attributes, HTML copy
and CSS strings, including encoded dashes; comments and test fixtures are
excluded. No documentation pages are served or linked by the player UI.

## Chrome evidence

After `bun run build`, run `bun scripts/validate-level.ts`. Chrome can be
selected with `CHROME_PATH`. The driver starts its own ephemeral loopback
server, database, scratch home and Chrome profile, writes only inside
`.evidence/88/`, and closes its server, bots and browser afterward.

Validated with Chrome 157.0.8103.51. The final capture directory is
`.evidence/88/production-G9Dvdc/`; `report.json` records each screenshot's
tick, wave, startedTick, life status, viewport, HUD text and timing data.

- `level-{1,3,4}-{1280x720,844x390,390x844}.png`: ages 0, 120 and 240
  seconds in an old arena (wave 125+). These are controlled timestamp fixtures
  on the production server, rather than claims of surviving those durations.
- `downed-{1280x720,844x390,390x844}.png`: exact sentence and separate
  countdown. The short copy fits one line at 390 px in Chrome.
  `downed-300x640.png` also proves the two-line fallback.
- `revived-*.png` and `respawn-*.png`: real simulation revival retains
  startedTick and Lv 4; normal respawn returns to Lv 1.
- `board-{loading,failed,zero}.png`: browser-only response fixtures prove
  ellipsis placeholders, reconnect feedback and successful zero values.
- `full-room-*.png`: F readout and phone layouts. Simultaneous two-point
  touch input still moves and fires, with no client errors or overflow.

The normal bot window finishes before timestamp and bug-clearing fixtures.
Eighteen aimers over 60 seconds plus two immune browser observers maintained
20 connected players, with 18 joins, zero errors and tick p95 **2.691 ms**.
Twelve F samples covered desktop and both phone layouts, including a developed
swarm: desktop update/draw **0.225 to 1.353 ms/frame**, phone **0.182 to
1.256 ms/frame**. This is headless Chrome with device emulation and canvas
observation enabled. The added runtime work is at most three pressure-milestone
comparisons per frame; text fitting remains cached by displayed values.
