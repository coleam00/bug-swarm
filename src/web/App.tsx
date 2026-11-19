import { useEffect, useRef, useState } from "react";
import type { Identity } from "../shared/api";
import { validateName } from "../server/rules";
import { api } from "./game/api";
import { loadIdentity, storeIdentity } from "./game/identity";
import { mountGame, type Hud } from "./game/engine";
import { Session } from "./game/session";
import { arenaForViewport } from "./game/arena";
import "./style.css";

function readIdentity(): Identity | null {
  try { return loadIdentity(localStorage); } catch { return null; }
}
export function App() {
  const [identity, setIdentity] = useState(readIdentity);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const entryTouch = useRef(false);
  if (identity) return <Game identity={identity} initialTouch={entryTouch.current} />;
  return <main className="entry"><h1>Bug Swarm</h1><p>Steer. Auto-fire. Survive.</p>
    <form onPointerDown={(event) => { if (event.pointerType === "touch") entryTouch.current = true; }} onSubmit={(event) => {
      event.preventDefault();
      const result = validateName(name);
      if (result.error) { setError(result.error); return; }
      const next = { playerId: crypto.randomUUID(), name: result.name! };
      try { storeIdentity(localStorage, next); } catch (cause) { console.error("Storage unavailable", cause); }
      setIdentity(next);
    }}>
      <label htmlFor="name">Your name on the leaderboard</label>
      <input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" maxLength={16} autoFocus aria-describedby="name-help name-error" />
      <p id="name-help">2–16 letters, numbers, spaces, - or _</p>
      <p id="name-error" role="alert">{error}</p><button type="submit">Play</button>
    </form><p>Drag to steer on touch. Use WASD, arrows or your mouse on desktop. Your robot fires for you. Three hits end a run.</p>
  </main>;
}

function Game({ identity, initialTouch }: { identity: Identity; initialTouch: boolean }) {
  const [session] = useState(() => new Session(identity, api, () => crypto.getRandomValues(new Uint32Array(1))[0]!,
    console.error, () => arenaForViewport(window.innerWidth, window.innerHeight)));
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
    <div className="surface"><canvas ref={canvas} aria-label="Bug Swarm arena. Drag, use WASD or arrows, or move your mouse to steer." />
      {view.over && <section className="over" aria-label="Game over"
        onPointerDown={(event) => { restartPress.current = { x: event.clientX, y: event.clientY }; }}
        onPointerCancel={() => { restartPress.current = null; }}
        onPointerUp={(event) => {
          const start = restartPress.current; restartPress.current = null;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10) session.start(event.pointerType === "touch");
        }}>
        <h1>Game over</h1><p className="final-score">Score {view.score}</p>
        <p role="status">{view.save === "failed" ? "couldn't save your score" : view.save === "saved" ? "Score saved" : "Saving score…"}</p>
        <p>Best: {view.bestStatus === "loading" ? "Loading…" : view.bestStatus === "failed" ? "Unavailable" : view.best ?? "No saved runs yet"}</p>
        <h2>Live top 10</h2>
        {view.leadersStatus === "loading" ? <p>Loading…</p> : view.leadersStatus === "failed" ? <p>Couldn't load the leaderboard</p> : view.leaders.length ?
          <ol>{view.leaders.map((row) => <li key={row.playerId}><span>{row.name}</span><strong>{row.score}</strong></li>)}</ol> : <p>No saved scores yet</p>}
        <p className="restart">Tap or press a key to play again</p>
        <button type="button" onClick={(event) => { if (event.detail === 0) session.start(); }}>Play again</button>
      </section>}
    </div>
    <footer>Drag · WASD / arrows · mouse <span>{debug || "F: frame readout"}</span></footer>
  </main>;
}
