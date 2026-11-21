import { expect, test } from "bun:test";
import { EdgeMarkers } from "./edge-markers";
import { RecordingContext } from "../test-support/canvas-fixture.test-support";
import { minimapBounds } from "./minimap";
import { MAX_PLAYERS } from "../../shared/arena/constants";

test("all Help and Hive bounds fit apart below the HUD at maximum capacity on every edge and corner", () => {
  const markers = new EdgeMarkers(new RecordingContext() as unknown as CanvasRenderingContext2D);
  for (const [width, height] of [[390, 844], [844, 390], [1280, 720], [568, 320], [844, 300], [667, 280]] as const) {
    const top = 94, map = minimapBounds(width, height, 2400, 2400, true), celebration = { x: width / 2 - 90, y: height - 66, width: 180, height: 54 };
    for (const [tx, ty] of [[-1000, height / 2], [width + 1000, height / 2], [width / 2, -1000], [width / 2, height + 1000], [-1000, -1000], [width + 1000, height + 1000], [-1000, height + 1000], [width + 1000, -1000]] as const) {
      const collect = (reverse: boolean) => {
        markers.begin(width, height, top, map, undefined, celebration);
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
        expect(m.x + markers.halfWidth + 8 <= map.x || m.x - markers.halfWidth - 8 >= map.x + map.width || m.y + markers.bottom + 8 <= map.y || m.y - 15 - 8 >= map.y + map.height).toBe(true);
        expect(m.x + markers.halfWidth + 8 <= celebration.x || m.x - markers.halfWidth - 8 >= celebration.x + celebration.width || m.y + markers.bottom + 8 <= celebration.y || m.y - 15 - 8 >= celebration.y + celebration.height).toBe(true);
        expect(m.angle).toBeCloseTo(Math.atan2(ty - m.y, tx - m.x));
        for (let j = 0; j < i; j++) {
          const other = markers.markers[j]!;
          expect(Math.abs(m.x - other.x) + 0.001 >= markers.halfWidth * 2 + 8 || Math.abs(m.y - other.y) + 0.001 >= 15 + markers.bottom + 8).toBe(true);
        }
      }
      collect(true); expect(markers.markers.map(m => [m.id, m.x, m.y])).toEqual(positions);
    }
    // Shared occupancy also resolves opposing edges competing for corner cells.
    markers.begin(width, height, top, map, undefined, celebration);
    for (let i = 0; i <= MAX_PLAYERS; i++) markers.add(String(i), i === MAX_PLAYERS, i % 2 ? -1000 : width + 1000, i % 3 ? -1000 : height + 1000);
    markers.place(); expect(new Set(markers.markers.map(m => `${m.x}/${m.y}`)).size).toBe(MAX_PLAYERS + 1);
    markers.begin(width, height, top, map, undefined, celebration); markers.add("visible", false, width / 2, height / 2); markers.place(); expect(markers.count).toBe(0);
    markers.reset(); expect(markers.count).toBe(0);
  }
  // Capping stored rows must still cover the bottom of a tall viewport.
  markers.begin(1280, 2160, 94); markers.add("bottom", true, 640, 5000); markers.place();
  expect(markers.markers[0]!.y).toBeGreaterThanOrEqual(2080);

});


test("crowded downed phones retain all twenty markers outside the content-sized panel", () => {
  const context = new RecordingContext();
  // Approximate the factory's 16px system font advances instead of the fixture's
  // deliberately oversized generic metrics, while retaining descent padding.
  context.measureText = text => ({ width: text.length * 9, actualBoundingBoxLeft: text.length * 4.5,
    actualBoundingBoxRight: text.length * 4.5, actualBoundingBoxDescent: 4 }) as TextMetrics;
  const markers = new EdgeMarkers(context as unknown as CanvasRenderingContext2D);
  for (const [width, height] of [[568, 280], [568, 320], [667, 280], [844, 300]]) {
    const panel = { x: (width! - 329) / 2, y: Math.ceil(height! / 2 + 50), width: 329, height: 52 };
    markers.begin(width!, height!, 94, minimapBounds(width!, height!, 2400, 2400, true), panel, { x: width! / 2 - 90, y: height! - 66, width: 180, height: 54 }, { x: 10, y: 90, width: 140, height: 44 });
    for (let i = 0; i < 20; i++) markers.add(String(i), i === 19, width! + 1000, height! / 2);
    markers.place(); expect(markers.count).toBe(20);
    for (let i = 0; i < markers.count; i++) {
      const m = markers.markers[i]!;
      expect(m.x + markers.halfWidth + 8 <= panel.x || m.x - markers.halfWidth - 8 >= panel.x + panel.width || m.y + markers.bottom + 8 <= panel.y || m.y - 15 - 8 >= panel.y + panel.height).toBe(true);
      for (let j = 0; j < i; j++) { const n = markers.markers[j]!; expect(Math.abs(m.x - n.x) + 0.001 >= markers.halfWidth * 2 + 8 || Math.abs(m.y - n.y) + 0.001 >= 15 + markers.bottom + 8).toBe(true); }
    }
  }
});
