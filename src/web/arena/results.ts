import type { GameApi } from "../game/api";
import type { Standing, TeamTotals } from "../../shared/api";
import type { LifeOver } from "../../shared/arena/protocol";
import type { ReadStatus } from "../results/Results";

export interface ResultsView {
  result: LifeOver;
  best: number | null; bestStatus: ReadStatus;
  standing: Standing | null; standingStatus: ReadStatus;
  teamTotals: TeamTotals | null; teamsStatus: ReadStatus;
}
interface Scheduler { schedule(fn: () => void, ms: number): unknown; cancel(id: unknown): void }
const scheduler: Scheduler = { schedule: (fn, ms) => setTimeout(fn, ms), cancel: id => clearTimeout(id as ReturnType<typeof setTimeout>) };
type Field = "best" | "standing" | "teams";
/** Owns only the visible terminal life; no work runs in a frame or server tick. */
export class ArenaResults {
  view: ResultsView | null = null;
  private generation = 0;
  private sequence = { best: 0, standing: 0, teams: 0 };
  private applied = { best: 0, standing: 0, teams: 0 };
  private timer: unknown;
  constructor(private playerId: string, private api: Pick<GameApi, Field>, private publish: (view: ResultsView | null) => void,
    private clock: Scheduler = scheduler, private log: (message: string, error: unknown) => void = console.error) {}
  show(result: LifeOver | null) {
    if (result && this.view?.result.life === result.life && this.view.result.save === result.save) return;
    this.clear();
    if (!result) { this.publish(null); return; }
    this.view = { result: { ...result }, best: null, bestStatus: "loading", standing: null, standingStatus: "loading", teamTotals: null, teamsStatus: "loading" };
    this.publish(this.view);
    if (result.save !== "pending") this.refresh();
  }
  private refresh() {
    const generation = this.generation;
    for (const field of ["best", "standing", "teams"] as const) void this.read(field, generation);
    this.timer = this.clock.schedule(() => { if (generation === this.generation && this.view) this.refresh(); }, 2000);
  }
  private async read(field: Field, generation: number) {
    const sequence = ++this.sequence[field], status = field === "teams" ? "teamsStatus" : field === "best" ? "bestStatus" : "standingStatus";
    // A slow read may still be useful after the next poll launches. Only a
    // newer completed read supersedes it, so latency above 2s cannot starve UI.
    const current = () => generation === this.generation && sequence > this.applied[field] && this.view !== null;
    try {
      const data = await (field === "teams" ? this.api.teams() : field === "best" ? this.api.best(this.playerId) : this.api.standing(this.playerId));
      if (!current()) return;
      const value = field === "best" ? { best: (data as { best: number | null }).best } : field === "teams" ? { teamTotals: data as TeamTotals } : { standing: data as Standing };
      this.view = { ...this.view!, ...value, [status]: "ready" };
    } catch (error) {
      if (!current()) return;
      if (this.view![status] !== "failed") this.log(`Arena results ${field} failed for ${this.playerId} life ${this.view!.result.life}`, error);
      this.view = { ...this.view!, [status]: "failed" };
    }
    this.applied[field] = sequence;
    this.publish(this.view);
  }
  private clear() { this.generation++; this.clock.cancel(this.timer); this.timer = undefined; this.view = null; }
  dispose() { this.clear(); }
}
