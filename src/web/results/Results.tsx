import type { Standing, TeamTotals } from "../../shared/api";
import { TEAMS, TEAM_NAMES, TEAM_COLOURS } from "../../shared/teams";
import { exactScore } from "../format";
import "./results.css";
export type ReadStatus = "loading" | "ready" | "failed";

export function PersonalStanding({ status, standing, showNextInTopTen = false }: { status: ReadStatus; standing: Standing | null; showNextInTopTen?: boolean }) {
  if (status === "loading") return <p>Loading ranking…</p>;
  if (status === "failed" || !standing) return <p>Ranking unavailable</p>;
  const { rank, total, next } = standing;
  if (rank === null) return <p>Not ranked</p>;
  return <div className="personal-standing">
    <p>Your best is #{exactScore(rank)} of {exactScore(total)}</p>
    {rank <= 10 && <p>You're in the top 10!</p>}
    {(rank > 10 || showNextInTopTen) && next &&
      <p>{exactScore(next.pointsToBeat)} {next.pointsToBeat === 1 ? "point" : "points"} to beat #{exactScore(next.rank)}</p>}
  </div>;
}

export function TeamRace({ status, totals }: { status: ReadStatus; totals: TeamTotals | null }) {
  if (status === "loading") return <p role="status">Loading team totals…</p>;
  if (status === "failed" || !totals) return <p role="status">Couldn't load team totals</p>;
  const sum = totals.tabs + totals.spaces;
  return <div className="team-race" aria-label="Tabs vs Spaces">
    <div className="team-labels">{TEAMS.map(team => <span key={team} style={{ color: TEAM_COLOURS[team] }}>{TEAM_NAMES[team]} <strong>{exactScore(totals[team])}</strong></span>)}</div>
    <div className={`race-bar${sum ? "" : " empty"}`} aria-hidden="true">{TEAMS.map(team => <span key={team} style={{ width: `${sum ? totals[team] / sum * 100 : 50}%`, background: sum ? TEAM_COLOURS[team] : "#7f91a9" }} />)}</div>
    {!sum && <p>No team scores yet</p>}
  </div>;
}
