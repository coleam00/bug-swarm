import { WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/arena/constants";
export function cameraFor(x: number, y: number, width: number, height: number) {
  return { x: Math.max(0, Math.min(Math.max(0, WORLD_WIDTH - width), x - width / 2)),
    y: Math.max(0, Math.min(Math.max(0, WORLD_HEIGHT - height), y - height / 2)) };
}
