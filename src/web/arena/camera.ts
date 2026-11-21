import { WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/arena/constants";
export function cameraFor(x: number, y: number, width: number, height: number) {
  // Reserve the HUD and full robot/name/barrel/heat extents, including at corners.
  return { x: Math.max(-112, Math.min(Math.max(-112, WORLD_WIDTH - width + 112), x - width / 2)),
    y: Math.max(-144, Math.min(Math.max(-144, WORLD_HEIGHT - height + 64), y - height / 2)) };
}
