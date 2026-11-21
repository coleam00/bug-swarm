import { expect, test } from "bun:test";
import { drawMinimap, minimapBounds, projectMarker } from "./minimap";
import { canvasFixture } from "../test-support/canvas-fixture.test-support";
import { lifeDefaults } from "../../shared/arena/types";
import { TEAM_COLOURS } from "../../shared/teams";

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
test("minimap draws faint swarm, both living teams, then one predicted local marker", () => {
  const f = canvasFixture(), map = minimapBounds(390, 844, 2400, 2400);
  const local = { ...lifeDefaults(), id: "local", name: "Pilot", team: "tabs" as const, x: 2400, y: 0, vx: 0, vy: 0, facing: 0 };
  const remote = { ...local, id: "remote", team: "spaces" as const, x: 1200, y: 1200 };
  drawMinimap(f.context as unknown as CanvasRenderingContext2D, map, 2400, 2400,
    [{ ...local, x: 0 }, remote, { ...remote, id: "dead", hits: 0 }], local,
    [{ id: 1, kind: "crawler", x: 600, y: 600, vx: 0, vy: 0 }]);
  const dots = f.context.paints.filter(p => p.op === "fill" && p.path.some(c => c.op === "arc"));
  expect(dots).toHaveLength(3);
  expect(dots.map(p => p.fillStyle)).toEqual(["#e3928140", TEAM_COLOURS.spaces, TEAM_COLOURS.tabs]);
  expect(dots.at(-1)?.path[0]?.args.slice(0, 3)).toEqual([map.x + map.width - 4.5, map.y + 4.5, 4.5]);
  expect(f.context.paints.at(-1)?.strokeStyle).toBe("#fff5d8");
});
