import { useEffect, useRef, useState } from "react";
import type { Identity } from "../../shared/api";
import { TEAMS, TEAM_COLOURS, TEAM_NAMES, type Team } from "../../shared/teams";
import { validateName } from "../../server/rules";
import { loadIdentity, storeIdentity } from "../game/identity";
import { mountArena } from "./engine";
import "./arena.css";
function saved() { try { return loadIdentity(localStorage); } catch { return null; } }
export function Arena() {
  const [identity, setIdentity] = useState(saved), [name, setName] = useState(identity?.name ?? "");
  const [session, setSession] = useState<Identity | null>(null), [error, setError] = useState("");
  const touch = useRef(false);
  function remember(next: Identity) { try { storeIdentity(localStorage, next); } catch (error) { console.error("Identity storage unavailable", error); } setIdentity(next); }
  function join(team: Team) {
    const result = validateName(name); if (result.error) { setError(result.error); return; }
    const next = { playerId: identity?.playerId ?? crypto.randomUUID(), name: result.name!, team: identity?.team ?? team };
    setError(""); setSession(next);
  }
  if (session) return <ArenaGame identity={session} touch={touch.current} onAccepted={() => remember(session)} onError={(message, team) => {
    if (team) { if (identity) remember({ ...identity, team }); setSession({ ...session, team }); return; }
    setError(message); setSession(null);
  }} />;
  return <main className="arena-entry"><form onSubmit={event => { event.preventDefault(); if (identity?.team) join(identity.team); else setError("Choose Tabs or Spaces."); }} onPointerDown={event => { if (event.pointerType === "touch") touch.current = true; }}>
    <h1>Bug Swarm</h1>
    <label htmlFor="arena-name">Your name</label>
    <input id="arena-name" value={name} onChange={event => setName(event.target.value)} readOnly={!!identity} maxLength={16} autoComplete="off" autoFocus={!identity} />
    {error && <p role="alert">{error}</p>}
    <div className="arena-teams">{(identity?.team ? [identity.team] : TEAMS).map(team => <button key={team} type="button" style={{ background: TEAM_COLOURS[team] }} onClick={() => join(team)}>Join {TEAM_NAMES[team]}</button>)}</div>
  </form></main>;
}
function ArenaGame({ identity, touch, onAccepted, onError }: { identity: Identity; touch: boolean; onAccepted: () => void; onError: (message: string, team?: Team) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), error = useRef(onError), accepted = useRef(onAccepted), [status, setStatus] = useState("Connecting…");
  error.current = onError; accepted.current = onAccepted;
  useEffect(() => mountArena(canvas.current!, identity, touch, setStatus, (message, team) => error.current(message, team), () => accepted.current()), [identity.playerId]);
  return <main className="arena-game"><canvas ref={canvas} aria-label="Shared arena" tabIndex={0} />{status && <p role="status" className="arena-status">{status}</p>}</main>;
}
