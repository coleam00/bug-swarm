import { HEAT_CAPACITY, HEAT_COOLING, HEAT_GAIN, MUZZLE_OFFSET, OVERHEAT_MS, SHOT_LIFETIME_MS, SHOT_RADIUS, SHOT_RATE, SHOT_SPEED, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { BUGS } from "./bugs/registry";
import type { ArenaState, Input } from "./types";
import { recordMotion, motionFor } from "./motion";
// First entry of a relative segment into a circle, including initial overlap.
export function circleEntry(x: number, y: number, dx: number, dy: number, radius: number): number | null {
  const c = x * x + y * y - radius * radius; if (c <= 0) return 0;
  const a = dx * dx + dy * dy, b = 2 * (x * dx + y * dy), d = b * b - 4 * a * c;
  if (!a || d < 0) return null;
  const t = (-b - Math.sqrt(d)) / (2 * a); return t >= 0 && t <= 1 ? t : null;
}
export function fireAndAdvance(state: ArenaState, inputs: ReadonlyMap<string, Input>, time: number) {
  const end = time + STEP_MS;
  for (const b of state.bugs) recordMotion(b);
  for (const p of state.players.values()) {
    if (!p.hits) continue;
    const firing = inputs.get(p.id)?.fire ?? false;
    if (!firing) {
      p.heat = Math.max(0, p.heat - HEAT_COOLING * STEP_MS / 1000);
      // Release may discard overdue fire, but cannot shorten a shot's cooldown.
      p.nextShotAt = Math.max(p.nextShotAt, end); continue;
    }
    const lockedUntil = Math.max(time, Math.min(end, p.overheatUntil));
    p.heat = Math.max(0, p.heat - HEAT_COOLING * (lockedUntil - time) / 1000);
    p.nextShotAt = Math.max(lockedUntil, p.nextShotAt);
    while (p.nextShotAt < end - 1e-8) {
      p.spawnProtectedUntil = 0;
      const at = p.nextShotAt, dx = Math.cos(p.facing), dy = Math.sin(p.facing);
      state.shots.push({ id: state.nextId++, owner: p.id, life: p.life, x: p.x - p.vx * (end - at) / 1000 + dx * MUZZLE_OFFSET, y: p.y - p.vy * (end - at) / 1000 + dy * MUZZLE_OFFSET, vx: dx * SHOT_SPEED, vy: dy * SHOT_SPEED, born: at });
      p.heat += HEAT_GAIN; p.nextShotAt += 1000 / SHOT_RATE;
      if (p.heat >= HEAT_CAPACITY - 1e-8) { p.overheatUntil = at + OVERHEAT_MS; p.nextShotAt = end; p.heat = Math.max(0, p.heat - HEAT_COOLING * (end - at) / 1000); break; }
    }
  }
  let count = 0;
  for (const s of state.shots) {
    const owner = state.players.get(s.owner); if (!owner?.hits || owner.life !== s.life) continue;
    const from = Math.max(time, s.born), to = Math.min(end, s.born + SHOT_LIFETIME_MS), dt = Math.max(0, to - from) / 1000;
    let boundary = dt;
    if (s.vx > 0) boundary = Math.min(boundary, (WORLD_WIDTH - s.x) / s.vx); else if (s.vx < 0) boundary = Math.min(boundary, -s.x / s.vx);
    if (s.vy > 0) boundary = Math.min(boundary, (WORLD_HEIGHT - s.y) / s.vy); else if (s.vy < 0) boundary = Math.min(boundary, -s.y / s.vy);
    boundary = Math.max(0, boundary);
    let victim = -1, first = Infinity;
    for (let i = 0; i < state.bugs.length; i++) {
      const b = state.bugs[i]!, m = motionFor(b), offset = (from - time) / 1000;
      // A bug may reach the wall partway through this shot's active interval.
      for (let segment = 0; segment < 2; segment++) {
        const start = segment ? Math.max(0, m.stop - offset) : 0;
        const finish = segment ? boundary : Math.min(boundary, Math.max(0, m.stop - offset));
        if (finish < start || start > boundary) continue;
        const moving = segment === 0 && offset < m.stop, bvx = moving ? m.vx : 0, bvy = moving ? m.vy : 0;
        const t = circleEntry(s.x + s.vx * start - m.x - m.vx * Math.min(m.stop, offset + start), s.y + s.vy * start - m.y - m.vy * Math.min(m.stop, offset + start), (s.vx - bvx) * (finish - start), (s.vy - bvy) * (finish - start), SHOT_RADIUS + BUGS[b.kind].radius);
        const entry = t === null ? Infinity : start + t * (finish - start);
        if (entry < first || entry !== Infinity && entry === first && b.id < state.bugs[victim]!.id) { first = entry; victim = i; }
      }
    }
    if (victim >= 0) {
      const b = state.bugs[victim]!, m = motionFor(b), multiplier = Math.min(30, 10 + ++owner.streak), killed = --b.hp === 0;
      const points = killed ? BUGS[b.kind].points * multiplier : 0;
      if (killed) { owner.points += points; owner.score = Math.round(owner.points / 10); owner.kills++; }
      const impact = Math.min(m.stop, (from - time) / 1000 + first);
      const event = { id: state.nextId++, tick: state.tick + 1, kind: b.kind, x: m.x + m.vx * impact, y: m.y + m.vy * impact };
      state.events.push(killed ? { ...event, type: "kill", points: points / 10 } : { ...event, type: "hit", points: 0 });
      if (killed) state.bugs.splice(victim, 1);
      continue;
    }
    s.x += s.vx * boundary; s.y += s.vy * boundary;
    if (to >= s.born + SHOT_LIFETIME_MS - 1e-8 || boundary < dt || s.x <= 0 || s.x >= WORLD_WIDTH || s.y <= 0 || s.y >= WORLD_HEIGHT) { owner.streak = 0; continue; }
    state.shots[count++] = s;
  }
  state.shots.length = count;
}
