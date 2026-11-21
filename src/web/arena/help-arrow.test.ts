import { expect, test } from "bun:test";
import { helpArrow } from "./help-arrow";

test("off-screen Help stays inside portrait, landscape and desktop bounds below the HUD", () => {
  for (const [width, height] of [[390, 844], [844, 390], [1280, 800]]) {
    expect(helpArrow(width! / 2, height! / 2, width!, height!)).toBeNull();
    for (const x of [-1000, width! / 2, width! + 1000]) for (const y of [-1000, height! / 2, height! + 1000]) {
      const arrow = helpArrow(x, y, width!, height!); if (!arrow) continue;
      expect(arrow.x).toBeGreaterThanOrEqual(31.999); expect(arrow.x).toBeLessThanOrEqual(width! - 31.999);
      expect(arrow.y).toBeGreaterThanOrEqual(111.999); expect(arrow.y + 30).toBeLessThanOrEqual(height!);
      expect(Math.sign(Math.cos(arrow.angle))).toBe(Math.sign(x - width! / 2) || 1);
    }
  }
});
