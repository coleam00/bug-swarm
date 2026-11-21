import type { Database } from "bun:sqlite";
import { EVENT_TYPES } from "../db";
import type { Team } from "../../shared/teams";
import type { LifeResult } from "../../shared/arena/types";
export interface LifeRecord { runId: string; playerId: string; team: Team; started: number; result?: LifeResult; ended?: number }
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
    db.query("UPDATE runs SET ended_at_ms = ?, score = ?, squashes = ?, seconds = ?, touch = ?, upgrades = '[]', held = 0 WHERE id = ? AND mode = 'arena' AND ended_at_ms IS NULL")
      .run(record.ended!, r.score, r.kills, Math.floor(r.seconds), Number(r.touch), record.runId);
    db.query("INSERT OR IGNORE INTO events(type, at, run_id) VALUES (?, ?, ?)").run(EVENT_TYPES[2], new Date(record.ended!).toISOString(), record.runId);
  }).immediate();
}
/** Ordered, between-tick writes. Failed terminal records get one final shutdown attempt. */
export class LifeWriter {
  private queue: { record: LifeRecord; notify?: (saved: boolean) => void }[] = [];
  private failed: typeof this.queue = [];
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private db: Database, private invalidate: () => void = () => {}) {}
  enqueue(record: LifeRecord, notify?: (saved: boolean) => void) {
    this.queue.push({ record, notify });
    this.timer ??= setTimeout(() => this.flush(), 0);
  }
  flush() {
    clearTimeout(this.timer); this.timer = undefined;
    for (const item of this.queue.splice(0)) {
      try { if (item.record.result) finishArenaLife(this.db, item.record); else startArenaLife(this.db, item.record); }
      catch (error) { console.error(`Arena life save failed: ${item.record.runId}`, error); this.failed.push(item); item.notify?.(false); continue; }
      item.notify?.(true);
      if (item.record.result) try { this.invalidate(); } catch (error) { console.error(`Arena score cache refresh failed: ${item.record.runId}`, error); }
    }
  }
  stop() { this.flush(); this.queue.push(...this.failed.splice(0)); this.flush(); }
}
