import { INTERPOLATION_MS, MAX_SNAPSHOTS, STEP_MS, WORLD_WIDTH, WORLD_HEIGHT } from "../../shared/arena/constants";
import type { Snapshot } from "../../shared/arena/protocol";
import type { Player, Bug, Shot, CombatEvent } from "../../shared/arena/types";
import { BUGS } from "../../shared/arena/bugs/registry";
import { boundaryTime, stopAtBoundary } from "../../shared/arena/motion";
function advancePosition(bug: Bug, ms: number) {
  const seconds = ms / 1000, travel = boundaryTime(bug.x, bug.y, bug.vx, bug.vy, seconds);
  bug.x += bug.vx * travel; bug.y += bug.vy * travel;
  if (travel < seconds) bug.vx = bug.vy = 0;
}
export class Interpolation {
  private samples: { snapshot: Snapshot; at: number }[] = [];
  private combatTick = -Infinity;
  private lastEvent = 0;
  get time() { return Number.isFinite(this.combatTick) ? this.combatTick * STEP_MS : 0; }
  private playerTransitions = new Map<string, number>();
  clear() { this.samples = []; this.combatTick = -Infinity; this.lastEvent = 0; this.playerTransitions.clear(); }
  push(snapshot: Snapshot, at: number) {
    const last = this.samples.at(-1);
    if (last && snapshot.tick < last.snapshot.tick) return;
    for (const p of snapshot.players) {
      const previous = last?.snapshot.players.find(q => q.id === p.id);
      if (!previous || previous.life !== p.life || previous.status !== p.status) this.playerTransitions.set(p.id, snapshot.tick);
    }
    for (const id of this.playerTransitions.keys()) if (!snapshot.players.some(p => p.id === id)) this.playerTransitions.delete(id);
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
      if (!p || !q || p.life !== q.life || current.life !== p.life || current.status !== "active" || p.status !== current.status || q.status !== current.status || a.snapshot.tick < this.playerTransitions.get(current.id)!) return current;
      return { ...current, x: p.x + (q.x - p.x) * fraction, y: p.y + (q.y - p.y) * fraction,
        facing: p.facing + Math.atan2(Math.sin(q.facing - p.facing), Math.cos(q.facing - p.facing)) * fraction };
    });
  }
  combat(now: number): Pick<Snapshot, "bugs" | "shots" | "events" | "pickups"> {
    const latest = this.samples.at(-1); if (!latest) return { bugs: [], shots: [], events: [], pickups: [] };
    // One monotonic clock owns births, movement, removals and their kill effects.
    const target = this.combatTick = Math.max(this.combatTick,
      Math.min(latest.snapshot.tick, latest.snapshot.tick + (now - latest.at - INTERPOLATION_MS) / STEP_MS));
    if (target < this.samples[0]!.snapshot.tick) return { bugs: [], shots: [], events: [], pickups: [] };
    let a = this.samples[0]!, b = a;
    for (const s of this.samples) { if (s.snapshot.tick <= target) a = s; b = s; if (s.snapshot.tick >= target) break; }
    const offset = target - a.snapshot.tick, events: CombatEvent[] = [];
    for (const sample of this.samples) {
      if (sample.snapshot.tick > target) break;
      for (const event of sample.snapshot.events) if (event.tick <= target && event.id > this.lastEvent) {
        events.push(event); this.lastEvent = event.id;
      }
    }
    return { pickups: a.snapshot.pickups, bugs: this.entities("bugs", a.snapshot, b.snapshot, offset), shots: this.entities("shots", a.snapshot, b.snapshot, offset), events };
  }
  private entities<K extends "bugs" | "shots">(kind: K, a: Snapshot, b: Snapshot, offset: number): Snapshot[K] {
    const visible: (Bug | Shot)[] = [];
    for (const p of a[kind]) {
      const q = b[kind].find(q => q.id === p.id);
      const entity = { ...p }, target = (a.tick + offset) * STEP_MS;
      let anchor = a.tick * STEP_MS;
      if ("kind" in entity) {
        const definition = BUGS[entity.kind];
        // Consume the known path before blending any unknown tracking movement.
        // This also runs when the next snapshot has already removed the bug.
        while (anchor < target && entity.phaseUntil! > anchor && definition.committedPhases?.includes(entity.phase!)) {
          const until = Math.min(target, entity.phaseUntil!);
          advancePosition(entity, until - anchor); anchor = until;
          if (anchor === entity.phaseUntil) {
            if (definition.advancePhase) definition.advancePhase(entity, anchor);
            else entity.vx = entity.vy = 0;
          }
        }
      }
      // Even a one-snapshot shot travels until its removal tick, never to latest-only membership.
      if (q && b.tick * STEP_MS > anchor) {
        const fraction = (target - anchor) / (b.tick * STEP_MS - anchor);
        entity.x += (q.x - entity.x) * fraction; entity.y += (q.y - entity.y) * fraction;
      } else if ("kind" in entity) {
        const until = entity.phaseUntil! > anchor ? Math.min(target, entity.phaseUntil!) : target;
        advancePosition(entity, until - anchor);
      } else {
        entity.x += entity.vx * (target - anchor) / 1000; entity.y += entity.vy * (target - anchor) / 1000;
      }
      entity.x = Math.max(0, Math.min(WORLD_WIDTH, entity.x)); entity.y = Math.max(0, Math.min(WORLD_HEIGHT, entity.y));
      if ("kind" in entity) { BUGS[entity.kind].advancePhase?.(entity, target); stopAtBoundary(entity); }
      visible.push(entity);
    }
    return visible as Snapshot[K];
  }
}
