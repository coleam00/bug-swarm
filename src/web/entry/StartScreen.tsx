import { useRef, useState } from "react";
import type { Identity } from "../../shared/api";
import { TEAMS, TEAM_NAMES, TEAM_COLOURS, type Team } from "../../shared/teams";
import { validateName } from "../../server/rules";
import { StartScene } from "./StartScene";
import "./entry.css";

export interface StartRequest { name: string; team: Team; touch: boolean }

/** The caller owns identity persistence and activation of its game route. */
export function StartScreen({ savedIdentity, onStart, draft = "", onDraft, serverError = "", clearError }: {
  savedIdentity: Identity | null; onStart: (request: StartRequest) => void;
  draft?: string; onDraft?: (name: string) => void; serverError?: string; clearError?: () => void;
}) {
  const [localDraft, setDraft] = useState(draft);
  const [validationError, setError] = useState("");
  const error = validationError || serverError;
  const touch = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const firstTeam = useRef<HTMLButtonElement>(null);
  const name = savedIdentity?.name ?? localDraft;
  function validatedName(): string | undefined {
    const result = validateName(name);
    if (!result.error) return result.name;
    setError(result.error === "That name is reserved" || result.error === "That name isn't allowed. Pick another."
      ? "Pick a different name." : "Use 2 to 16 letters or numbers.");
    input.current?.focus();
  }
  function join(team: Team) {
    clearError?.(); setError("");
    const validated = validatedName();
    if (validated !== undefined) onStart({ name: validated, team, touch: touch.current });
  }
  return <main className="entry" onPointerDown={event => { if (event.pointerType === "touch") touch.current = true; }}>
    <div className="entry-layout">
      <div className="entry-intro"><h1>Bug Swarm</h1><StartScene /></div>
      <form className="entry-form" noValidate onSubmit={event => {
        event.preventDefault();
        if (savedIdentity?.team) join(savedIdentity.team);
        else if (validatedName() !== undefined) firstTeam.current?.focus();
      }}>
        {savedIdentity?.team ? <>
          <div className="entry-player"><strong>{savedIdentity.name}</strong><span style={{ color: TEAM_COLOURS[savedIdentity.team] }}>{TEAM_NAMES[savedIdentity.team]}</span></div>
          <button className="entry-play" type="submit" style={{ background: TEAM_COLOURS[savedIdentity.team] }}>Play</button>
        </> : <>
          <label className="entry-hidden" htmlFor="name">Your name</label>
          <input ref={input} id="name" placeholder="Your name" value={name} readOnly={!!savedIdentity}
            autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? "name-error" : undefined}
            onChange={event => { setDraft(event.target.value); onDraft?.(event.target.value); setError(""); clearError?.(); }} />
          <div className="entry-teams">{TEAMS.map((team, index) => <button key={team} ref={index === 0 ? firstTeam : undefined}
            type="button" style={{ background: TEAM_COLOURS[team] }} onClick={() => join(team)}>Join {TEAM_NAMES[team]}</button>)}</div>
        </>}
        {error && <p id="name-error" role="alert">{error}</p>}
      </form>
    </div>
  </main>;
}
