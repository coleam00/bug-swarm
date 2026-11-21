import type { Life } from "../../shared/arena/types";
type HintPlayer = Pick<Life, "hits" | "spawnProtectedUntil">;

export const HINT_KEY = "bug-swarm-arena-hint-seen";
export type HintView = { touch: boolean; fading: boolean } | null;
interface Clock { now(): number; schedule(fn: () => void, ms: number): unknown; cancel(id: unknown): void }
interface Memory { seen: boolean; logged: boolean }
const page: Memory = { seen: false, logged: false };
const clock: Clock = { now: () => performance.now(), schedule: (fn, ms) => setTimeout(fn, ms), cancel: id => clearTimeout(id as ReturnType<typeof setTimeout>) };

/** Protection is set to zero only when the server emits a shot, even between snapshots. */
export function hasFired(player: HintPlayer): boolean { return player.spawnProtectedUntil === 0; }
export class FirstLifeHint {
  private attempted = false;
  private view: HintView = null;
  private timer: unknown;
  private deadline = 0;
  constructor(private publish: (view: HintView) => void, private storage: () => Pick<Storage, "getItem" | "setItem"> = () => localStorage,
    private time: Clock = clock, private memory: Memory = page, private log: (message: string, error: unknown) => void = console.error) {}
  observe(player: HintPlayer, touch: boolean) {
    if (!this.attempted && player.hits > 0) {
      this.attempted = true;
      if (this.memory.seen) return;
      this.memory.seen = true;
      try { const store = this.storage(); if (store.getItem(HINT_KEY) === "1") return; store.setItem(HINT_KEY, "1"); }
      catch (error) { if (!this.memory.logged) { this.memory.logged = true; this.log("Arena hint storage unavailable", error); } }
      this.deadline = this.time.now() + 6000;
      this.view = { touch, fading: false }; this.publish(this.view);
      this.timer = this.time.schedule(() => this.fade(), 6000);
    }
    if (!this.view || this.view.fading) return;
    if (!player.hits) { this.dismiss(); return; }
    if (hasFired(player) || this.time.now() >= this.deadline) { this.fade(); return; }
    if (touch && !this.view.touch) { this.view = { touch: true, fading: false }; this.publish(this.view); }
  }
  private fade() {
    if (!this.view || this.view.fading) return;
    this.time.cancel(this.timer); this.view = { ...this.view, fading: true }; this.publish(this.view);
    this.timer = this.time.schedule(() => this.dismiss(), 200);
  }
  dismiss() { this.time.cancel(this.timer); if (this.view) { this.view = null; this.publish(null); } }
}
