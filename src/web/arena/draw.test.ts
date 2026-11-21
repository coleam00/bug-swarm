import { expect, test } from "bun:test";
import { ArenaRenderer } from "./draw";
import { ArenaInput } from "./input";
import { canvasFixture } from "../game/canvas-fixture.test-support";
import { TEAM_COLOURS } from "../../shared/teams";
import { validateName } from "../../server/rules";

test("renderer paints an on-screen remote robot and complete measured names for both players", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D);
    const local = { id: "local", name: "WideWWWWWWWWWWWW", team: "tabs" as const, x: 500, y: 500, vx: 0, vy: 0, facing: 0 };
    const remote = { ...local, id: "remote", team: "spaces" as const, x: 600, y: 400 };
    expect(validateName(local.name).error).toBeUndefined();
    const camera = { x: 100, y: 100 };
    renderer.draw(800, 600, camera, [local, remote], local, new ArenaInput());
    for (const player of [local, remote]) {
      expect(fixture.context.paints.some(p => p.op === "stroke" && p.strokeStyle === TEAM_COLOURS[player.team] &&
        p.path.some(command => command.op === "roundRect") && p.transform[4] === player.x - camera.x && p.transform[5] === player.y - camera.y)).toBe(true);
      const surface = fixture.surfaces.find(s => s.context.paints.some(p => p.op === "fillText" && p.args[0] === player.name && p.fillStyle === TEAM_COLOURS[player.team]));
      expect(surface).toBeDefined();
      const label = surface!, text = label.context.paints.find(p => p.op === "strokeText")!;
      const metrics = label.context.measureText(player.name), center = text.args[1] as number;
      expect(center - metrics.actualBoundingBoxLeft - text.lineWidth / 2).toBeGreaterThanOrEqual(0);
      expect(center + metrics.actualBoundingBoxRight + text.lineWidth / 2).toBeLessThanOrEqual(label.canvas.width);
      expect(fixture.context.paints.some(p => p.op === "drawImage" && p.args[0] === label.canvas &&
        p.args[1] === player.x - label.canvas.width / 2 && p.args[2] === player.y - 54)).toBe(true);
    }
    const cached = fixture.created;
    renderer.draw(800, 600, camera, [local, remote], local, new ArenaInput());
    expect(fixture.created).toBe(cached);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});
