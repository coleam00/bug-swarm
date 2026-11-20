import type { Session, SessionTiming } from "./session";

export const STEERING_HINT_KEY = "bug-swarm-steering-hint-seen";
export const STEERING_HINT_MS = 4000;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** Shared for the page lifetime, including when browser storage is unavailable. */
export class SteeringHintMemory {
  private seen = false;
  private logged = false;
  constructor(private storage: () => Storage = () => localStorage,
    private log: (message: string, cause: unknown) => void = console.error) {}

  consume(): boolean {
    if (this.seen) return false;
    this.seen = true;
    try {
      const storage = this.storage();
      if (storage.getItem(STEERING_HINT_KEY) === "1") return false;
      storage.setItem(STEERING_HINT_KEY, "1");
    } catch (cause) {
      if (!this.logged) { this.logged = true; this.log("Steering hint storage unavailable", cause); }
    }
    return true;
  }
}
const browserMemory = new SteeringHintMemory();
const timing: SessionTiming = {
  now: () => performance.now(), schedule: (callback, ms) => setTimeout(callback, ms),
  cancel: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** One local run, one wall-clock deadline; retained across effect reattachment. */
export class SteeringHint {
  visible = false;
  private token: number | undefined;
  private deadline = 0;
  private timer: unknown;
  private generation = 0;
  private changed = () => {};
  constructor(private memory = browserMemory, private clock: SessionTiming = timing) {}

  attach(session: Session, changed: (visible: boolean) => void): () => void {
    this.changed = () => changed(this.visible);
    let attaching = true;
    const sync = () => {
      const wasVisible = this.visible;
      if (this.token === undefined && session.current) {
        this.token = session.current.token;
        this.deadline = this.clock.now() + STEERING_HINT_MS;
        this.visible = this.memory.consume();
      }
      if (session.view.token !== this.token || session.view.over || session.view.choice) this.dismiss();
      this.refresh();
      if (!attaching && !wasVisible && this.visible) this.changed();
    };
    const unsubscribe = session.subscribe(sync);
    sync(); attaching = false; this.changed();
    return () => { unsubscribe(); this.cancel(); this.changed = () => {}; };
  }
  pending(token: number): boolean { return this.visible && token === this.token; }
  moved(token: number): void { if (this.pending(token)) this.dismiss(); }
  refresh(): void {
    this.cancel();
    if (!this.visible) return;
    const remaining = this.deadline - this.clock.now();
    if (remaining <= 0) { this.dismiss(); return; }
    const generation = this.generation;
    this.timer = this.clock.schedule(() => {
      if (generation !== this.generation) return;
      this.timer = undefined; this.refresh();
    }, remaining);
  }
  private cancel(): void {
    this.generation++;
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = undefined;
  }
  private dismiss(): void {
    this.cancel();
    if (!this.visible) return;
    this.visible = false; this.changed();
  }
}
