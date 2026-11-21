import { test, expect } from "bun:test";
import { ArenaObservation, type ArenaFrame } from "./observation";
import { ArenaRenderer } from "./draw";
import { ArenaInput } from "./input";
import { canvasFixture } from "../test-support/canvas-fixture.test-support";
import { lifeDefaults } from "../../shared/arena/types";
test("debug property returns copies and has no setter or action methods", () => {
  const target = {}, observation = new ArenaObservation(target);
  observation.publish({ at: 1, local: { x: 8 } } as Omit<ArenaFrame, "frame" | "paint">);
  const copy = observation.read()!; copy.local.x = 999;
  expect(observation.read()!.local.x).toBe(8);
  expect(Object.getOwnPropertyDescriptor(target, "__arenaDebug")!.set).toBeUndefined();
  observation.paint.effects.push({ id: 1, tick: 1, at: 1, x: 0, y: 0, kind: "crawler", type: "kill", points: 10 });
  observation.publish({ at: 1, generation: 1 } as Omit<ArenaFrame, "frame" | "paint">);
  expect(observation.read()!.paint.effects).toHaveLength(1);
  observation.paint.effects = [];
  observation.publish({ at: 2, generation: 2 } as Omit<ArenaFrame, "frame" | "paint">);
  expect(observation.read()!.paint.effects).toEqual([]);
  observation.dispose(); expect("__arenaDebug" in target).toBe(false);
});
test("paint observation follows actual culling, downed rings, names/colours, shots and visible effects", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const trace = new ArenaObservation({}).paint, renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D, trace);
    const visible = { ...lifeDefaults(), id: "a", name: "PilotA", team: "tabs" as const, x: 200, y: 200, vx: 0, vy: 0, facing: 0, status: "downed" as const, reviveMs: 500 };
    const offscreen = { ...visible, id: "b", x: 2300 };
    const event = { id: 1, tick: 1, x: 200, y: 200, points: 10, type: "kill" as const, kind: "crawler" as const };
    renderer.events([event, { ...event, id: 2, x: 2300 }], 0);
    renderer.draw(800, 600, { x: 0, y: 0 }, [visible, offscreen], null, new ArenaInput(), [], [], 1, 1, 100);
    expect(trace.players.map(p => p.id)).toEqual(["a"]); expect(trace.players[0]!.reviveRing).toBe(true);
    expect(trace.effects.map(e => e.id)).toEqual([1]);
    expect(fixture.context.paints.some(p => p.op === "drawImage")).toBe(true);
    renderer.draw(800, 600, { x: 1400, y: 0 }, [visible, offscreen], null, new ArenaInput()); expect(trace.players).toEqual([]);
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});
