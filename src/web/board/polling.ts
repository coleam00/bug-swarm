import type { GameApi } from "../game/api";
import { applyLeaders, applyTeams, expireHighlights, highlightDeadline, initialState, type BoardState } from "./model";

export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
const scheduler: Scheduler = {
  now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};
export const POLL_MS = 2000;
const MAX_BACKOFF_MS = 8000;
type Endpoint = "leaders" | "teams";
interface PollLane { sequence: number; applied: number; failures: number; timer?: unknown }

/** Independent read lanes. The API client's five-second deadline bounds overlap. */
export class BoardController {
  private state = initialState();
  private listeners = new Set<() => void>();
  private active = false;
  private generation = 0;
  private highlights?: unknown;
  private lanes!: Record<Endpoint, PollLane>;

  constructor(
    private readonly api: Pick<GameApi, "leaders" | "teams">,
    private readonly clock: Scheduler = scheduler,
    private readonly log: (endpoint: Endpoint, error: unknown) => void = (endpoint, error) => console.error(`Board ${endpoint} read failed`, error),
  ) {}
  getSnapshot = (): BoardState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  start = () => {
    if (this.active) return;
    this.active = true;
    this.generation++;
    this.lanes = { leaders: { sequence: 0, applied: 0, failures: 0 }, teams: { sequence: 0, applied: 0, failures: 0 } };
    this.publish(expireHighlights(this.state, this.clock.now()));
    this.read("leaders");
    this.read("teams");
  };
  stop = () => {
    if (!this.active) return;
    this.active = false;
    this.generation++;
    for (const lane of Object.values(this.lanes)) this.clock.clearTimeout(lane.timer);
    this.clock.clearTimeout(this.highlights);
  };
  private publish(state: BoardState) {
    this.state = state;
    this.clock.clearTimeout(this.highlights);
    const deadline = highlightDeadline(state);
    if (this.active && deadline !== null) {
      this.highlights = this.clock.setTimeout(() => {
        this.publish(expireHighlights(this.state, this.clock.now()));
      }, Math.max(0, deadline - this.clock.now()));
    }
    this.listeners.forEach(listener => listener());
  }
  private schedule(endpoint: Endpoint, delay: number) {
    const lane = this.lanes[endpoint];
    this.clock.clearTimeout(lane.timer);
    lane.timer = this.clock.setTimeout(() => this.read(endpoint), delay);
  }
  private read(endpoint: Endpoint) {
    const lane = this.lanes[endpoint], sequence = ++lane.sequence, generation = this.generation;
    // Healthy cadence is measured from launch, rather than response completion.
    // During backoff, only a completed attempt schedules the next retry.
    if (!lane.failures) this.schedule(endpoint, POLL_MS);
    const current = () => this.active && generation === this.generation && sequence > lane.applied;
    const fail = (error: unknown) => {
      if (!current()) return;
      lane.applied = sequence;
      lane.failures++;
      if (!this.state[endpoint].failed) this.log(endpoint, error);
      this.publish({ ...this.state, [endpoint]: { ...this.state[endpoint], failed: true } });
      this.schedule(endpoint, Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(lane.failures - 1, 2)));
    };
    // Promise wrapping also treats an injected synchronous API throw as a read failure.
    void Promise.resolve().then<unknown>(() => this.api[endpoint]()).then(value => {
      if (!current()) return;
      const state = (endpoint === "leaders" ? applyLeaders : applyTeams)(this.state, value, this.clock.now());
      lane.applied = sequence;
      const recovering = lane.failures > 0;
      lane.failures = 0;
      this.publish(state);
      if (recovering) this.schedule(endpoint, POLL_MS);
    }).catch(fail);
  }
}
