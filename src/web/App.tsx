import { useEffect, useRef, useState } from "react";
import type { Identity } from "../shared/api";
import { validateName } from "../server/rules";
import { api } from "./game/api";
import { loadIdentity, storeIdentity } from "./game/identity";
import { mountGame, type Hud } from "./game/engine";
import { Session } from "./game/session";
import { arenaForViewport } from "./game/arena";
import { UPGRADE_NAMES, nextPickDescription } from "../shared/upgrades";
import type { SessionView } from "./game/session";
import { TEAMS, TEAM_NAMES, TEAM_COLOURS, type Team } from "../shared/teams";
import "./style.css";

function readIdentity(): Identity | null {
  try { return loadIdentity(localStorage); } catch { return null; }
}
export function App() {
  const [identity, setIdentity] = useState(readIdentity);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const entryTouch = useRef(false);
  function rememberIdentity(next: Identity) {
    try { storeIdentity(localStorage, next); } catch (cause) { console.error("Storage unavailable", cause); }
    setIdentity(next);
  }
  function selectTeam(team: Team) {
    const result = validateName(identity?.name ?? name);
    if (result.error) { setError(result.error); return; }
    const next: Identity = { playerId: identity?.playerId ?? crypto.randomUUID(), name: result.name!, team };
    rememberIdentity(next);
  }
  if (identity?.team) return <Game identity={identity} initialTouch={entryTouch.current} onIdentity={rememberIdentity} />;
  return <main className="entry"><h1>Bug Swarm</h1><p>Steer. Auto-fire. Survive.</p>
    <form onPointerDown={(event) => { if (event.pointerType === "touch") entryTouch.current = true; }} onSubmit={(event) => {
      event.preventDefault();
      const result = validateName(identity?.name ?? name);
      setError(result.error ?? "Choose Tabs or Spaces to play.");
    }}>
      <label htmlFor="name">Your name on the leaderboard</label>
      <input id="name" value={identity?.name ?? name} readOnly={!!identity} onChange={(event) => setName(event.target.value)} autoComplete="off" maxLength={16} autoFocus={!identity} aria-describedby="name-help name-error" />
      <p id="name-help">2–16 letters, numbers, spaces, - or _</p>
      <p id="name-error" role="alert">{error}</p>
      <p>{identity ? "Welcome back! Choose your team once." : "Choose your team to play."} Every score helps. Your team is permanent.</p>
      <div className="team-choices">{TEAMS.map(team => <button key={team} type="button" style={{ background: TEAM_COLOURS[team] }} onClick={() => selectTeam(team)}>Join {TEAM_NAMES[team]}</button>)}</div>
    </form><p>Touch and drag anywhere to steer. Drag farther to move faster; lift to stop. Use WASD, arrows or your mouse on desktop. Your robot fires for you. Three hits end a run.</p>
  </main>;
}

function Game({ identity, initialTouch, onIdentity }: { identity: Identity; initialTouch: boolean; onIdentity: (identity: Identity) => void }) {
  const [session] = useState(() => new Session(identity, api, () => crypto.getRandomValues(new Uint32Array(1))[0]!,
    console.error, () => arenaForViewport(window.innerWidth, window.innerHeight), onIdentity));
  const [view, setView] = useState(session.view);
  const [hud, setHud] = useState<Hud>({ score: 0, hits: 0, seconds: 0 });
  const [debug, setDebug] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const restartPress = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const unsubscribe = session.subscribe(() => setView(session.view));
    if (!session.current) session.start(initialTouch);
    const unmount = mountGame(canvas.current!, session, setHud, setDebug);
    return () => { unmount(); unsubscribe(); };
  }, [session, initialTouch]);
  return <main className="game">
    <header className="hud"><strong>Bug Swarm</strong><span>Score {hud.score}</span><span>{3 - hud.hits} hits left · {hud.seconds}s</span></header>
    <div className="surface"><canvas ref={canvas} tabIndex={0} aria-label="Bug Swarm arena. Touch and drag anywhere to steer. Drag farther to move faster; lift to stop. Use WASD, arrows or your mouse on desktop." />
      {view.choice && <ChoiceDialog key={`${view.token}/${view.choice.number}`} session={session} view={view}
        restoreFocus={() => canvas.current?.focus({ preventScroll: true })} />}
      {view.over && <section className="over" aria-label="Game over"
        onPointerDown={(event) => { restartPress.current = { x: event.clientX, y: event.clientY }; }}
        onPointerCancel={() => { restartPress.current = null; }}
        onPointerUp={(event) => {
          const start = restartPress.current; restartPress.current = null;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10) session.start(event.pointerType === "touch");
        }}>
        <h1>Game over</h1><p className="final-score">Score {view.score}</p>
        <TeamRace view={view} />
        <p role="status">{view.save === "failed" ? "couldn't save your score" : view.save === "saved" ? "Score saved" : "Saving score…"}</p>
        <p>Best: {view.bestStatus === "loading" ? "Loading…" : view.bestStatus === "failed" ? "Unavailable" : view.best ?? "No saved runs yet"}</p>
        <p className="restart">Tap or press a key to play again</p>
        <button type="button" onClick={(event) => { if (event.detail === 0) session.start(); }}>Play again</button>
        <p className="build">{view.upgrades.length ? view.upgrades.map(({ id, count }) => `${UPGRADE_NAMES[id]} ×${count}`).join(" · ") : "No upgrades taken"}</p>
        <h2>Live top 10</h2>
        {view.leadersStatus === "loading" ? <p>Loading…</p> : view.leadersStatus === "failed" ? <p>Couldn't load the leaderboard</p> : view.leaders.length ?
          <ol>{view.leaders.map((row) => <li key={row.playerId}><span>{row.name}</span><strong>{row.score}</strong></li>)}</ol> : <p>No saved scores yet</p>}
      </section>}
    </div>
    <footer>Drag · WASD / arrows · mouse <span>{debug || "F: frame readout"}</span></footer>
  </main>;
}

function TeamRace({ view }: { view: SessionView }) {
  if (view.teamsStatus === "loading") return <p role="status">Loading team totals…</p>;
  if (view.teamsStatus === "failed" || !view.teamTotals) return <p role="status">Couldn't load team totals</p>;
  const totals = view.teamTotals, sum = totals.tabs + totals.spaces;
  return <div className="team-race" aria-label="Tabs vs Spaces">
    <div className="team-labels">{TEAMS.map(team => <span key={team} style={{ color: TEAM_COLOURS[team] }}>{TEAM_NAMES[team]} <strong>{totals[team]}</strong></span>)}</div>
    <div className={`race-bar${sum ? "" : " empty"}`} aria-hidden="true">{TEAMS.map(team => <span key={team} style={{ width: `${sum ? totals[team] / sum * 100 : 50}%`, background: sum ? TEAM_COLOURS[team] : "#7f91a9" }} />)}</div>
    {!sum && <p>No team scores yet</p>}
  </div>;
}

function ChoiceDialog({ session, view, restoreFocus }: { session: Session; view: SessionView; restoreFocus: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const touch = useRef(false);
  const choice = view.choice!;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    element.querySelector("button")?.focus();
    return () => { element.close(); restoreFocus(); };
  }, []);
  return <dialog ref={dialog} className="choices" aria-labelledby="choice-title" aria-describedby="choice-help"
    onCancel={event => event.preventDefault()} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const cards = event.currentTarget.querySelectorAll("button"), first = cards[0]!, last = cards[cards.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
    <h1 id="choice-title">Choose an upgrade</h1>
    <p id="choice-help">Take your time. Tap a card or press 1–3.</p>
    <div className="choice-cards">{choice.offer.map((id, index) => <button type="button" key={id}
      onPointerDown={event => { touch.current = event.pointerType === "touch"; }}
      onClick={() => {
        session.choose(view.token, choice.number, id, touch.current); touch.current = false;
      }}>
      <span className="choice-number">{index + 1}</span><strong>{UPGRADE_NAMES[id]}</strong>
      <span>{nextPickDescription(id, view.upgrades.find(upgrade => upgrade.id === id)?.count ?? 0)}</span>
    </button>)}</div>
  </dialog>;
}
