import { expect, test } from "bun:test";
import { cameraFor, worldView } from "./view";

test("all supported scaled views fit the server envelope, including camera padding at boundaries", () => {
  for (const [w, h] of [[390, 844], [844, 390], [1920, 1080], [3840, 2160], [2560, 720], [720, 2560]]) {
    const view = worldView(w!, h!);
    expect(Math.max(view.width, view.height)).toBeLessThanOrEqual(900);
    for (const x of [14, 450, 1200, 1950, 2386]) for (const y of [14, 450, 1200, 1950, 2386]) {
      const c = cameraFor(x, y, view.width, view.height), envelope = cameraFor(x, y, 900, 900);
      expect(c.x).toBeGreaterThanOrEqual(envelope.x - 1e-8); expect(c.y).toBeGreaterThanOrEqual(envelope.y - 1e-8);
      expect(c.x + view.width).toBeLessThanOrEqual(envelope.x + 900 + 1e-8); expect(c.y + view.height).toBeLessThanOrEqual(envelope.y + 900 + 1e-8);
      if (x >= 450 && x <= 1950 && y >= 450 && y <= 1950) {
        expect((x - c.x) * view.scale).toBeCloseTo(w! / 2); expect((y - c.y) * view.scale).toBeCloseTo(h! / 2);
      }
    }
  }
});
