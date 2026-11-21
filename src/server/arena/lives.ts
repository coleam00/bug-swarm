import type { Database } from "bun:sqlite";
import { EVENT_TYPES } from "../db";
import type { Team } from "../../shared/teams";
import type { LifeResult } from "../../shared/arena/types";
import type { EndReason } from "../../shared/arena/protocol";
export interface LifeRecord { runId: string; playerId: string; team: Team; started: number; result?: LifeResult; ended?: number; reason?: EndReason }
export function startArenaLife(db: Database, record: LifeRecord) {
  db.transaction(() => {
    db.query("INSERT OR IGNORE INTO runs(id, player_id, started_at_ms, team, mode) VALUES (?, ?, ?, ?, 'arena')").run(record.runId, record.playerId, record.started, record.team);
    db.query("INSERT OR IGNORE INTO events(type, at, run_id) VALUES (?, ?, ?)").run(EVENT_TYPES[1], new Date(record.started).toISOString(), record.runId);
  }).immediate();
}
export function finishArenaLife(db: Database, record: LifeRecord) {
  db.transaction(() => {
    // A finish retains its immutable start metadata and can recover a failed start.
    startArenaLife(db, record);
    const r = record.result!;
    db.query("UPDATE runs SET ended_at_ms = ?, score = ?, squashes = ?, seconds = ?, touch = ?, end_reason = ?, upgrades = '[]', held = 0 WHERE id = ? AND mode = 'arena' AND ended_at_ms IS NULL")
      .run(record.ended!, r.score, r.kills, Math.floor(r.seconds), Number(r.touch), record.reason ?? "death", record.runId);
    db.query("INSERT OR IGNORE INTO events(type, at, run_id) VALUES (?, ?, ?)").run(EVENT_TYPES[2], new Date(record.ended!).toISOString(), record.runId);
  }).immediate();
}
/** Arena writes never synchronously wait on a database lock, including before shutdown. */
export class LifeWriter {
  private queue: { record: LifeRecord; notify?: (saved: boolean) => void }[] = [];
  private failed: typeof this.queue = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private db: Database, private invalidate: () => void = () => {}) {}
  enqueue(record: LifeRecord, notify?: (saved: boolean) => void) {
    this.queue.push({ record: Object.freeze({ ...record, ...(record.result ? { result: Object.freeze({ ...record.result }) } : {}) }), notify });
    this.timer ??= setTimeout(() => this.flush(), 0);
  }
  flush() {
    clearTimeout(this.timer); this.timer = undefined;
    const previous = (this.db.query("PRAGMA busy_timeout").get() as { timeout: number }).timeout;
    this.db.exec("PRAGMA busy_timeout = 0");
    try { for (const item of this.queue.splice(0)) {
      const error = this.write(item);
      if (error) { console.error(`Arena life save failed: ${item.record.runId}`, error); this.failed.push(item); }
      this.notify(item, !error);
    } } finally { this.db.exec(`PRAGMA busy_timeout = ${previous}`); }
  }
  private write(item: (typeof this.queue)[number]): unknown {
    try { if (item.record.result) finishArenaLife(this.db, item.record); else startArenaLife(this.db, item.record); }
    catch (error) { return error; }
    if (item.record.result) try { this.invalidate(); } catch (error) { console.error(`Arena score cache refresh failed: ${item.record.runId}`, error); }
  }
  private notify(item: (typeof this.queue)[number], saved: boolean) {
    try { item.notify?.(saved); } catch (error) { console.error(`Arena save notification failed: ${item.record.runId}`, error); }
  }
  /** Absolute monotonic deadline shared with the shutdown coordinator. Terminal writes recover starts. */
  async drain(deadline: number): Promise<boolean> {
    clearTimeout(this.timer); this.timer = undefined;
    this.db.exec("PRAGMA busy_timeout = 0"); // keep zero through shutdown cleanup
    const records = new Map<string, (typeof this.queue)[number]>();
    for (const item of [...this.failed.splice(0), ...this.queue.splice(0)]) {
      if (!records.get(item.record.runId)?.record.result || item.record.result) records.set(item.record.runId, item);
    }
    let pending = [...records.values()], failed = false;
    const errors = new Map<string, unknown>();
    while (pending.length && performance.now() < deadline) {
      const retry: typeof pending = [];
      for (let i = 0; i < pending.length; i++) {
        const item = pending[i]!;
        if (performance.now() >= deadline) { retry.push(...pending.slice(i)); break; }
        const error = this.write(item);
        if (!error) this.notify(item, true);
        else {
          errors.set(item.record.runId, error);
          if (/SQLITE_BUSY|SQLITE_LOCKED/.test(String((error as { code?: string }).code))) retry.push(item);
          else { failed = true; console.error(`Arena life save failed: ${item.record.runId}`, error); this.notify(item, false); }
        }
        if (i % 16 === 15) await new Promise(resolve => setTimeout(resolve, 0));
      }
      pending = retry;
      if (pending.length && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(20, Math.max(0, deadline - performance.now()))));
    }
    for (const item of pending) {
      console.error(`Arena shutdown save deadline: ${item.record.runId}`, errors.get(item.record.runId) ?? "deadline exhausted");
      this.notify(item, false);
    }
    return !failed && pending.length === 0;
  }
  stop() { this.flush(); this.queue.push(...this.failed.splice(0)); this.flush(); }
}
