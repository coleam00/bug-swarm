import { expect, test } from "bun:test";
import { ArenaRenderer } from "./draw";
import { ArenaInput } from "./input";
import { canvasFixture } from "../test-support/canvas-fixture.test-support";
import { TEAM_COLOURS } from "../../shared/teams";
import { validateName } from "../../server/rules";
import { PLAYER_RADIUS, HEAT_CAPACITY } from "../../shared/arena/constants";
import { lifeDefaults, type CombatPlayer } from "../../shared/arena/types";
import { cameraFor } from "./camera";
import { worldView } from "../../shared/arena/view";
import type { Paint } from "../test-support/canvas-fixture.test-support";
import { createBug } from "../../shared/arena/bugs/registry";
import type { Snapshot } from "../../shared/arena/protocol";
import { Interpolation } from "./interpolation";

test("beetle plate follows facing, each lost HP cracks once, and pale bounces leave cracks unchanged without a score", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), b = createBug("beetle", 1, 500, 500);
    b.facing = Math.PI / 2;
    const draw = (now = 0) => { fixture.context.paints.length = 0; renderer.draw(800, 600, { x: 100, y: 100 }, [], null, new ArenaInput(), [b], [], 5, 0, now); return [...fixture.context.paints]; };
    const shapeKey = (p: Paint) => JSON.stringify([p.path, p.transform]);
    const effectiveAlpha = (p: Paint) => {
      const style = p.op === "fill" ? p.fillStyle : p.strokeStyle;
      const rgba = typeof style === "string" ? Bun.color(style, "[rgba]") : null;
      expect(rgba).not.toBeNull(); // Parse CSS color alpha too; never assume an unknown paint is opaque.
      return p.globalAlpha * rgba![3] / 255;
    };
    const intact = draw();
    const body = intact.find(p => p.op === "fill" && p.path.some(q => q.op === "ellipse"))!;
    const plate = intact.find(p => p.op === "fill" && p.path.some(q => q.op === "arc" && q.args[4]! - q.args[3]! < Math.PI))!;
    expect(body).toBeDefined(); expect(plate).toBeDefined();
    const ellipse = body.path.find(p => p.op === "ellipse")!;
    const xScale = Math.hypot(body.transform[0]!, body.transform[1]!), yScale = Math.hypot(body.transform[2]!, body.transform[3]!);
    expect(2 * ellipse.args[2]! * xScale).toBeGreaterThanOrEqual(44);
    expect(2 * ellipse.args[3]! * yScale).toBeGreaterThanOrEqual(36);
    expect(Math.atan2(plate.transform[1]!, plate.transform[0]!)).toBeCloseTo(b.facing);
    const arc = plate.path.find(p => p.op === "arc")!;
    expect(arc.args[2]! * Math.min(Math.hypot(plate.transform[0]!, plate.transform[1]!), Math.hypot(plate.transform[2]!, plate.transform[3]!))).toBeGreaterThanOrEqual(20);
    expect(arc.args[3]).toBeCloseTo(-Math.PI / 3); expect(arc.args[4]).toBeCloseTo(Math.PI / 3);
    const rim = intact.find(p => p.op === "stroke" && shapeKey(p) === shapeKey(plate))!;
    expect(rim).toBeDefined();
    expect(effectiveAlpha(body)).toBeGreaterThan(0.5);
    expect(effectiveAlpha(plate)).toBeGreaterThan(0.5); expect(effectiveAlpha(rim)).toBeGreaterThan(0.5);
    expect(plate.fillStyle).not.toEqual(body.fillStyle); expect(plate.strokeStyle).not.toEqual(body.strokeStyle);
    const onBody = (p: Paint) => p.op === "stroke" && p.transform.every((value, i) => value === body.transform[i]);
    const intactPaths = new Set(intact.filter(onBody).map(p => JSON.stringify(p.path)));
    const cracks = (paints: Paint[]) => paints.filter(p => onBody(p) && !intactPaths.has(JSON.stringify(p.path)));
    for (let hp = 5; hp >= 1; hp--) {
      b.hp = hp; const damaged = cracks(draw()); expect(damaged).toHaveLength(5 - hp);
      for (const crack of damaged) expect(effectiveAlpha(crack)).toBeGreaterThan(0.5);
    }
    const baseline = new Set(draw().filter(p => p.op === "stroke").map(shapeKey));
    const effects = (paints: Paint[]) => paints.filter(p => p.op === "stroke" && !baseline.has(shapeKey(p)));
    const cached = fixture.created, event = { id: 2, tick: 1, kind: "beetle" as const, type: "bounce" as const, x: 500, y: 522, points: 0 as const };
    renderer.events([event], 0); const spark = draw(50), bounce = effects(spark);
    expect(cracks(spark)).toHaveLength(4); expect(bounce).toHaveLength(1); expect(effectiveAlpha(bounce[0]!)).toBeGreaterThan(0.5);
    expect(spark.some(p => p.op === "fillText" && String(p.args[0]).startsWith("+"))).toBe(false);
    renderer.events([event], 170); expect(effects(draw(181))).toHaveLength(0);
    expect(fixture.created).toBe(cached); renderer.reset(); expect(effects(draw())).toHaveLength(0);
    renderer.events([{ ...event, type: "hit" }], 0);
    expect(effects(draw(50))[0]!.strokeStyle).not.toEqual(bounce[0]!.strokeStyle);

  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});

test("bounce, HP cracks, facing and removal stay on the delayed combat clock and reset without replay", () => {
  const view = new Interpolation(), b = createBug("beetle", 1, 500, 500);
  const shot = { id: 2, owner: "a", life: 1, x: 550, y: 500, vx: -900, vy: 0, born: 0 };
  const s: Snapshot = { pickups: [], v: 1, type: "snapshot", arenaId: "room", tick: 1, wave: 5, players: [], bugs: [b], shots: [shot], globs: [], events: [] };
  view.push(structuredClone(s), 0);
  s.tick = 2; s.shots = []; s.events = [{ id: 3, tick: 2, kind: "beetle", type: "bounce", x: 522, y: 500, points: 0 }];
  view.push(structuredClone(s), 50);
  expect(view.combat(149).shots).toHaveLength(1); expect(view.combat(149).events).toHaveLength(0);
  const bounce = view.combat(150); expect(bounce.shots).toHaveLength(0); expect(bounce.bugs[0]!.hp).toBe(5); expect(bounce.events[0]!.type).toBe("bounce");
  expect(view.combat(150).events).toHaveLength(0);
  s.tick = 3; b.hp = 4; b.facing = 0.1; s.events = [{ id: 4, tick: 3, kind: "beetle", type: "hit", x: 500, y: 500, points: 0 }]; view.push(structuredClone(s), 100);
  expect(view.combat(199).bugs[0]).toMatchObject({ hp: 5, facing: 0 });
  expect(view.combat(200).bugs[0]).toMatchObject({ hp: 4, facing: 0.1 });
  s.tick = 4; s.bugs = []; s.events = [{ id: 5, tick: 4, kind: "beetle", type: "kill", x: 500, y: 500, points: 90 }]; view.push(structuredClone(s), 150);
  expect(view.combat(249).bugs).toHaveLength(1); expect(view.combat(250).bugs).toHaveLength(0);
  view.clear(); expect(view.combat(1000).events).toHaveLength(0); view.push(s, 1000); expect(view.combat(1100).events[0]!.type).toBe("kill");
});

test("spitter swells on the combat clock; green globs have a larger core, cached glow, trail and distinct +5", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), b = createBug("spitter", 1, 500, 500), input = new ArenaInput();
    Object.assign(b, { phase: "swell", phaseUntil: 2200 });
    const glob = { id: 2, x: 600, y: 500, vx: 320, vy: 0, born: 0 };
    const draw = (time: number) => { fixture.context.paints.length = 0; renderer.draw(800, 600, { x: 100, y: 100 }, [], null, input, [b], [], 4, 100, 0, 1, undefined, time, [glob]); return [...fixture.context.paints]; };
    const early = draw(1700), late = draw(2150);
    const radius = (p: Paint[]) => p.find(p => p.op === "fill" && p.fillStyle === "#aaff38" && p.path.some(q => q.op === "ellipse"))!.path.find(q => q.op === "ellipse")!.args[2]!;
    expect(radius(late)).toBeGreaterThan(radius(early));
    expect(late.some(p => p.op === "fill" && p.path.some(q => q.op === "arc" && q.args[2] === 9))).toBe(true);
    const trail = late.find(p => p.op === "stroke" && p.strokeStyle === "#8dff3866")!;
    expect(trail).toBeDefined(); expect(trail.lineWidth).toBeGreaterThan(0);
    const start = trail.path.find(p => p.op === "moveTo")!.args, end = trail.path.find(p => p.op === "lineTo")!.args;
    expect(Math.hypot(end[0]! - start[0]!, end[1]! - start[1]!)).toBeGreaterThan(0);
    const glow = late.find(p => p.op === "drawImage" &&
      Number(p.args[1]) < glob.x && Number(p.args[1]) + (p.args[0] as HTMLCanvasElement).width > glob.x &&
      Number(p.args[2]) < glob.y && Number(p.args[2]) + (p.args[0] as HTMLCanvasElement).height > glob.y)!;
    expect(glow).toBeDefined(); expect(glow.globalAlpha).toBeGreaterThan(0);
    expect(fixture.source(glow).paints.some(p => p.op === "fillRect" && typeof p.fillStyle !== "string" &&
      p.fillStyle.stops.some(s => s.colour.length === 9 && Number.parseInt(s.colour.slice(-2), 16) > 0) &&
      p.fillStyle.stops.some(s => s.offset === 1 && s.colour.endsWith("00")))).toBe(true);
    const cached = fixture.created; draw(2150); expect(fixture.created).toBe(cached);
    renderer.events([{ id: 4, tick: 100, x: 600, y: 500, type: "glob-pop", points: 5 }], 0);
    expect(draw(2150).some(p => p.op === "fillText" && p.args[0] === "+5" && p.fillStyle === "#d8ff80")).toBe(true);
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});

test("kind dispatch paints a crouched hot tell along locked facing, keeps offscreen warnings, and sparks without score", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), b = createBug("dasher", 1, 500, 500), input = new ArenaInput();
    const draw = () => { fixture.context.paints.length = 0; renderer.draw(800, 600, { x: 100, y: 100 }, [], null, input, [b], [], 3, 0, 0, 1, undefined, 350); return [...fixture.context.paints]; };
    const ordinary = draw(); Object.assign(b, { phase: "windup", phaseUntil: 700, facing: Math.PI / 2 });
    const hot = draw(), warning = hot.find(p => p.op === "stroke" && p.path.some(q => q.op === "lineTo" && q.args[0]! > 200))!;
    expect(warning).toBeDefined(); expect(Math.atan2(warning.transform[1]!, warning.transform[0]!)).toBeCloseTo(Math.PI / 2);
    expect(hot.filter(p => p.op === "drawImage").length).toBeGreaterThan(ordinary.filter(p => p.op === "drawImage").length);
    const body = (paints: Paint[]) => paints.find(p => p.op === "fill" && p.path.length > 0 && p.transform[4] === b.x - 100 && p.transform[5] === b.y - 100)!;
    expect(Math.hypot(body(hot).transform[0]!, body(hot).transform[1]!)).toBeLessThan(Math.hypot(body(ordinary).transform[0]!, body(ordinary).transform[1]!));
    const cached = fixture.created; draw(); expect(fixture.created).toBe(cached);
    b.x = 50; b.facing = 0; expect(draw().some(p => p.op === "stroke" && p.path.some(q => q.op === "lineTo" && q.args[0]! > 200))).toBe(true);
    b.x = 2390; b.facing = 0;
    fixture.context.paints.length = 0; renderer.draw(800, 600, { x: 2000, y: 100 }, [], null, input, [b]);
    expect(fixture.context.paints.some(p => p.op === "stroke" && p.path.length === 2 && p.path[1]!.args[0] === 10)).toBe(true);
    renderer.events([{ id: 2, tick: 1, kind: "dasher", type: "hit", x: 500, y: 500, points: 0 }], 0);
    const spark = draw(); expect(spark.some(p => p.op === "stroke" && p.globalAlpha > 0 && p.path.some(q => q.op === "lineTo"))).toBe(true);
    expect(spark.some(p => p.op === "fillText" && String(p.args[0]).startsWith("+"))).toBe(false);
    renderer.reset(); expect(draw().some(p => p.op === "stroke" && p.globalAlpha > 0 && p.path.some(q => q.op === "lineTo"))).toBe(false);
    const crawler = createBug("crawler", 3, 500, 500); fixture.context.paints.length = 0;
    renderer.draw(800, 600, { x: 100, y: 100 }, [], null, input, [crawler]);
    expect(fixture.context.paints.some(p => p.path.some(q => q.op === "ellipse"))).toBe(true);
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});

test("one HUD baseline uses authoritative combat and connected population, fitting large scores on phones", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const c = fixture.context;
    c.measureText = text => ({ width: text.length * Number.parseInt(c.font.replace("bold ", "")) * 0.6 } as TextMetrics);
    const renderer = new ArenaRenderer(c as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const predicted = { ...lifeDefaults(), id: "local", name: "Pilot", team: "tabs" as const, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0 };
    const authoritative = { ...predicted, score: 123, streak: 7, hits: 2 };
    const players = Array.from({ length: 20 }, (_, i) => ({ ...authoritative, ackSeq: 0, id: i ? `remote-${i}` : "local", hits: i ? 0 : 2 }));
    const snapshot: Snapshot = { globs: [], v: 1, type: "snapshot", pickups: [], arenaId: "room", tick: 1, wave: 19, players, bugs: [], shots: [], events: [] };
    for (const [width, height] of [[1280, 720], [844, 390], [390, 844]]) for (const score of [123, Number.MAX_SAFE_INTEGER]) {
      players[0]!.score = score; c.paints.length = 0;
      // Interpolated membership is deliberately stale; connected dead players still count.
      renderer.draw(width!, height!, { x: 750, y: 750 }, [predicted], predicted, input, [], [], snapshot.wave, 1, 50, 1, snapshot);
      // No effects or overheat in this fixture: all main-canvas text belongs to the HUD.
      // Counting every text paint also catches persistent instructions outside that line.
      const hud = c.paints.filter(p => p.op === "fillText" || p.op === "strokeText");
      expect(hud).toHaveLength(1);
      expect(String(hud[0]!.args[0])).toMatch(/pts\s+×1\.7\s+2 hits\s+W19\s+20 in this arena$/);
      if (score === 123) expect(String(hud[0]!.args[0])).toStartWith("123 pts");
      c.font = hud[0]!.font;
      expect(Number(hud[0]!.args[1]) + c.measureText(String(hud[0]!.args[0])).width).toBeLessThanOrEqual(width! - 16);
      expect(hud[0]!.transform).toEqual([1, 0, 0, 1, 0, 0]);
    }
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});

test("renderer draws the minimap outline, faint swarm, both living teams and one predicted local marker", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const c = fixture.context, renderer = new ArenaRenderer(c as unknown as CanvasRenderingContext2D);
    const local = { ...lifeDefaults(), id: "local", name: "Pilot", team: "tabs" as const, x: 2400, y: 0, vx: 0, vy: 0, facing: 0 };
    const remote = { ...local, id: "remote", team: "spaces" as const, x: 1200, y: 1200 };
    const screenSpace = (paint: Paint) => paint.transform.every((value, i) => value === [1, 0, 0, 1, 0, 0][i]);
    for (const [width, height] of [[1280, 720], [844, 390], [390, 844]]) {
      c.paints.length = 0;
      renderer.draw(width!, height!, { x: 400, y: 500 },
        [{ ...local, x: 0 }, remote, { ...remote, id: "dead", hits: 0 }], local, new ArenaInput(),
        [{ id: 1, kind: "crawler", hp: 1, facing: 0, x: 600, y: 600, vx: 0, vy: 0 }], [], 1, 1, 50, 1.5);
      const outlines = c.paints.filter(p => p.op === "strokeRect" && screenSpace(p));
      expect(outlines).toHaveLength(1);
      const outline = outlines[0]!, [x, y, mapWidth, mapHeight] = outline.args as number[];
      expect(outline.globalAlpha).toBeGreaterThan(0); expect(outline.lineWidth).toBeGreaterThan(0);
      expect(x!).toBeGreaterThan(width! / 2); expect(y!).toBeGreaterThan(0);
      expect(mapWidth!).toBeGreaterThan(0); expect(mapHeight!).toBeCloseTo(mapWidth!);
      expect(mapWidth!).toBeLessThan(width! / 2); expect(mapHeight!).toBeLessThan(height! / 2);
      expect(x! + mapWidth!).toBeLessThan(width!); expect(y! + mapHeight!).toBeLessThan(height!);
      const markers = c.paints.filter(p => p.op === "fill" && screenSpace(p) && p.path.some(command => command.op === "arc"));
      expect(markers).toHaveLength(3); // Bug, living teammate, local; no dead or duplicate local marker.
      const [bug, teammate, own] = markers as [Paint, Paint, Paint];
      expect(teammate.fillStyle).toBe(TEAM_COLOURS.spaces); expect(own.fillStyle).toBe(TEAM_COLOURS.tabs);
      const alpha = bug.globalAlpha * (typeof bug.fillStyle === "string" && /^#[\da-f]{8}$/i.test(bug.fillStyle) ? Number.parseInt(bug.fillStyle.slice(-2), 16) / 255 : 1);
      expect(alpha).toBeGreaterThan(0); expect(alpha).toBeLessThan(0.5);
      const circle = (paint: Paint) => paint.path.find(command => command.op === "arc")!.args;
      expect(circle(bug)[0]).toBeCloseTo(x! + mapWidth! / 4); expect(circle(bug)[1]).toBeCloseTo(y! + mapHeight! / 4);
      expect(circle(teammate)[0]).toBeCloseTo(x! + mapWidth! / 2); expect(circle(teammate)[1]).toBeCloseTo(y! + mapHeight! / 2);
      const [ownX, ownY, radius] = circle(own) as [number, number, number];
      expect(radius).toBeGreaterThan(circle(teammate)[2]!);
      expect(ownX).toBeCloseTo(x! + mapWidth! - radius); expect(ownY).toBeCloseTo(y! + radius);
      const ring = c.paints.find(p => p.op === "stroke" && screenSpace(p) && JSON.stringify(p.path) === JSON.stringify(own.path));
      expect(ring).toBeDefined(); expect(ring!.strokeStyle).not.toBe(own.fillStyle);
      expect(ring!.globalAlpha).toBeGreaterThan(0); expect(ring!.lineWidth).toBeGreaterThan(0);
    }
  } finally { if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document"); }
});

test("downed robots remain visible with countdown/progress, local copy and remote edge Help; revival removes them", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const p = { ...lifeDefaults(), status: "downed" as const, hits: 0, downedUntil: 10000, reviveMs: 1000, reviving: true,
      id: "victim", name: "Victim", team: "tabs" as const, x: 200, y: 300, vx: 0, vy: 0, facing: 0 };
    const q = { ...p, id: "remote", name: "Teammate", team: "spaces" as const, x: 1200 };
    const draw = (local: CombatPlayer, remote: CombatPlayer[] = [q], now = 0, width = 390, height = 844) => {
      fixture.context.paints.length = 0;
      renderer.draw(width, height, { x: 0, y: 0 }, [local, ...remote], local, input, [], [], 1, 40, now);
      return [...fixture.context.paints];
    };
    const body = (paints: Paint[], target: Pick<CombatPlayer, "x" | "y"> = p) => paints.find(paint => paint.op === "stroke" && paint.path.some(c => c.op === "roundRect") &&
      paint.transform[4] === target.x && paint.transform[5] === target.y)!;
    const marker = (paints: Paint[], target: Pick<CombatPlayer, "x" | "y"> = p) => paints.find(paint => paint.op === "fillText" && paint.args[1] === target.x && Number(paint.args[2]) > target.y)!;
    const ringsAt = (paints: Paint[], target: Pick<CombatPlayer, "x" | "y"> = p) => paints.filter(paint => paint.op === "stroke").flatMap(paint =>
      paint.path.filter(c => c.op === "arc" && c.args[0] === target.x && c.args[1] === target.y && c.args[2]! > PLAYER_RADIUS + 8));
    const aspect = (paint: Paint) => {
      const [a, b, c, d] = paint.transform as [number, number, number, number];
      const x = Math.hypot(a, b), y = Math.hypot(c, d); return Math.min(x, y) / Math.max(x, y);
    };
    const arrows = (paints: Paint[]) => paints.filter(paint => paint.op === "fill" && paint.path[0]?.op === "moveTo" && paint.path.some(c => c.op === "lineTo"));
    const overlay = (paints: Paint[], width = 390) => paints.find(paint => paint.op === "fillRect" && Number(paint.args[2]) > width / 2 &&
      Number(paint.args[1]) > 78 && Number(paint.args[1]) + Number(paint.args[3]) < p.y);
    // Require the explanation separately from the countdown in both banner
    // layouts, without pinning the wording of either explanation line.
    for (const [width, height, lines] of [[390, 844, 2], [844, 390, 1]] as const) {
      const frame = draw(p, [], 0, width, height), panel = overlay(frame, width);
      expect(panel).toBeDefined();
      const text = frame.filter(paint => paint.op === "fillText" && Number(paint.args[1]) > Number(panel!.args[0]) &&
        Number(paint.args[1]) < Number(panel!.args[0]) + Number(panel!.args[2]) &&
        Number(paint.args[2]) > Number(panel!.args[1]) && Number(paint.args[2]) < Number(panel!.args[1]) + Number(panel!.args[3]));
      const explanation = text.filter(paint => /\p{L}{2,}/u.test(String(paint.args[0])));
      expect(explanation).toHaveLength(lines);
      expect(text.filter(paint => paint.args[0] === "8s")).toHaveLength(1);
      for (const paint of text) {
        expect(paint.globalAlpha).toBeGreaterThan(0);
        expect(paint.transform).toEqual([1, 0, 0, 1, 0, 0]);
        expect(Number(paint.args[2])).toBeLessThan(height);
      }
    }
    const paints = draw(p);
    const rings = paints.filter(p => p.op === "stroke").flatMap(p => p.path.filter(c => c.op === "arc"));
    expect(rings.some(c => Math.abs(Number(c.args[4]) - Number(c.args[3]) - Math.PI) < 1e-8)).toBe(true);
    expect(rings.some(c => Math.abs(Number(c.args[4]) - Number(c.args[3]) - Math.PI * 1.6) < 1e-8)).toBe(true);
    const fills: number[] = [];
    for (const progress of [400, 1600]) {
      p.reviveMs = progress;
      const meter = ringsAt(draw(p)).filter(c => c.args[2] === PLAYER_RADIUS + 19);
      expect(meter).toHaveLength(1);
      const fill = (meter[0]!.args[4]! - meter[0]!.args[3]!) / (Math.PI * 2);
      expect(fill).toBeCloseTo(progress === 400 ? 0.2 : 0.8);
      fills.push(fill);
    }
    expect(fills[1]).toBeGreaterThan(fills[0]!); p.reviveMs = 1000;
    const markerAlphas: number[] = [], arrowAlphas: number[] = [];
    for (const now of [0, 180, 360, 540]) {
      const frame = draw(p, [q], now), help = marker(frame), edge = arrows(frame);
      expect(help).toBeDefined(); expect(edge).toHaveLength(1);
      for (const alpha of [help.globalAlpha, edge[0]!.globalAlpha]) { expect(alpha).toBeGreaterThan(0); expect(alpha).toBeLessThanOrEqual(1); }
      markerAlphas.push(help.globalAlpha); arrowAlphas.push(edge[0]!.globalAlpha);
    }
    expect(Math.max(...markerAlphas) - Math.min(...markerAlphas)).toBeGreaterThan(0.1);
    expect(Math.max(...arrowAlphas) - Math.min(...arrowAlphas)).toBeGreaterThan(0.1);
    for (const position of [{ x: 1200, y: 300 }, { x: 200, y: -1000 }, { x: 200, y: 1844 }]) {
      const edge = arrows(draw(p, [{ ...q, ...position }])); expect(edge).toHaveLength(1);
      expect(edge[0]!.transform[4]).toBeGreaterThanOrEqual(32); expect(edge[0]!.transform[4]).toBeLessThanOrEqual(358);
      expect(edge[0]!.transform[5]).toBeGreaterThanOrEqual(112); expect(edge[0]!.transform[5]).toBeLessThanOrEqual(804);
      if (position.x > 390) expect(edge[0]!.transform[0]).toBeGreaterThan(0);
      if (position.y < 0) expect(edge[0]!.transform[1]).toBeLessThan(0);
      if (position.y > 844) expect(edge[0]!.transform[1]).toBeGreaterThan(0);
    }
    const revived = { ...p, status: "active" as const, hits: 1, downedUntil: 0, reviveMs: 0, reviving: false };
    const active = draw(revived, []), fallenBody = body(paints), activeBody = body(active);
    expect(aspect(fallenBody)).toBeLessThan(aspect(activeBody) * 0.75);
    expect(fallenBody.globalAlpha).toBeGreaterThan(0); expect(fallenBody.globalAlpha).toBeLessThan(activeBody.globalAlpha);
    expect(overlay(active)).toBeUndefined(); expect(marker(active)).toBeUndefined(); expect(arrows(active)).toHaveLength(0);
    // The rescuer's on-screen view needs the same feedback as the victim's.
    const teammate = { ...q, x: 280 }, teammateAlphas: number[] = [];
    for (const now of [0, 180, 360, 540]) {
      const frame = draw(revived, [teammate], now), fallen = body(frame, teammate), help = marker(frame, teammate);
      expect(fallen).toBeDefined(); expect(help).toBeDefined();
      expect(aspect(fallen)).toBeLessThan(aspect(activeBody) * 0.75);
      expect(fallen.globalAlpha).toBeGreaterThan(0); expect(fallen.globalAlpha).toBeLessThan(activeBody.globalAlpha);
      const rings = ringsAt(frame, teammate); expect(rings).toHaveLength(2);
      const spans = rings.map(c => c.args[4]! - c.args[3]!);
      expect(spans.some(span => Math.abs(span - Math.PI) < 1e-8)).toBe(true);
      expect(spans.some(span => Math.abs(span - Math.PI * 1.6) < 1e-8)).toBe(true);
      expect(help.globalAlpha).toBeGreaterThan(0); expect(help.globalAlpha).toBeLessThanOrEqual(1);
      teammateAlphas.push(help.globalAlpha); expect(arrows(frame)).toHaveLength(0); expect(overlay(frame)).toBeUndefined();
    }
    expect(Math.max(...teammateAlphas) - Math.min(...teammateAlphas)).toBeGreaterThan(0.1);
    const teammateRevived = { ...teammate, status: "active" as const, hits: 1, downedUntil: 0, reviveMs: 0, reviving: false };
    const afterRescue = draw(revived, [teammateRevived]);
    expect(aspect(body(afterRescue, teammate))).toBeCloseTo(aspect(activeBody));
    expect(body(afterRescue, teammate).globalAlpha).toBe(activeBody.globalAlpha);
    expect(marker(afterRescue, teammate)).toBeUndefined(); expect(ringsAt(afterRescue, teammate)).toHaveLength(0);
    expect(arrows(afterRescue)).toHaveLength(0);
    fixture.context.paints.length = 0;
    const out = { ...p, status: "out" as const };
    renderer.draw(390, 844, { x: 0, y: 0 }, [out], null, input);
    expect(fixture.context.paints.some(p => p.op === "drawImage")).toBe(false);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("portrait north-wall countdown glyph bounds stay clear of the complete name", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  // Font-sensitive glyph metrics, including ascent/descent: a panel rectangle
  // alone cannot detect text painted outside it or with an inherited large font.
  const metrics = function(this: typeof fixture.context, text: string): TextMetrics {
    const size = Number.parseFloat(this.font.match(/[\d.]+px/)![0]), width = text.length * size * 0.6;
    return { width, actualBoundingBoxLeft: this.textAlign === "center" ? width / 2 : 0,
      actualBoundingBoxRight: this.textAlign === "center" ? width / 2 : width,
      actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 } as TextMetrics;
  };
  fixture.context.measureText = metrics;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
    const canvas = fixture.factory(); fixture.surfaces.at(-1)!.context.measureText = metrics; return canvas;
  } } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D);
    const p = { ...lifeDefaults(), id: "local", name: "WideWWWWWWWWWWWW", team: "tabs" as const,
      x: 1200, y: 14, vx: 0, vy: 0, facing: 0, status: "downed" as const, hits: 0, downedUntil: 10000, reviveMs: 400, spawnProtectedUntil: 0 };
    const view = worldView(390, 844);
    renderer.draw(390, 844, cameraFor(p.x, p.y, view.width, view.height), [p], p, new ArenaInput(), [], [], 1, 40, 0, view.scale);
    const paints = fixture.context.paints;
    const countdown = paints.find(p => p.op === "fillText" && /^\d+s$/.test(String(p.args[0])))!;
    const name = paints.find(p => p.op === "drawImage" && fixture.source(p).paints.some(q => q.op === "strokeText" && q.args[0] === "WideWWWWWWWWWWWW"))!;
    expect(countdown).toBeDefined(); expect(name).toBeDefined();
    const glyphs = (context: typeof fixture.context, paint: Paint, outer = paint, offsetX = 0, offsetY = 0) => {
      context.save(); context.font = paint.font; context.textAlign = paint.textAlign;
      const m = context.measureText(String(paint.args[0])); context.restore();
      const padding = paint.op === "strokeText" ? paint.lineWidth / 2 : 0;
      const x = offsetX + Number(paint.args[1]) - m.actualBoundingBoxLeft - padding;
      const y = offsetY + Number(paint.args[2]) - m.actualBoundingBoxAscent - padding;
      const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight + padding * 2;
      const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + padding * 2;
      const [a,b,c,d,e,f] = outer.transform as [number,number,number,number,number,number];
      const corners = [[x,y],[x+w,y],[x,y+h],[x+w,y+h]];
      const xs = corners.map(([x,y]) => a*x!+c*y!+e), ys = corners.map(([x,y]) => b*x!+d*y!+f);
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    };
    const source = fixture.source(name), label = source.paints.find(p => p.op === "strokeText")!;
    const n = glyphs(source, label, name, Number(name.args[1]), Number(name.args[2]));
    const count = glyphs(fixture.context, countdown);
    expect(count.left).toBeGreaterThanOrEqual(0); expect(count.right).toBeLessThanOrEqual(390);
    expect(count.top).toBeGreaterThanOrEqual(0); expect(count.bottom).toBeLessThanOrEqual(844);
    expect(count.right <= n.left || count.left >= n.right || count.bottom <= n.top || count.top >= n.bottom).toBe(true);
    const map = paints.find(p => p.op === "fillRect" && p.args[2] === 96 && p.args[3] === 96)!;
    expect(map).toBeDefined();
    // The compact HUD's corner map must not paint over the long name either.
    expect(paints.indexOf(name)).toBeGreaterThan(paints.indexOf(map));
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("downed message leaves the complete name, rescue rings and Help clear at viewport boundaries", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const p = { ...lifeDefaults(), id: "local", name: "WideWWWWWWWWWWWW", team: "tabs" as const, x: 1200, y: 14,
      vx: 0, vy: 0, facing: 0, status: "downed" as const, hits: 0, spawnProtectedUntil: 0, downedUntil: 10000, reviveMs: 50, reviving: true };
    const rect = (paint: Paint, x: number, y: number, width: number, height: number) => {
      const [a, b, c, d, e, f] = paint.transform as [number, number, number, number, number, number];
      const xs = [a * x + c * y + e, a * (x + width) + c * y + e, a * x + c * (y + height) + e, a * (x + width) + c * (y + height) + e];
      const ys = [b * x + d * y + f, b * (x + width) + d * y + f, b * x + d * (y + height) + f, b * (x + width) + d * (y + height) + f];
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    };
    for (const [width, height] of [[390, 844], [844, 390], [1280, 800]]) {
      const view = worldView(width!, height!);
      for (const [x, y] of [[1200, 14], [14, 14], [2386, 14], [2386, 1200], [2386, 2386], [1200, 2386], [14, 2386], [14, 1200], [1200, 1200]]) for (const progress of [50, 1000, 1950]) {
        Object.assign(p, { x, y, reviveMs: progress }); fixture.context.paints.length = 0;
        renderer.draw(width!, height!, cameraFor(x!, y!, view.width, view.height), [p], p, input, [], [], 1, 40, 0, view.scale);
        const paints = fixture.context.paints;
        const panels = paints.filter(paint => paint.op === "fillRect" && paint.transform[0] === 1 && paint.transform[4] === 0 &&
          Number(paint.args[2]) > 200 && Number(paint.args[3]) >= 30 && Number(paint.args[3]) < 100);
        expect(panels).toHaveLength(2);
        const occupied = panels.map(paint => rect(paint, ...paint.args.map(Number) as [number, number, number, number]));
        const name = paints.find(paint => paint.op === "drawImage" && fixture.source(paint).paints.some(p => p.op === "fillText"))!;
        expect(name).toBeDefined();
        const image = name.args[0] as HTMLCanvasElement;
        const feedback = [rect(name, Number(name.args[1]), Number(name.args[2]), image.width, image.height)];
        const rings = paints.filter(paint => paint.op === "stroke" && paint.path.some(c => c.op === "arc" && c.args[0] === x && c.args[1] === y && c.args[2]! > PLAYER_RADIUS + 8));
        expect(rings).toHaveLength(2);
        for (const paint of rings) {
          const arc = paint.path.find(c => c.op === "arc")!, radius = arc.args[2]! + paint.lineWidth / 2;
          // Reserve the whole circle even for the very first progress segment.
          feedback.push(rect(paint, x! - radius, y! - radius, radius * 2, radius * 2));
        }
        const help = paints.find(paint => paint.op === "fillText" && paint.args[1] === x && Number(paint.args[2]) > y!)!;
        expect(help).toBeDefined();
        const textWidth = fixture.context.measureText(String(help.args[0])).width;
        feedback.push(rect(help, x! - textWidth / 2, Number(help.args[2]) - 18, textWidth, 24));
        for (const bounds of [...occupied, ...feedback]) {
          expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(width!);
          expect(bounds.top).toBeGreaterThanOrEqual(0); expect(bounds.bottom).toBeLessThanOrEqual(height!);
        }
        for (const bounds of feedback) for (const panel of occupied)
          expect(bounds.right <= panel.left || bounds.left >= panel.right || bounds.bottom <= panel.top || bounds.top >= panel.bottom).toBe(true);
      }
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});

test("spawn shimmer animates on both robots, expires independently of damage flash, and scales only world drawing", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const local = { ...lifeDefaults(), id: "local", name: "Pilot", team: "tabs" as const, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0 };
    const remote = { ...local, id: "remote", x: 1300 };
    input.down(1, 80, 400, 1280);
    const draw = (tick: number) => {
      fixture.context.paints.length = 0;
      renderer.draw(1280, 800, { x: 750, y: 918.75 }, [local, remote], local, input, [], [], 17, tick, tick * 50, 1280 / 900);
      return [...fixture.context.paints];
    };
    const protection = (tick: number) => {
      const protectedPaints = draw(tick), timers = [local.spawnProtectedUntil, remote.spawnProtectedUntil];
      local.spawnProtectedUntil = remote.spawnProtectedUntil = 0;
      const ordinary = draw(tick);
      [local.spawnProtectedUntil, remote.spawnProtectedUntil] = timers as [number, number];
      const geometry = (paint: Paint) => JSON.stringify([paint.op, paint.path, paint.transform]);
      return protectedPaints.filter(p => (p.op === "stroke" || p.op === "fill") && p.path.length && !ordinary.some(q => geometry(p) === geometry(q)));
    };
    const surrounds = (paints: Paint[], robots: typeof local[]) => {
      const seen = new Set<string>(), scale = 1280 / 900;
      expect(paints.length).toBeGreaterThan(0);
      for (const paint of paints) for (const arc of paint.path.filter(c => c.op === "arc")) {
        const [x, y, radius] = arc.args as [number, number, number], [a, b, c, d, e, f] = paint.transform as [number, number, number, number, number, number];
        const cx = a * x + c * y + e, cy = b * x + d * y + f;
        const robot = robots.find(p => Math.abs(cx - (p.x - 750) * scale) < 1e-6 && Math.abs(cy - (p.y - 918.75) * scale) < 1e-6);
        expect(robot).toBeDefined(); seen.add(robot!.id);
        expect(radius).toBeGreaterThan(PLAYER_RADIUS); expect(paint.globalAlpha).toBeGreaterThan(0);
        const rx = radius * Math.hypot(a, c), ry = radius * Math.hypot(b, d);
        expect(cx - rx).toBeGreaterThanOrEqual(0); expect(cx + rx).toBeLessThanOrEqual(1280);
        expect(cy - ry).toBeGreaterThanOrEqual(0); expect(cy + ry).toBeLessThanOrEqual(800);
        expect(a).toBeCloseTo(scale); expect(d).toBeCloseTo(scale);
      }
      expect([...seen].sort()).toEqual(robots.map(p => p.id).sort());
    };
    const first = draw(0), opening = protection(0), next = protection(10);
    surrounds(opening, [local, remote]); surrounds(next, [local, remote]);
    expect(opening.map(p => p.path)).not.toEqual(next.map(p => p.path));
    const hud = first.find(p => p.op === "fillText" && String(p.args[0]).includes(" pts"))!;
    expect(hud.transform).toEqual([1, 0, 0, 1, 0, 0]);
    const stick = first.find(p => p.op === "stroke" && p.path.some(c => c.op === "arc" && c.args[2] === 60))!;
    expect(stick.transform).toEqual([1, 0, 0, 1, 0, 0]);
    surrounds(protection(39), [local, remote]); expect(protection(40)).toHaveLength(0);
    local.spawnProtectedUntil = 0; remote.immuneUntil = 1000;
    surrounds(protection(2), [remote]);
    const afterFire = draw(2);
    expect(afterFire.some(p => p.path.some(c => c.op === "roundRect") && p.globalAlpha === 0.4)).toBe(true);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});


test("renderer paints a grid, a distinguishing local ring, remote robots and complete names", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D);
    const local = { id: "local", name: "WideWWWWWWWWWWWW", team: "tabs" as const, x: 500, y: 500, vx: 0, vy: 0, facing: Math.PI / 3 };
    const remote = { ...local, id: "remote", team: "spaces" as const, x: 600, y: 400, facing: -Math.PI / 4 };
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
      const barrel = fixture.context.paints.find(p => p.op === "fillRect" && p.fillStyle === TEAM_COLOURS[player.team] &&
        Number(p.args[0]) > 0 && Number(p.args[1]) < 0 && Number(p.args[2]) > Number(p.args[3]) &&
        p.transform[4] === player.x - camera.x && p.transform[5] === player.y - camera.y)!;
      expect(barrel).toBeDefined();
      expect(Math.atan2(barrel.transform[1]!, barrel.transform[0]!)).toBeCloseTo(player.facing);
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
test("phone boundaries and corners keep the robot, barrel and heat clear of the HUD and clipping", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const p = { ...lifeDefaults(), id: "local", name: "WideWWWWWWWWWWWW", team: "tabs" as const, x: 1200, y: 1200,
      vx: 0, vy: 0, facing: 0, immuneUntil: 0, heat: 17, overheatUntil: 10000 };
    const bounds = (paint: Paint) => {
      const rect = paint.path.find(c => c.op === "roundRect");
      const image = paint.op === "drawImage" ? paint.args[0] as HTMLCanvasElement : null;
      const [x, y, w, h] = rect ? rect.args : image ? [paint.args[1], paint.args[2], image.width, image.height] : paint.args;
      const [a, b, c, d, e, f] = paint.transform as [number, number, number, number, number, number];
      const corners = [[Number(x), Number(y)], [Number(x) + Number(w), Number(y)], [Number(x), Number(y) + Number(h)], [Number(x) + Number(w), Number(y) + Number(h)]];
      const xs = corners.map(([x, y]) => a * x! + c * y! + e), ys = corners.map(([x, y]) => b * x! + d * y! + f);
      return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    };
    for (const [width, height] of [[390, 844], [844, 390]]) for (const [x, y] of [[14, 14], [1200, 14], [2386, 14], [2386, 1200], [2386, 2386], [1200, 2386], [14, 2386], [14, 1200]]) for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      Object.assign(p, { x, y, facing }); fixture.context.paints.length = 0;
      renderer.draw(width!, height!, cameraFor(x!, y!, width!, height!), [p], p, input);
      const paints = fixture.context.paints;
      const hud = paints.find(q => q.op === "fillRect" && Number(q.args[2]) > 100 && Number(q.args[3]) === 34)!;
      expect(hud).toBeDefined(); const panel = bounds(hud);
      const feedback = paints.filter(q => q.op === "drawImage" || q.op === "stroke" && q.path.some(c => c.op === "roundRect") ||
        q.op === "fillRect" && Number(q.args[2]) > 0 && Number(q.args[2]) <= 50 && Number(q.args[3]) > 0 && Number(q.args[3]) <= 10);
      expect(feedback.length).toBeGreaterThanOrEqual(6);
      for (const paint of feedback) {
        const r = bounds(paint);
        expect(r.left).toBeGreaterThanOrEqual(0); expect(r.top).toBeGreaterThanOrEqual(0);
        expect(r.right).toBeLessThanOrEqual(width!); expect(r.bottom).toBeLessThanOrEqual(height!);
        expect(r.right <= panel.left || r.left >= panel.right || r.bottom <= panel.top || r.top >= panel.bottom).toBe(true);
      }
    }
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
    p.streak = 30;
    const capped = numbers(draw(4, 17)); expect(capped).toEqual(expect.arrayContaining([17, 987, 3, 1]));
    expect(capped).not.toContain(4);
    const effectTime = 1_000_000_000, kill = { id: 1, tick: 4, x: 550, y: 550, points: 11, type: "kill" as const, kind: "crawler" as const };
    renderer.events([kill], effectTime);
    expect(draw(effectTime / 50).some(paint => paint.op === "fillText" && paint.args[0] === "+11" && paint.globalAlpha > 0)).toBe(true);
    renderer.events([kill], effectTime + 100);
    expect(draw(effectTime / 50 + 15).some(paint => paint.op === "fillText" && paint.args[0] === "+11")).toBe(false);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});
