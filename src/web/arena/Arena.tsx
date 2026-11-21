import { useEffect, useRef, useState } from "react";
import type { Identity } from "../../shared/api";
import { HIDDEN_IDENTITY_MESSAGE } from "../../shared/arena/protocol";
import { TEAMS, TEAM_COLOURS, TEAM_NAMES, type Team } from "../../shared/teams";
import { validateName } from "../../server/rules";
import { loadIdentity, storeIdentity } from "../game/identity";
import { mountArena } from "./engine";
import { consumeResume, resumeStore } from "./resume";
import { ArenaResults, type ResultsView } from "./results";
import { api } from "../game/api";
import { PersonalStanding, TeamRace } from "../results/Results";
import { exactScore } from "../format";
import "./arena.css";
function saved() { try { return loadIdentity(localStorage); } catch { return null; } }
export function Arena() {
  const [resume] = useState(() => { const value = resumeStore.read(); return value?.resume ? value : null; });
  useEffect(() => { if (resume) consumeResume(); }, [resume]);
  const [identity, setIdentity] = useState(saved), [name, setName] = useState(identity?.name ?? "");
  const [session, setSession] = useState<Identity | null>(resume?.identity ?? null), [error, setError] = useState("");
  const touch = useRef(resume?.touch ?? false);
  function remember(next: Identity) { try { storeIdentity(localStorage, next); } catch (error) { console.error("Identity storage unavailable", error); } setIdentity(next); }
  function join(team: Team) {
    const result = validateName(name); if (result.error) { setError(result.error); return; }
    const next = { playerId: identity?.playerId ?? crypto.randomUUID(), name: result.name!, team: identity?.team ?? team };
    setError(""); setSession(next);
  }
  if (session) return <ArenaGame identity={session} touch={touch.current} onAccepted={() => remember(session)} onError={(message, team, code) => {
    if (team) { if (identity) remember({ ...identity, team }); setSession({ ...session, team }); return; }
    setError(code === "name-hidden" && identity ? HIDDEN_IDENTITY_MESSAGE : message); setSession(null);
  }} />;
  return <main className="arena-entry"><form onSubmit={event => { event.preventDefault(); if (identity?.team) join(identity.team); else setError("Choose Tabs or Spaces."); }} onPointerDown={event => { if (event.pointerType === "touch") touch.current = true; }}>
    <h1>Bug Swarm</h1>
    <label htmlFor="arena-name">Your name</label>
    <input id="arena-name" value={name} onChange={event => setName(event.target.value)} readOnly={!!identity} maxLength={16} autoComplete="off" autoFocus={!identity} />
    {error && <p role="alert">{error}</p>}
    <div className="arena-teams">{(identity?.team ? [identity.team] : TEAMS).map(team => <button key={team} type="button" style={{ background: TEAM_COLOURS[team] }} onClick={() => join(team)}>Join {TEAM_NAMES[team]}</button>)}</div>
  </form></main>;
}
function ArenaGame({ identity, touch, onAccepted, onError }: { identity: Identity; touch: boolean; onAccepted: () => void; onError: (message: string, team?: Team, code?: string) => void }) {
  const [life, setLife] = useState<ResultsView | null>(null);
  const replay = useRef<(touch: boolean) => void>(() => {});
  const press = useRef<{ id: number; x: number; y: number; life: ResultsView } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), error = useRef(onError), accepted = useRef(onAccepted), [status, setStatus] = useState("Connecting…");
  error.current = onError; accepted.current = onAccepted;
  useEffect(() => {
    const results = new ArenaResults(identity.playerId, api, setLife);
    const unmount = mountArena(canvas.current!, identity, touch, setStatus, (message, team, code) => error.current(message, team, code), () => accepted.current(),
      (result, respawn) => { press.current = null; replay.current = respawn; results.show(result); });
    const clear = () => { press.current = null; };
    window.addEventListener("blur", clear); document.addEventListener("visibilitychange", clear);
    return () => { unmount(); results.dispose(); window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear); };
  }, [identity.playerId]);
  return <main className="arena-game"><canvas ref={canvas} aria-label="Shared arena" tabIndex={0} />{status && <p role="status" className="arena-status">{status}</p>}
    {life && <div className="arena-life" role="dialog" aria-label="Life over"
      onPointerDown={event => { press.current = event.button === 0 ? { id: event.pointerId, x: event.clientX, y: event.clientY, life } : null; }}
      onPointerMove={event => { const start = press.current; if (start?.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 10) press.current = null; }}
      onPointerCancel={() => { press.current = null; }}
      onPointerUp={event => {
        const start = press.current; press.current = null;
        if (start?.id === event.pointerId && start.life.result.life === life.result.life && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10) replay.current(event.pointerType === "touch");
      }}>
      <div className="arena-life-content"><div><h1>Life over</h1><strong className="life-score">Score {exactScore(life.result.score)}</strong>
        <p role="status">{life.result.save === "saved" ? "Score saved" : life.result.save === "failed" ? "Save failed" : "Saving score…"}</p>
        <p>Best: {life.bestStatus === "loading" ? "Loading…" : life.bestStatus === "failed" ? "Unavailable" : life.best === null ? "No saved runs yet" : exactScore(life.best)}</p>
      </div><div><PersonalStanding status={life.standingStatus} standing={life.standing} showNextInTopTen />
        <TeamRace status={life.teamsStatus} totals={life.teamTotals} />
      </div><button onClick={event => { if (event.detail === 0) replay.current(false); }}>Play again</button></div></div>}
  </main>;
}
