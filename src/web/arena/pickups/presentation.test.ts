import { expect, test } from "bun:test";
import { pickupAlpha, effectRemaining } from "./registry";
import { Interpolation } from "../interpolation";
import type { Snapshot } from "../../../shared/arena/protocol";
import { ArenaRenderer } from "../draw";
import { ArenaInput } from "../input";
import { lifeDefaults } from "../../../shared/arena/types";
import { canvasFixture } from "../../test-support/canvas-fixture.test-support";
test("floor pickups share delayed combat birth/removal, while blink and HUD obey exact deadlines", () => {
  const snapshot = (tick: number, visible: boolean): Snapshot => ({ v: 1, type: "snapshot", arenaId: "test", tick, wave: 1, players: [], bugs: [], shots: [], events: [],
    pickups: visible ? [{ id: 1, kind: "shield", x: 500, y: 500, expiresAt: 12500 }] : [] });
  const i = new Interpolation(); i.push(snapshot(9, false), 450); i.push(snapshot(10, true), 500); i.push(snapshot(11, false), 550);
  expect(i.combat(599).pickups).toEqual([]); expect(i.combat(600).pickups).toHaveLength(1);
  expect(i.combat(649).pickups).toHaveLength(1); expect(i.combat(650).pickups).toEqual([]);
  expect(pickupAlpha(3001)).toBe(1); expect(pickupAlpha(3000)).toBe(0.25); expect(pickupAlpha(2999)).toBe(1);
  expect(pickupAlpha(250)).toBe(1); expect(pickupAlpha(249)).toBe(0.25); expect(pickupAlpha(0)).toBe(0);
  expect(effectRemaining(20000, 0, 20000)).toBe(1); expect(effectRemaining(20000, 10000, 20000)).toBe(0.5);
  expect(effectRemaining(30000, 10000, 20000)).toBe(1); expect(effectRemaining(20000, 20000, 20000)).toBe(0);
});
test("renderer caches violet floor glow, culls by glow extent, shows remote bubbles and authoritative HUD depletion", () => {
  const f = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => f.factory() } });
  try {
    const c = f.context, renderer = new ArenaRenderer(c as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const p = { ...lifeDefaults(), id: "a", name: "Pilot", team: "tabs" as const, x: 300, y: 300, vx: 0, vy: 0, facing: 0, ackSeq: 0 };
    const remote = { ...p, id: "b", x: 500, effects: { shield: 20000 } };
    const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "test", tick: 200, wave: 1, players: [{ ...p, effects: { shield: 20000 } }, remote], bugs: [], shots: [], events: [],
      pickups: [{ id: 1, kind: "shield", x: 500, y: 400, expiresAt: 12000 }] };
    const draw = (remaining = 2000) => { c.paints.length = 0; renderer.draw(390, 844, { x: 200, y: 200 }, [p, remote], p, input, [], [], 1, 200, 10000, 1, snapshot, 12000 - remaining, snapshot.pickups); return [...c.paints]; };
    const paint = draw(); const count = f.created; draw(); expect(f.created).toBe(count);
    const ring = paint.find(p => p.op === "stroke" && p.strokeStyle === "#bf96ff" && p.path.some(q => q.op === "arc" && q.args[2] === 18))!;
    expect(ring.path[0]!.args[4]! - ring.path[0]!.args[3]!).toBeCloseTo(Math.PI);
    expect(paint.some(p => p.op === "stroke" && p.strokeStyle === "#bf96ff" && p.path.some(q => q.op === "arc" && q.args[2] === 32))).toBe(true);
    expect(paint.some(p => p.op === "drawImage" && p.globalAlpha === 0.25)).toBe(true);
    expect(draw(1999).some(p => p.op === "drawImage" && p.globalAlpha === 0.25)).toBe(false);
    snapshot.players[0]!.effects.shield = 30000;
    expect(draw().some(p => p.op === "stroke" && p.strokeStyle === "#bf96ff" && p.path.some(q => q.op === "arc" && q.args[2] === 18 && Math.abs(q.args[4]! - q.args[3]! - Math.PI * 2) < 0.001))).toBe(true);
    snapshot.players[0]!.effects = {}; remote.effects = {} as typeof remote.effects;
    expect(draw().some(p => p.op === "stroke" && p.strokeStyle === "#bf96ff" && p.path.some(q => q.op === "arc" && q.args[2] === 18))).toBe(false);
    snapshot.pickups[0]!.x = 151; expect(draw().some(p => p.op === "drawImage" && p.args[1] === 103)).toBe(false);
    snapshot.pickups[0]!.x = 152; expect(draw().some(p => p.op === "drawImage" && p.args[1] === 104)).toBe(true);
    expect(c.depth).toBe(0);
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});
