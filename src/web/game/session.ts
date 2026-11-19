import type { Finish, Identity, Leader, TeamTotals } from "../../shared/api";
import { TeamConflictError, type GameApi } from "./api";
import { createSimulation, chooseUpgrade, type Simulation } from "./simulation";
import { acquiredUpgrades } from "./upgrades";
import type { AcquiredUpgrade, UpgradeId } from "../../shared/upgrades";
import { SQUARE_ARENA, type Arena } from "./arena";

export interface LocalRun {
  token: number; simulation: Simulation; start: Promise<string | null>; runId?: string;
  touch: boolean; result?: Readonly<Finish>;
}
export interface SessionView {
  token: number; over: boolean; score: number; save: "pending" | "saved" | "failed";
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
  private bestSequence = 0;
  private leadersSequence = 0;
  private bestApplied = 0;
  private leadersApplied = 0;
  private teamsSequence = 0;
  private teamsApplied = 0;
  constructor(public identity: Identity, private api: GameApi, private seed: () => number,
    private log: (message: string, error: unknown) => void = console.error,
    private arena: () => Arena = () => SQUARE_ARENA,
    private identityChanged: (identity: Identity) => void = () => {}) {}

  private emptyView(token: number): SessionView {
    return { token, over: false, score: 0, save: "pending", best: null, bestStatus: "loading", leaders: [], leadersStatus: "loading", teamTotals: null, teamsStatus: "loading", choice: null, upgrades: Object.freeze([]) };
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    this.syncPoll();
    return () => { this.listeners.delete(listener); this.syncPoll(); };
  }
  private emit() { for (const listener of this.listeners) listener(); }
  private syncPoll() {
    if (this.poll) { clearInterval(this.poll); this.poll = undefined; }
    if (this.listeners.size && this.view.over) this.poll = setInterval(() => {
      void this.refreshLeaders(this.current!); void this.refreshTeams(this.current!);
    }, 2000);
  }
  start(touch = false): LocalRun {
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
      run.runId = runId; return runId;
    }).catch((error) => {
      this.log(`Run start failed [${run.token}]`, error); return null;
    });
    this.emit(); return run;
  }
  touch() { if (this.current && !this.current.result) this.current.touch = true; }
  publishChoice(): void {
    const s = this.current?.simulation;
    if (!s?.upgrades.offer || this.view.over || this.view.choice?.number === s.upgrades.choiceNumber) return;
    this.view = { ...this.view, choice: Object.freeze({ number: s.upgrades.choiceNumber, offer: s.upgrades.offer }) };
    this.emit();
  }
  choose(token: number, number: number, id: UpgradeId, touch = false): boolean {
    const run = this.current;
    if (!run || run.result || token !== run.token || this.view.choice?.number !== number ||
      !chooseUpgrade(run.simulation, number, id)) return false;
    if (touch) this.touch();
    this.view = { ...this.view, choice: null, upgrades: acquiredUpgrades(run.simulation.upgrades) }; this.emit();
    return true;
  }
  end(): void {
    const run = this.current;
    if (!run || run.result) return;
    const s = run.simulation;
    const upgrades = acquiredUpgrades(s.upgrades);
    run.result = Object.freeze({ playerId: this.identity.playerId, score: s.score, squashes: s.squashes, seconds: s.seconds, touch: run.touch, upgrades });
    this.view = { ...this.view, over: true, score: s.score, choice: null, upgrades }; this.emit(); this.syncPoll();
    void this.refreshBest(run); void this.refreshLeaders(run); void this.refreshTeams(run);
    void this.save(run);
  }
  private async save(run: LocalRun) {
    try {
      const id = await run.start;
      if (!id) throw new Error("No server run id");
      await this.api.finish(id, run.result!);
      if (this.current !== run) return;
      this.view = { ...this.view, save: "saved" }; this.emit();
      void this.refreshBest(run); void this.refreshLeaders(run); void this.refreshTeams(run);
    } catch (error) {
      this.log(`Score save failed [${run.runId ?? `local-${run.token}`}]`, error);
      if (this.current !== run) return;
      this.view = { ...this.view, save: "failed" }; this.emit();
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
