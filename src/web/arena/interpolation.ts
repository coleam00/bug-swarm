import { INTERPOLATION_MS, MAX_SNAPSHOTS, STEP_MS } from "../../shared/arena/constants";
import type { Snapshot } from "../../shared/arena/protocol";
import type { Player } from "../../shared/arena/types";
export class Interpolation {
  private samples: { snapshot: Snapshot; at: number }[] = [];
  clear() { this.samples = []; }
  push(snapshot: Snapshot, at: number) {
    const last = this.samples.at(-1);
    if (last && snapshot.tick < last.snapshot.tick) return;
    if (last?.snapshot.tick === snapshot.tick) this.samples.pop();
    this.samples.push({ snapshot, at }); if (this.samples.length > MAX_SNAPSHOTS) this.samples.shift();
  }
  players(now: number): Player[] {
    const latest = this.samples.at(-1); if (!latest) return [];
    const target = latest.snapshot.tick + (now - latest.at - INTERPOLATION_MS) / STEP_MS;
    let a = this.samples[0]!, b = a;
    for (const sample of this.samples) { if (sample.snapshot.tick <= target) a = sample; b = sample; if (sample.snapshot.tick >= target) break; }
    const fraction = a === b ? 0 : Math.max(0, Math.min(1, (target - a.snapshot.tick) / (b.snapshot.tick - a.snapshot.tick)));
    // Latest membership removes departed players immediately. New joins never blend from another entity.
    return latest.snapshot.players.map(current => {
      const p = a.snapshot.players.find(p => p.id === current.id), q = b.snapshot.players.find(p => p.id === current.id);
      if (!p || !q || p.life !== q.life || current.life !== p.life || !current.hits) return current;
      return { ...p, x: p.x + (q.x - p.x) * fraction, y: p.y + (q.y - p.y) * fraction,
        facing: p.facing + Math.atan2(Math.sin(q.facing - p.facing), Math.cos(q.facing - p.facing)) * fraction };
    });
  }
  entities<K extends "bugs" | "shots">(kind: K, now: number): Snapshot[K] {
    const latest = this.samples.at(-1); if (!latest) return [];
    const target = latest.snapshot.tick + (now - latest.at - INTERPOLATION_MS) / STEP_MS;
    let a = this.samples[0]!, b = a;
    for (const s of this.samples) { if (s.snapshot.tick <= target) a = s; b = s; if (s.snapshot.tick >= target) break; }
    const f = a === b ? 0 : Math.max(0, Math.min(1, (target - a.snapshot.tick) / (b.snapshot.tick - a.snapshot.tick)));
    return latest.snapshot[kind].map(current => {
      const p = a.snapshot[kind].find(p => p.id === current.id), q = b.snapshot[kind].find(p => p.id === current.id);
      return p && q ? { ...current, x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f } : current;
    }) as Snapshot[K];
  }
}
