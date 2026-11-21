# Standings

The shared read-only scores client and ArenaResults read authoritative bests, personal standings and team totals after a life ends and every two seconds while results are visible. Tests cover next-rank gaps inside the top ten, failed/slow reads, stale responses and cleanup. `src/server/review.test.ts` seeds held legacy rows and proves approval reaches both BoardController and ArenaResults within five seconds, retaining hidden-name filtering. Production layout evidence: [cutover-validation.md](cutover-validation.md).
