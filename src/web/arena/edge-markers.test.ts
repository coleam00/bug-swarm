import { expect, test } from "bun:test";
import { EdgeMarkers } from "./edge-markers";
import { RecordingContext } from "../test-support/canvas-fixture.test-support";
import { MAX_PLAYERS } from "../../shared/arena/constants";

test("all Help and Hive bounds fit apart below the HUD at maximum capacity on every edge and corner", () => {
  const markers = new EdgeMarkers(new RecordingContext() as unknown as CanvasRenderingContext2D);
  for (const [width, height] of [[390, 844], [844, 390], [1280, 720]] as const) {
    const top = (width === 1280 ? 144 : 96) + 94 + 24;
    for (const [tx, ty] of [[-1000, height / 2], [width + 1000, height / 2], [width / 2, -1000], [width / 2, height + 1000], [-1000, -1000], [width + 1000, height + 1000], [-1000, height + 1000], [width + 1000, -1000]] as const) {
      const collect = (reverse: boolean) => {
        markers.begin(width, height, top);
        for (let n = 0; n <= MAX_PLAYERS; n++) { const i = reverse ? MAX_PLAYERS - n : n; markers.add(String(i).padStart(2, "0"), i === MAX_PLAYERS, tx, ty); }
        markers.place();
      };
      collect(false); expect(markers.count).toBe(MAX_PLAYERS + 1);
      const positions = markers.markers.map(m => [m.id, m.x, m.y]);
      for (let i = 0; i < markers.count; i++) {
        const m = markers.markers[i]!;
        expect(m.x - markers.halfWidth).toBeGreaterThanOrEqual(8);
        expect(m.x + markers.halfWidth).toBeLessThanOrEqual(width - 8);
        expect(m.y - 15).toBeGreaterThanOrEqual(top);
        expect(m.y + markers.bottom).toBeLessThanOrEqual(height - 8);
        expect(m.angle).toBeCloseTo(Math.atan2(ty - m.y, tx - m.x));
        for (let j = 0; j < i; j++) {
          const other = markers.markers[j]!;
          expect(Math.abs(m.x - other.x) + 0.001 >= markers.halfWidth * 2 + 8 || Math.abs(m.y - other.y) + 0.001 >= 15 + markers.bottom + 8).toBe(true);
        }
      }
      collect(true); expect(markers.markers.map(m => [m.id, m.x, m.y])).toEqual(positions);
    }
    // Shared occupancy also resolves opposing edges competing for corner cells.
    markers.begin(width, height, top);
    for (let i = 0; i <= MAX_PLAYERS; i++) markers.add(String(i), i === MAX_PLAYERS, i % 2 ? -1000 : width + 1000, i % 3 ? -1000 : height + 1000);
    markers.place(); expect(new Set(markers.markers.map(m => `${m.x}/${m.y}`)).size).toBe(MAX_PLAYERS + 1);
    markers.begin(width, height, top); markers.add("visible", false, width / 2, height / 2); markers.place(); expect(markers.count).toBe(0);
    markers.reset(); expect(markers.count).toBe(0);
  }
});
