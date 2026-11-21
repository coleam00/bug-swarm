import { useEffect, useRef, useState } from "react";
import type { Identity } from "../../shared/api";
import { HIDDEN_IDENTITY_MESSAGE } from "../../shared/arena/protocol";
import type { Team } from "../../shared/teams";
import { StartScreen, type StartRequest } from "../entry/StartScreen";
import { loadIdentity, storeIdentity } from "../identity";
import { mountArena } from "./engine";
import { consumeResume, resumeStore } from "./resume";
import { ArenaResults, type ResultsView } from "./results";
import { api } from "../api";
import { PersonalStanding, TeamRace } from "../results/Results";
import { exactScore } from "../format";
import type { HintView } from "./hint";
import { HIVE_WARNING } from "./hive-warning";
import "./arena.css";
function saved() { try { return loadIdentity(localStorage); } catch { return null; } }
export function Arena() {
  const [resume] = useState(() => { const value = resumeStore.read(); return value?.resume ? value : null; });
  useEffect(() => { if (resume) consumeResume(); }, [resume]);
  const [identity, setIdentity] = useState(saved), [name, setName] = useState(identity?.name ?? "");
  const [session, setSession] = useState<Identity | null>(resume?.identity ?? null), [error, setError] = useState("");
  const touch = useRef(resume?.touch ?? false);
  function remember(next: Identity) { try { storeIdentity(localStorage, next); } catch (error) { console.error("Identity storage unavailable", error); } setIdentity(next); }
  function join(request: StartRequest) {
    touch.current = request.touch;
    const next = { playerId: identity?.playerId ?? crypto.randomUUID(), name: request.name, team: identity?.team ?? request.team };
    setError(""); setSession(next);
  }
  if (session) return <ArenaGame identity={session} touch={touch.current} onAccepted={() => remember(session)} onError={(message, team, code) => {
    if (team) { if (identity) remember({ ...identity, team }); setSession({ ...session, team }); return; }
    setError(code === "name-hidden" && identity ? HIDDEN_IDENTITY_MESSAGE : message); setSession(null);
  }} />;
  return <StartScreen savedIdentity={identity} onStart={join} draft={name} onDraft={setName} serverError={error} clearError={() => setError("")} />;
}
function ArenaGame({ identity, touch, onAccepted, onError }: { identity: Identity; touch: boolean; onAccepted: () => void; onError: (message: string, team?: Team, code?: string) => void }) {
  const [warning, setWarning] = useState<number | null>(null);
  const [hint, setHint] = useState<HintView>(null);
  const [life, setLife] = useState<ResultsView | null>(null);
  const replay = useRef<(touch: boolean) => void>(() => {});
  const press = useRef<{ id: number; x: number; y: number; life: ResultsView } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null), error = useRef(onError), accepted = useRef(onAccepted), [status, setStatus] = useState("Connecting…");
  error.current = onError; accepted.current = onAccepted;
  useEffect(() => {
    const results = new ArenaResults(identity.playerId, api, setLife);
    const unmount = mountArena(canvas.current!, identity, touch, setStatus, (message, team, code) => error.current(message, team, code), () => accepted.current(),
      (result, respawn) => {
        if (!result || result.life !== results.view?.result.life) press.current = null;
        replay.current = respawn; results.show(result);
      }, setHint, setWarning);
    const clear = () => { press.current = null; };
    window.addEventListener("blur", clear); document.addEventListener("visibilitychange", clear);
    return () => { unmount(); results.dispose(); window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", clear); };
  }, [identity.playerId]);
  return <main className="arena-game"><canvas ref={canvas} aria-label="Shared arena" tabIndex={0} />{status && <p role="status" className="arena-status">{status}</p>}
    {hint && <p className={`arena-hint${hint.fading ? " fading" : ""}`} aria-hidden="true">{hint.touch ? <>Left thumb moves<br />Right thumb aims and fires</> : <>WASD to move · Mouse to aim<br />Click to fire</>}</p>}
    {life && warning !== null && <p className="arena-hive-warning" role="status">{HIVE_WARNING} <span>{warning}s</span></p>}
    {life && <div className={`arena-life${warning !== null ? " has-hive-warning" : ""}`} role="dialog" aria-label="Life over"
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
