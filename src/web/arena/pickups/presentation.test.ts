import { expect, test } from "bun:test";
import { createPickupDraws, pickupAlpha, effectRemaining } from "./registry";
import { Interpolation } from "../interpolation";
import type { Snapshot } from "../../../shared/arena/protocol";
import { ArenaRenderer } from "../draw";
import { ArenaInput } from "../input";
import { lifeDefaults } from "../../../shared/arena/types";
import type { Gradient, Paint } from "../../test-support/canvas-fixture.test-support";
import { PLAYER_RADIUS } from "../../../shared/arena/constants";
import type { PickupKind } from "../../../shared/arena/types";
import { PICKUPS } from "../../../shared/arena/pickups/registry";
import { canvasFixture } from "../../test-support/canvas-fixture.test-support";
test("floor pickups share delayed combat birth/removal, while blink and HUD obey exact deadlines", () => {
  const snapshot = (tick: number, visible: boolean): Snapshot => ({ globs: [], v: 1, type: "snapshot", arenaId: "test", tick, wave: 1, players: [], bugs: [], shots: [], events: [],
    pickups: visible ? [{ id: 1, kind: "shield", x: 500, y: 500, expiresAt: 12500 }] : [] });
  const i = new Interpolation(); i.push(snapshot(9, false), 450); i.push(snapshot(10, true), 500); i.push(snapshot(11, false), 550);
  expect(i.combat(599).pickups).toEqual([]); expect(i.combat(600).pickups).toHaveLength(1);
  expect(i.combat(649).pickups).toHaveLength(1); expect(i.combat(650).pickups).toEqual([]);
  expect(pickupAlpha(3001)).toBe(1); expect(pickupAlpha(3000)).toBe(0.25); expect(pickupAlpha(2999)).toBe(1);
  expect(pickupAlpha(250)).toBe(1); expect(pickupAlpha(249)).toBe(0.25); expect(pickupAlpha(0)).toBe(0);
  expect(effectRemaining(20000, 0, 20000)).toBe(1); expect(effectRemaining(20000, 10000, 20000)).toBe(0.5);
  expect(effectRemaining(30000, 10000, 20000)).toBe(1); expect(effectRemaining(20000, 20000, 20000)).toBe(0);
});
test.each(["shield", "spread", "rapid"] as const)("%s paints floor and HUD glyphs, caches its glow, culls correctly and shows authoritative timers", kind => {
  const f = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => f.factory() } });
  try {
    const c = f.context, renderer = new ArenaRenderer(c as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const p = { ...lifeDefaults(), id: "a", name: "Pilot", team: "tabs" as const, x: 300, y: 300, vx: 0, vy: 0, facing: 0.7, ackSeq: 0 };
    const deadline = 10000 + PICKUPS[kind].duration / 2;
    const remote = { ...p, id: "b", x: 500, effects: { [kind]: deadline } };
    const snapshot: Snapshot = { globs: [], v: 1, type: "snapshot", arenaId: "test", tick: 200, wave: 1, players: [{ ...p, effects: { [kind]: deadline } }, remote], bugs: [], shots: [], events: [],
      pickups: [{ id: 1, kind, x: 500, y: 400, expiresAt: 12000 }] };
    const draw = (remaining = 2000) => { c.paints.length = 0; renderer.draw(390, 844, { x: 200, y: 200 }, [p, remote], p, input, [], [], 1, 200, 10000, 1, snapshot, 12000 - remaining, [], snapshot.pickups); return [...c.paints]; };
    const paint = draw(); const count = f.created; draw(); expect(f.created).toBe(count);
    const ring = paint.filter(p => p.op === "stroke" && p.path.some(q => q.op === "arc" && q.args[0] === 32 && q.args[1] === 70)).at(-1)!;
    expect(ring.path[0]!.args[4]! - ring.path[0]!.args[3]!).toBeCloseTo(Math.PI);
    expect(paint.some(p => glyphPaint(p, 500, 400))).toBe(true);
    expect(paint.some(p => glyphPaint(p, 32, 70))).toBe(true);
    const visible = draw(), effects = remote.effects;
    remote.effects = {};
    const bare = draw(); remote.effects = effects;
    robotPresentation(kind, addedPaints(visible, bare), { x: remote.x - 200, y: remote.y - 200, facing: remote.facing });
    expect(paint.some(p => p.op === "drawImage" && p.globalAlpha === 0.25)).toBe(true);
    expect(draw(1999).some(p => p.op === "drawImage" && p.globalAlpha === 0.25)).toBe(false);
    snapshot.players[0]!.effects[kind] = 10000 + PICKUPS[kind].duration;
    expect(draw().some(p => p.op === "stroke" && p.path.some(q => q.op === "arc" && q.args[0] === 32 && q.args[1] === 70 && Math.abs(q.args[4]! - q.args[3]! - Math.PI * 2) < 0.001))).toBe(true);
    snapshot.players[0]!.effects = {}; remote.effects = {};
    expect(draw().some(p => p.op === "stroke" && p.path.some(q => q.op === "arc" && q.args[0] === 32 && q.args[1] === 70))).toBe(false);
    snapshot.pickups[0]!.x = 151; expect(draw().some(p => p.op === "drawImage" && p.args[1] === 103)).toBe(false);
    snapshot.pickups[0]!.x = 152; expect(draw().some(p => p.op === "drawImage" && p.args[1] === 104)).toBe(true);
    expect(c.depth).toBe(0);
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});

test("each pickup paints a fading floor glow and shares its distinct colour with its HUD glyph", () => {
  const f = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => f.factory() } });
  try {
    const draws = createPickupDraws(), c = f.context, hues: number[] = [];
    for (const kind of ["shield", "spread", "rapid"] as const) {
      c.paints.length = 0; draws[kind].floor(c as unknown as CanvasRenderingContext2D, 0, 0);
      const floor = [...c.paints], image = floor.find(p => p.op === "drawImage")!;
      expect(image).toBeDefined(); expect(image.globalAlpha).toBeGreaterThan(0);
      // Inspect paint on the surface actually used by the floor, not just gradient creation.
      const glow = f.source(image).paints.find(p => p.op === "fillRect" && typeof p.fillStyle !== "string")!;
      expect(glow).toBeDefined(); expect(glow.globalAlpha).toBeGreaterThan(0);
      const gradient = glow.fillStyle as Gradient, [x, y, , , , radius] = gradient.circles;
      const [left, top, width, height] = glow.args as number[];
      expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0);
      expect(left! + width!).toBeGreaterThan(x); expect(top! + height!).toBeGreaterThan(y);
      expect(left).toBeLessThan(x); expect(top).toBeLessThan(y);
      expect(radius).toBeGreaterThan(gradient.circles[2]);
      const stops = [...gradient.stops].sort((a, b) => a.offset - b.offset);
      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(colour(stops[0]!.colour).alpha).toBeGreaterThan(colour(stops.at(-1)!.colour).alpha);
      c.paints.length = 0; draws[kind].hud(c as unknown as CanvasRenderingContext2D, 0, 0, 0.5);
      const accent = colour(c.paints.filter(p => p.op === "stroke").at(-1)!.strokeStyle as string);
      const glyph = floor.filter(p => p.op === "stroke" || p.op === "fill").at(-1)!;
      expect(hueGap(accent.hue, colour((glyph.op === "stroke" ? glyph.strokeStyle : glyph.fillStyle) as string).hue)).toBeLessThan(10);
      expect(hueGap(accent.hue, colour(stops[0]!.colour).hue)).toBeLessThan(10);
      // Shade changes are welcome; the kinds must remain visually different colours.
      for (const other of hues) expect(hueGap(accent.hue, other)).toBeGreaterThan(25);
      hues.push(accent.hue);
    }
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});

function addedPaints(visible: Paint[], bare: Paint[]) {
  const key = (p: Paint) => JSON.stringify([p.op, p.path, p.transform, p.globalAlpha, p.op === "fill" ? p.fillStyle : p.strokeStyle, p.lineWidth]);
  const counts = new Map<string, number>();
  for (const p of bare) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
  return visible.filter(p => {
    const k = key(p), count = counts.get(k) ?? 0;
    if (count) { counts.set(k, count - 1); return false; }
    return (p.op === "stroke" || p.op === "fill") && p.globalAlpha > 0;
  });
}

function point(p: Paint, x: number, y: number) {
  const [a, b, c, d, e, f] = p.transform as [number, number, number, number, number, number];
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}
function robotPresentation(kind: PickupKind, paints: Paint[], robot: { x: number; y: number; facing: number }) {
  const barrels = paints.filter(p => p.op === "stroke").flatMap(p => p.path.filter(q => q.op === "rect" || q.op === "roundRect")
    .filter(q => q.args[2]! > q.args[3]! * 1.5).map(q => {
      const centre = point(p, q.args[0]! + q.args[2]! / 2, q.args[1]! + q.args[3]! / 2);
      return Math.atan2(centre.y - robot.y, centre.x - robot.x);
    }));
  if (kind === "shield") {
    expect(barrels).toHaveLength(0);
    expect(paints.some(p => p.op === "stroke" && p.path.some(q => {
      if (q.op !== "arc") return false;
      const centre = point(p, q.args[0]!, q.args[1]!);
      return Math.hypot(centre.x - robot.x, centre.y - robot.y) < q.args[2]! / 10 &&
        q.args[2]! > PLAYER_RADIUS && q.args[4]! - q.args[3]! >= Math.PI * 2 - 0.001;
    }))).toBe(true);
  } else if (kind === "spread") {
    expect(barrels).toHaveLength(3);
    const angles = barrels.map(a => Math.atan2(Math.sin(a - robot.facing), Math.cos(a - robot.facing))).sort((a, b) => a - b);
    expect(angles[0]).toBeLessThan(-0.05); expect(angles[2]).toBeGreaterThan(0.05);
    expect(Math.abs(angles[1]!)).toBeLessThan(0.05);
  } else {
    expect(barrels).toHaveLength(1);
    const vents = paints.filter(p => p.op === "stroke").flatMap(p => p.path.flatMap((q, i) => {
      const previous = p.path[i - 1]; if (q.op !== "lineTo" || previous?.op !== "moveTo") return [];
      const a = point(p, previous.args[0]!, previous.args[1]!), b = point(p, q.args[0]!, q.args[1]!);
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const forward = ((a.x + b.x) / 2 - robot.x) * Math.cos(robot.facing) + ((a.y + b.y) / 2 - robot.y) * Math.sin(robot.facing);
      return forward > 0 && length > 0 && Math.abs(dx * Math.cos(robot.facing) + dy * Math.sin(robot.facing)) < length / 3 ? [p.strokeStyle] : [];
    }));
    expect(vents.length).toBeGreaterThanOrEqual(2);
    const outline = paints.find(p => p.op === "stroke" && p.path.some(q => q.op === "roundRect" || q.op === "rect"))!;
    expect(vents.some(style => style !== outline.strokeStyle)).toBe(true);
  }
}

function colour(value: string) {
  const hex = value.slice(1), rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb as [number, number, number], max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  expect(delta).toBeGreaterThan(0); // A grey substitute cannot distinguish the pickup kinds.
  const hue = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
  return { hue, alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
}
function hueGap(a: number, b: number) { return Math.abs(((a - b + 540) % 360) - 180); }

function glyphPaint(p: Paint, x: number, y: number) {
  return (p.op === "stroke" || p.op === "fill") && p.path.length > 0 && p.path.every(q => {
    const dx = q.args[0]! - x, dy = q.args[1]! - y;
    return Math.hypot(dx, dy) + (q.op === "arc" ? q.args[2]! : 0) <= 16;
  });
}
