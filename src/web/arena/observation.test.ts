import { test, expect } from "bun:test";
import { ArenaObservation, type ArenaFrame } from "./observation";
import { ArenaRenderer } from "./draw";
import { ArenaInput } from "./input";
import { canvasFixture } from "../test-support/canvas-fixture.test-support";
import { lifeDefaults } from "../../shared/arena/types";
import { createBug } from "../../shared/arena/bugs/registry";
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
test("merged hive paints report health, edge arrows, body culling and only visible contributor awards", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const trace = new ArenaObservation({}).paint, renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D, trace);
    const hive = createBug("hive", 9, 1200, 300);
    renderer.draw(800, 600, { x: 0, y: 0 }, [], null, new ArenaInput(), [hive]);
    expect(trace.hive).toEqual({ id: 9, hp: hive.hp, maxHp: hive.maxHp!, arrow: true });
    expect(trace.bugs).toEqual([]);
    hive.x = 400;
    renderer.draw(800, 600, { x: 0, y: 0 }, [], null, new ArenaInput(), [hive]);
    expect(trace.hive!.arrow).toBe(false); expect(trace.bugs.map(b => b.id)).toEqual([9]);
    renderer.events([{ id: 10, tick: 1, kind: "hive", type: "kill", x: 400, y: 300, points: 0, rewards: [
      { playerId: "visible", life: 1, amount: 200, x: 400, y: 300 }, { playerId: "offscreen", life: 2, amount: 150, x: 2200, y: 300 },
    ] }], 100);
    renderer.draw(800, 600, { x: 0, y: 0 }, [], null, new ArenaInput(), [], [], 5, 1, 200);
    expect(trace.hive).toBeUndefined(); expect(trace.hiveRewards?.map(r => [r.playerId, r.life, r.amount])).toEqual([["visible", 1, 200]]);
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
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
