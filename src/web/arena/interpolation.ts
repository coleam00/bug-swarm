import { INTERPOLATION_MS, MAX_SNAPSHOTS, STEP_MS, WORLD_WIDTH, WORLD_HEIGHT } from "../../shared/arena/constants";
import type { Snapshot } from "../../shared/arena/protocol";
import type { Player, Bug, Shot, KillEvent } from "../../shared/arena/types";
export class Interpolation {
  private samples: { snapshot: Snapshot; at: number }[] = [];
  private combatTick = -Infinity;
  private lastEvent = 0;
  clear() { this.samples = []; this.combatTick = -Infinity; this.lastEvent = 0; }
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
      return { ...current, x: p.x + (q.x - p.x) * fraction, y: p.y + (q.y - p.y) * fraction,
        facing: p.facing + Math.atan2(Math.sin(q.facing - p.facing), Math.cos(q.facing - p.facing)) * fraction };
    });
  }
  combat(now: number): Pick<Snapshot, "bugs" | "shots" | "events"> {
    const latest = this.samples.at(-1); if (!latest) return { bugs: [], shots: [], events: [] };
    // One monotonic clock owns births, movement, removals and their kill effects.
    const target = this.combatTick = Math.max(this.combatTick,
      Math.min(latest.snapshot.tick, latest.snapshot.tick + (now - latest.at - INTERPOLATION_MS) / STEP_MS));
    if (target < this.samples[0]!.snapshot.tick) return { bugs: [], shots: [], events: [] };
    let a = this.samples[0]!, b = a;
    for (const s of this.samples) { if (s.snapshot.tick <= target) a = s; b = s; if (s.snapshot.tick >= target) break; }
    const offset = target - a.snapshot.tick, events: KillEvent[] = [];
    for (const sample of this.samples) {
      if (sample.snapshot.tick > target) break;
      for (const event of sample.snapshot.events) if (event.tick <= target && event.id > this.lastEvent) {
        events.push(event); this.lastEvent = event.id;
      }
    }
    return { bugs: this.entities("bugs", a.snapshot, b.snapshot, offset), shots: this.entities("shots", a.snapshot, b.snapshot, offset), events };
  }
  private entities<K extends "bugs" | "shots">(kind: K, a: Snapshot, b: Snapshot, offset: number): Snapshot[K] {
    const fraction = a === b ? 0 : offset / (b.tick - a.tick);
    const visible: (Bug | Shot)[] = [];
    for (const p of a[kind]) {
      const q = b[kind].find(q => q.id === p.id);
      // Even a one-snapshot shot travels until its removal tick, never to latest-only membership.
      const x = q ? p.x + (q.x - p.x) * fraction : p.x + p.vx * offset * STEP_MS / 1000;
      const y = q ? p.y + (q.y - p.y) * fraction : p.y + p.vy * offset * STEP_MS / 1000;
      visible.push({ ...p, x: Math.max(0, Math.min(WORLD_WIDTH, x)), y: Math.max(0, Math.min(WORLD_HEIGHT, y)) });
    }
    return visible as Snapshot[K];
  }
}
