import { HEAT_CAPACITY, HEAT_COOLING, HEAT_GAIN, MUZZLE_OFFSET, OVERHEAT_MS, SHOT_LIFETIME_MS, SHOT_RADIUS, SHOT_RATE, SHOT_SPEED, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { BUGS } from "./bugs/registry";
import type { ArenaState, Input } from "./types";
// First entry of a relative segment into a circle, including initial overlap.
export function circleEntry(x: number, y: number, dx: number, dy: number, radius: number): number | null {
  const c = x * x + y * y - radius * radius; if (c <= 0) return 0;
  const a = dx * dx + dy * dy, b = 2 * (x * dx + y * dy), d = b * b - 4 * a * c;
  if (!a || d < 0) return null;
  const t = (-b - Math.sqrt(d)) / (2 * a); return t >= 0 && t <= 1 ? t : null;
}
export function fireAndAdvance(state: ArenaState, inputs: ReadonlyMap<string, Input>, time: number) {
  const end = time + STEP_MS;
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
      const b = state.bugs[i]!, offset = (from - time) / 1000;
      const t = circleEntry(s.x - b.x - b.vx * offset, s.y - b.y - b.vy * offset, (s.vx - b.vx) * boundary, (s.vy - b.vy) * boundary, SHOT_RADIUS + BUGS[b.kind].radius);
      if (t !== null && (t < first || (t === first && b.id < state.bugs[victim]!.id))) { first = t; victim = i; }
    }
    if (victim >= 0) {
      const b = state.bugs[victim]!, multiplier = Math.min(30, 10 + ++owner.streak), points = BUGS[b.kind].points * multiplier;
      owner.points += points; owner.score = Math.round(owner.points / 10); owner.kills++;
      state.events.push({ id: state.nextId++, tick: state.tick + 1, x: b.x + b.vx * ((from - time) / 1000 + boundary * first), y: b.y + b.vy * ((from - time) / 1000 + boundary * first), points: points / 10 });
      state.bugs.splice(victim, 1); continue;
    }
    s.x += s.vx * boundary; s.y += s.vy * boundary;
    if (to >= s.born + SHOT_LIFETIME_MS - 1e-8 || boundary < dt || s.x <= 0 || s.x >= WORLD_WIDTH || s.y <= 0 || s.y >= WORLD_HEIGHT) { owner.streak = 0; continue; }
    state.shots[count++] = s;
  }
  state.shots.length = count;
}
