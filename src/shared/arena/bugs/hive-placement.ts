import { HIVE_RADIUS, WORLD_WIDTH, WORLD_HEIGHT } from "../constants";

/** The largest empty circle in a rectangle is at a clipped Voronoi vertex.
 * Only runs on fifth-wave boundaries; at most 20 sites and O(n^4) bounded work. */
export function hivePlacement(players: Iterable<{ x: number; y: number }>) {
  const sites = Array.from(players).filter((p, i, all) => all.findIndex(q => q.x === p.x && q.y === p.y) === i);
  const lo = HIVE_RADIUS, right = WORLD_WIDTH - lo, bottom = WORLD_HEIGHT - lo;
  if (!sites.length) return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, clearance: Infinity };
  let x = lo, y = lo, best = -1;
  const consider = (cx: number, cy: number) => {
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx < lo - 1e-7 || cx > right + 1e-7 || cy < lo - 1e-7 || cy > bottom + 1e-7) return;
    cx = Math.max(lo, Math.min(right, cx)); cy = Math.max(lo, Math.min(bottom, cy));
    let d = Infinity;
    for (const p of sites) d = Math.min(d, (cx - p.x) ** 2 + (cy - p.y) ** 2);
    if (d > best + 1e-7 || Math.abs(d - best) <= 1e-7 && (cx < x || cx === x && cy < y)) { best = d; x = cx; y = cy; }
  };
  for (const cx of [lo, right]) for (const cy of [lo, bottom]) consider(cx, cy);
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    const a = sites[i]!, b = sites[j]!, dx = b.x - a.x, dy = b.y - a.y;
    const c = (b.x * b.x + b.y * b.y - a.x * a.x - a.y * a.y) / 2;
    if (dy) for (const cx of [lo, right]) consider(cx, (c - dx * cx) / dy);
    if (dx) for (const cy of [lo, bottom]) consider((c - dy * cy) / dx, cy);
    for (let k = j + 1; k < sites.length; k++) {
      const p = sites[k]!, ex = p.x - a.x, ey = p.y - a.y, det = dx * ey - dy * ex;
      if (Math.abs(det) < 1e-9) continue;
      const f = (p.x * p.x + p.y * p.y - a.x * a.x - a.y * a.y) / 2;
      consider((c * ey - dy * f) / det, (dx * f - c * ex) / det);
    }
  }
  return { x, y, clearance: Math.sqrt(best) };
}
