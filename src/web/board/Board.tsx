import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { TEAM_COLOURS, TEAM_NAMES, TEAMS } from "../../shared/teams";
import { api } from "../game/api";
import { displayScore, exactScore } from "./model";
import { BoardController } from "./polling";
import "./board.css";

export function Board({ controller: supplied, origin = window.location.origin }: { controller?: BoardController; origin?: string }) {
  const [controller] = useState(() => supplied ?? new BoardController(api));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => {
    document.title = "Bug Swarm — Stream Board";
    controller.start();
    return controller.stop;
  }, [controller]);
  const race = state.teams.data, rows = state.leaders.data;
  const reconnecting = state.leaders.failed || state.teams.failed;
  return <main className="stream-board">
    <header className="board-header"><h1>Bug Swarm</h1><p>Tabs vs Spaces</p></header>
    <section className="board-race" aria-label="Team race">
      <div className="board-teams">{TEAMS.map(team => <div key={team}
        className={`board-team${race?.highlightUntil[team] ? " board-highlight" : ""}`}
        style={{ "--team-colour": TEAM_COLOURS[team] } as CSSProperties}>
        <h2>{TEAM_NAMES[team]}</h2>
        <strong title={race ? exactScore(race.totals[team]) : undefined} aria-label={race ? `${exactScore(race.totals[team])} points` : undefined}>
          {race ? displayScore(race.totals[team]) : "—"}
        </strong>
      </div>)}</div>
      <div className={`board-race-bar${race && !race.totals.tabs && !race.totals.spaces ? " board-neutral" : ""}`} aria-hidden="true">
        {TEAMS.map(team => <span key={team} style={{ width: `${(race?.shares[team] ?? 0.5) * 100}%`, background: TEAM_COLOURS[team] }} />)}
      </div>
      <p className="board-race-note">{!race ? "Waiting for team scores…" : !race.totals.tabs && !race.totals.spaces ? "No team scores yet" : "Every finished run counts"}</p>
    </section>
    <section className="board-leaders" aria-labelledby="board-top-ten">
      <h2 id="board-top-ten">Top 10</h2>
      {rows?.length ? <ol>{rows.map(row => <li key={row.playerId} className={row.highlightUntil ? "board-highlight" : undefined}>
        <div className="board-name"><span className="board-rank" aria-hidden="true">{row.rank}</span><span>{row.name}</span></div>
        <strong className="board-score" title={exactScore(row.score)} aria-label={`${exactScore(row.score)} points`}>{displayScore(row.score)}</strong>
      </li>)}</ol> : <p className="board-empty">{rows === null ? "Waiting for the top 10…" : "First score takes the lead. Join in!"}</p>}
    </section>
    <footer className="board-footer"><p>Join the game: <a href={origin}>{origin}</a></p>
      <span className="board-status" role="status">{reconnecting ? "Reconnecting…" : ""}</span>
    </footer>
  </main>;
}
