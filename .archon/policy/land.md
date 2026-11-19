# Land policy: Bug Swarm

Shadow only in the pack today: the judgment is recorded and nothing acts on it. The operator merges every change after playing it.

A ready change may merge without asking only when all of these hold:

- Every CI check (Linux and Windows) is green on the head commit, and the change still merges cleanly with `main`. When `main` moved since CI ran, CI runs again on the change brought up to date.
- The operator has played the changed game in a browser (name entry, a full run, game over, top 10) when the change touches anything a player sees.
- It keeps the PRD's invariants: one-thumb play, the game never waits on the server, names pass the rules, 58+ fps with 150 bugs.

After a merge `main` must stay green: a red `main` is fixed forward before the next change merges. `main` deploys to players.
