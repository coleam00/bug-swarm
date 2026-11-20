import type { Finish, Identity, Leader, TeamTotals } from "../../shared/api";
import { RateLimitError, TeamConflictError, type GameApi } from "./api";
import { createSimulation, chooseUpgrade, type Simulation } from "./simulation";
import { acquiredUpgrades } from "./upgrades";
import type { AcquiredUpgrade, UpgradeId } from "../../shared/upgrades";
import { SQUARE_ARENA, type Arena } from "./arena";

export const RESTART_GUARD_MS = 800;
export const CHOICE_GUARD_MS = 350;
export interface SessionTiming {
  now(): number;
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}
const defaultTiming: SessionTiming = {
  now: () => performance.now(),
  schedule: (callback, delay) => setTimeout(callback, delay),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
type Guard = { token: number; choice: number | null; deadline: number };

export interface LocalRun {
  token: number; simulation: Simulation; start: Promise<string | null>; runId?: string; registeredAt?: number;
  touch: boolean; result?: Readonly<Finish>; startFailure?: "rate-limited";
}
export interface SessionView {
  restartReady: boolean; choiceReady: boolean;
  token: number; over: boolean; score: number; save: "pending" | "saved" | "held" | "failed" | "rate-limited";
  best: number | null; bestStatus: "loading" | "ready" | "failed";
  leaders: Leader[]; leadersStatus: "loading" | "ready" | "failed";
  teamTotals: TeamTotals | null; teamsStatus: "loading" | "ready" | "failed";
  choice: Readonly<{ number: number; offer: readonly UpgradeId[] }> | null;
  upgrades: readonly AcquiredUpgrade[];
}

export class Session {
  current: LocalRun | null = null;
  view: SessionView = this.emptyView(0);
  private listeners = new Set<() => void>();
  private poll?: ReturnType<typeof setInterval>;
  private guard: Guard | null = null;
  private guardTimer: unknown;
  private guardGeneration = 0;
  private bestSequence = 0;
  private leadersSequence = 0;
  private bestApplied = 0;
  private leadersApplied = 0;
  private teamsSequence = 0;
  private teamsApplied = 0;
  constructor(public identity: Identity, private api: GameApi, private seed: () => number,
    private log: (message: string, error: unknown) => void = console.error,
    private arena: () => Arena = () => SQUARE_ARENA,
    private identityChanged: (identity: Identity) => void = () => {},
    private clock = { now: () => performance.now(), sleep: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)) },
    private timing: SessionTiming = { ...defaultTiming, now: () => this.clock.now() }) {}

  private emptyView(token: number): SessionView {
    return { token, restartReady: false, choiceReady: false, over: false, score: 0, save: "pending", best: null, bestStatus: "loading", leaders: [], leadersStatus: "loading", teamTotals: null, teamsStatus: "loading", choice: null, upgrades: Object.freeze([]) };
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.syncPoll(); this.syncGuard();
    return () => { this.listeners.delete(listener); this.syncPoll(); this.syncGuard(); };
  }
  private emit() { for (const listener of this.listeners) listener(); }
  private syncPoll() {
    if (this.poll) { clearInterval(this.poll); this.poll = undefined; }
    if (this.listeners.size && this.view.over) this.poll = setInterval(() => {
      void this.refreshLeaders(this.current!); void this.refreshTeams(this.current!);
    }, 2000);
  }
  private clearGuardTimer() {
    this.guardGeneration++;
    if (this.guardTimer !== undefined) this.timing.cancel(this.guardTimer);
    this.guardTimer = undefined;
  }
  private syncGuard() {
    this.clearGuardTimer();
    const guard = this.guard;
    if (!guard || !this.listeners.size) return;
    const ready = guard.choice === null ? this.view.restartReady : this.view.choiceReady;
    if (ready) return;
    const remaining = guard.deadline - this.timing.now();
    if (remaining <= 0) {
      this.view = guard.choice === null ? { ...this.view, restartReady: true } : { ...this.view, choiceReady: true };
      this.emit(); return;
    }
    const generation = this.guardGeneration;
    this.guardTimer = this.timing.schedule(() => {
      // Cancellation need not prevent a callback already queued by the host.
      if (generation !== this.guardGeneration || this.guard !== guard) return;
      this.guardTimer = undefined; this.syncGuard();
    }, remaining);
  }
  canRestart(token: number): boolean {
    return token === this.current?.token && this.view.over && this.guard?.choice === null &&
      this.guard.token === token && this.timing.now() >= this.guard.deadline;
  }
  canChoose(token: number, number: number): boolean {
    return token === this.current?.token && !this.current.result && !this.view.over &&
      this.view.choice?.number === number && this.guard?.token === token && this.guard.choice === number &&
      this.timing.now() >= this.guard.deadline;
  }
  restart(token: number, touch = false): boolean {
    if (!this.canRestart(token)) return false;
    return this.start(touch) !== null;
  }
  start(touch = false): LocalRun | null {
    if (this.view.over && !this.canRestart(this.view.token)) return null;
    this.clearGuardTimer(); this.guard = null;
    const token = this.view.token + 1;
    const run: LocalRun = { token, simulation: createSimulation(this.seed(), this.arena()), start: Promise.resolve(null), touch };
    this.current = run; this.view = this.emptyView(token); this.syncPoll();
    run.start = Promise.resolve().then(async () => {
      try { return await this.api.start(this.identity); }
      catch (error) {
        if (!(error instanceof TeamConflictError)) throw error;
        // A stale entry tab or saved identity must yield to permanent membership.
        // Repair even if this local run has since ended or restarted; retry once.
        this.identity = { ...this.identity, team: error.team };
        this.identityChanged(this.identity);
        return this.api.start(this.identity);
      }
    }).then(({ runId }) => {
      run.registeredAt = this.clock.now(); run.runId = runId; return runId;
    }).catch((error) => {
      if (error instanceof RateLimitError) run.startFailure = "rate-limited";
      this.log(`Run start failed [${run.token}]`, error); return null;
    });
    this.emit(); return run;
  }
  touch() { if (this.current && !this.current.result) this.current.touch = true; }
  publishChoice(): void {
    const s = this.current?.simulation;
    if (!s?.upgrades.offer || this.view.over || this.view.choice?.number === s.upgrades.choiceNumber) return;
    this.guard = { token: this.view.token, choice: s.upgrades.choiceNumber, deadline: this.timing.now() + CHOICE_GUARD_MS };
    this.view = { ...this.view, choiceReady: false, choice: Object.freeze({ number: s.upgrades.choiceNumber, offer: s.upgrades.offer }) };
    this.syncGuard(); this.emit();
  }
  choose(token: number, number: number, id: UpgradeId, touch = false): boolean {
    const run = this.current;
    if (!run || !this.canChoose(token, number) ||
      !chooseUpgrade(run.simulation, number, id)) return false;
    if (touch) this.touch();
    this.clearGuardTimer(); this.guard = null;
    this.view = { ...this.view, choiceReady: false, choice: null, upgrades: acquiredUpgrades(run.simulation.upgrades) }; this.emit();
    return true;
  }
  end(): void {
    const run = this.current;
    if (!run || run.result) return;
    const s = run.simulation;
    const upgrades = acquiredUpgrades(s.upgrades);
    run.result = Object.freeze({ playerId: this.identity.playerId, score: s.score, squashes: s.squashes, seconds: s.seconds, touch: run.touch, upgrades });
    this.guard = { token: run.token, choice: null, deadline: this.timing.now() + RESTART_GUARD_MS };
    this.view = { ...this.view, over: true, restartReady: false, choiceReady: false, score: s.score, choice: null, upgrades };
    this.syncGuard(); this.emit(); this.syncPoll();
    void this.refreshBest(run); void this.refreshLeaders(run); void this.refreshTeams(run);
    void this.save(run);
  }
  private async save(run: LocalRun) {
    try {
      const id = await run.start;
      if (!id) throw new Error("No server run id");
      // Registration can trail immediate gameplay. Time since its acknowledgement
      // is a conservative lower bound on server elapsed time; delay only the save.
      const readyAt = run.registeredAt! + run.result!.seconds * 1000;
      while (this.clock.now() < readyAt) await this.clock.sleep(Math.ceil(readyAt - this.clock.now()));
      const saved = await this.api.finish(id, run.result!);
      if (this.current !== run) return;
      this.view = { ...this.view, save: saved.held ? "held" : "saved" }; this.emit();
      void this.refreshBest(run); void this.refreshLeaders(run); void this.refreshTeams(run);
    } catch (error) {
      this.log(`Score save failed [${run.runId ?? `local-${run.token}`}]`, error);
      if (this.current !== run) return;
      this.view = { ...this.view, save: run.startFailure ?? "failed" }; this.emit();
    }
  }
  async refreshBest(run: LocalRun): Promise<void> {
    const sequence = ++this.bestSequence;
    try {
      const { best } = await this.api.best(this.identity.playerId);
      if (this.current !== run || sequence < this.bestApplied || !this.view.over) return;
      this.bestApplied = sequence;
      this.view = { ...this.view, best, bestStatus: "ready" }; this.emit();
    } catch (error) {
      this.log(`Best read failed [${run.runId ?? run.token}]`, error);
      if (this.current !== run || sequence < this.bestApplied || !this.view.over) return;
      this.bestApplied = sequence;
      this.view = { ...this.view, bestStatus: "failed" }; this.emit();
    }
  }
  async refreshLeaders(run: LocalRun): Promise<void> {
    const sequence = ++this.leadersSequence;
    try {
      const leaders = await this.api.leaders();
      // A newer request in flight must not starve a successful response. Only a
      // newer result already shown (or a different run) makes this result stale.
      if (this.current !== run || sequence < this.leadersApplied || !this.view.over) return;
      this.leadersApplied = sequence;
      this.view = { ...this.view, leaders, leadersStatus: "ready" }; this.emit();
    } catch (error) {
      this.log(`Leaderboard read failed [${run.runId ?? run.token}]`, error);
      if (this.current !== run || sequence < this.leadersApplied || !this.view.over) return;
      this.leadersApplied = sequence;
      this.view = { ...this.view, leaders: [], leadersStatus: "failed" }; this.emit();
    }
  }
  async refreshTeams(run: LocalRun): Promise<void> {
    const sequence = ++this.teamsSequence;
    try {
      const totals = await this.api.teams();
      if (this.current !== run || sequence < this.teamsApplied || !this.view.over) return;
      this.teamsApplied = sequence;
      this.view = { ...this.view, teamTotals: totals, teamsStatus: "ready" }; this.emit();
    } catch (error) {
      this.log(`Team totals read failed [${run.runId ?? run.token}]`, error);
      if (this.current !== run || sequence < this.teamsApplied || !this.view.over) return;
      this.teamsApplied = sequence;
      this.view = { ...this.view, teamTotals: null, teamsStatus: "failed" }; this.emit();
    }
  }
}
