import { MAX_VIEW, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
/** CSS pixels stay the unit for HUD and controls; world drawing uses this scale. */
export function worldView(width: number, height: number) {
  const scale = Math.max(1, width / MAX_VIEW, height / MAX_VIEW);
  return { width: width / scale, height: height / scale, scale };
}
export function cameraFor(x: number, y: number, width: number, height: number) {
  return { x: Math.max(-112, Math.min(Math.max(-112, WORLD_WIDTH - width + 112), x - width / 2)),
    y: Math.max(-144, Math.min(Math.max(-144, WORLD_HEIGHT - height + 64), y - height / 2)) };
}
