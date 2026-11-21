import { expect, test } from "bun:test";
import { ArenaRenderer } from "./draw";
import { ArenaInput } from "./input";
import { canvasFixture } from "../game/canvas-fixture.test-support";
import { TEAM_COLOURS } from "../../shared/teams";
import { validateName } from "../../server/rules";
import { PLAYER_RADIUS, HEAT_CAPACITY } from "../../shared/arena/constants";
import { lifeDefaults } from "../../shared/arena/types";

test("renderer paints a grid, a distinguishing local ring, remote robots and complete names", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D);
    const local = { id: "local", name: "WideWWWWWWWWWWWW", team: "tabs" as const, x: 500, y: 500, vx: 0, vy: 0, facing: 0 };
    const remote = { ...local, id: "remote", team: "spaces" as const, x: 600, y: 400 };
    expect(validateName(local.name).error).toBeUndefined();
    const camera = { x: 100, y: 100 };
    renderer.draw(800, 600, camera, [local, remote], local, new ArenaInput());
    const grid = fixture.context.patterns.find(p => p.repetition === "repeat")!;
    expect(grid).toBeDefined();
    const tile = fixture.surfaces.find(s => s.canvas === grid.source)!;
    const background = tile.context.paints.find(p => p.op === "fillRect")!;
    let horizontal = false, vertical = false;
    for (const paint of tile.context.paints.filter(p => p.op === "stroke")) {
      expect(paint.strokeStyle).not.toEqual(background.fillStyle);
      let previous: number[] | undefined;
      for (const command of paint.path) {
        if (command.op === "lineTo" && previous) {
          horizontal ||= command.args[1] === previous[1] && command.args[0] !== previous[0];
          vertical ||= command.args[0] === previous[0] && command.args[1] !== previous[1];
        }
        previous = command.args;
      }
    }
    expect(horizontal && vertical).toBe(true);
    expect(fixture.context.paints.some(p => p.op === "fillRect" && p.fillStyle === (grid.value as unknown) &&
      (p.args[2] as number) >= 800 && (p.args[3] as number) >= 600)).toBe(true);
    const ringsAt = (player: typeof local | typeof remote) => fixture.context.paints.filter(p => p.op === "stroke" && p.path.some(command => {
      if (command.op !== "arc" || command.args[2]! <= PLAYER_RADIUS) return false;
      const [x, y] = command.args, [a, b, c, d, e, f] = p.transform;
      return a! * x! + c! * y! + e! === player.x - camera.x && b! * x! + d! * y! + f! === player.y - camera.y;
    }));
    expect(ringsAt(local).length).toBeGreaterThan(0);
    expect(ringsAt(remote)).toHaveLength(0);
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
        p.args[1] === player.x - label.canvas.width / 2 && (p.args[2] as number) + label.canvas.height <= player.y - PLAYER_RADIUS)).toBe(true);
    }
    const cached = fixture.created;
    renderer.draw(800, 600, camera, [local, remote], local, new ArenaInput());
    expect(fixture.created).toBe(cached);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});
test("combat feedback paints proportional heat, warning/immunity phases and authoritative HUD values", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const p = { ...lifeDefaults(), id: "local", name: "Robot", team: "tabs" as const, x: 500, y: 500, vx: 0, vy: 0, facing: 0,
      immuneUntil: 0, score: 123 };
    const draw = (tick: number, wave = 5) => {
      fixture.context.paints.length = 0;
      renderer.draw(800, 600, { x: 100, y: 100 }, [p], p, input, [], [], wave, tick, tick * 50);
      return [...fixture.context.paints];
    };
    const cold = draw(0), emptyBar = cold.find(paint => paint.op === "fillRect" && paint.args[2] === 0 &&
      Number(paint.args[3]) > 0 && Number(paint.args[3]) <= 8 && Math.abs(Number(paint.args[0]) - p.x) < 60 &&
      Math.abs(Number(paint.args[1]) - p.y) < 70);
    expect(emptyBar).toBeDefined();
    const bar = (paints: typeof cold) => paints.find(paint => paint.op === "fillRect" && paint.args[0] === emptyBar!.args[0] &&
      paint.args[1] === emptyBar!.args[1] && paint.args[3] === emptyBar!.args[3])!;
    p.heat = HEAT_CAPACITY / 2; const half = bar(draw(0)); expect(Number(half.args[2])).toBeGreaterThan(0); expect(half.globalAlpha).toBeGreaterThan(0);
    p.heat = HEAT_CAPACITY; const full = bar(draw(0)); expect(Number(full.args[2])).toBeCloseTo(Number(half.args[2]) * 2);
    p.heat = HEAT_CAPACITY * 0.9;
    const warningA = bar(draw(0)), warningB = bar(draw(2));
    expect(warningA.fillStyle).not.toEqual(warningB.fillStyle); expect(warningB.globalAlpha).toBeGreaterThan(0);
    p.immuneUntil = 1000;
    const body = (paints: typeof cold) => paints.find(paint => paint.op === "stroke" && paint.path.some(command => command.op === "roundRect"))!;
    const immuneA = body(draw(0)), immuneB = body(draw(2));
    expect(immuneA.globalAlpha).not.toBe(immuneB.globalAlpha); expect(immuneB.globalAlpha).toBeGreaterThan(0);
    const numbers = (paints: typeof cold) => paints.filter(paint => paint.op === "fillText")
      .flatMap(paint => String(paint.args[0]).match(/\d+(?:\.\d+)?/g)?.map(Number) ?? []);
    expect(numbers(cold)).toEqual(expect.arrayContaining([5, 123, 1, 3]));
    p.score = 987; p.streak = 7; p.hits = 1;
    const updated = numbers(draw(3, 12)); expect(updated).toEqual(expect.arrayContaining([12, 987, 1.7, 1]));
    expect(updated).not.toContain(123); expect(updated).not.toContain(5);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});
