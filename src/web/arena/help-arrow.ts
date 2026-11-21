/** CSS-pixel projection with room for the arrow, label and top HUD. */
export function helpArrow(x: number, y: number, width: number, height: number, top = 112) {
  if (x >= 0 && x <= width && y >= 0 && y <= height) return null;
  const left = 32, right = width - 32, bottom = height - 40;
  if (right <= left || bottom <= top) return null;
  const cx = width / 2, cy = (top + bottom) / 2, dx = x - cx, dy = y - cy;
  const t = Math.min(dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity,
    dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity);
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}
