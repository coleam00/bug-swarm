import { expect, test } from "bun:test";
import { minimapBounds, projectMarker } from "./minimap";

test("minimap preserves world aspect, resizes and clamps every corner inside the outline", () => {
  for (const [width, height, size] of [[1280, 720, 144], [844, 390, 96], [390, 844, 96]]) {
    const map = minimapBounds(width!, height!, 2400, 1200);
    expect(map.width).toBe(size!); expect(map.height).toBe(size! / 2);
    expect(map.x + map.width).toBeLessThan(width!); expect(map.y).toBeGreaterThan(42);
    expect(projectMarker(-100, 2400, map.x, map.width, 4)).toBe(map.x + 4);
    expect(projectMarker(2500, 2400, map.x, map.width, 4)).toBe(map.x + map.width - 4);
    expect(projectMarker(1200, 2400, map.x, map.width, 4)).toBe(map.x + map.width / 2);
  }
});
