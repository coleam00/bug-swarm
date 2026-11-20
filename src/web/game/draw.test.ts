import { expect, test } from "bun:test";
import { SQUARE_ARENA, type Arena } from "./arena";
import { BUG_STYLES } from "./styles";
import { Renderer } from "./draw";
import { Effects } from "./fx";
import { createSimulation, dronePosition } from "./simulation";
import { canvasFixture, type Paint } from "./canvas-fixture.test-support";

function scene(arena: Arena = SQUARE_ARENA, width = arena.width, height = arena.height) {
  const fixture = canvasFixture(), renderer = new Renderer(fixture.context as unknown as CanvasRenderingContext2D, fixture.factory);
  const state = createSimulation(1, arena), fx = new Effects();
  renderer.resize(width, height, 1, arena);
  return { fixture, renderer, state, fx, render() {
    fixture.context.paints.length = 0; renderer.draw(state, fx);
    expect(fixture.depth).toBe(0);
    expect(fixture.context.paints.every((paint) => paint.shadowBlur <= 0)).toBe(true);
    return [...fixture.context.paints];
  } };
}
const hasShape = (paint: Paint, shape: string) => paint.path.some((part) => part.op === shape);
const at = (paint: Paint, x: number, y: number) => Math.hypot(paint.transform[4]! - x, paint.transform[5]! - y) < 1e-6;
const heading = (paint: Paint) => Math.atan2(paint.transform[1]!, paint.transform[0]!);
// Compare visible properties without fixing the art to a particular palette.
function colour(value: Paint["fillStyle"]): { light: number; alpha: number } {
  if (typeof value !== "string") throw new Error("Expected a solid colour");
  const rgba = Bun.color(value, "[rgba]");
  if (!rgba) throw new Error(`Invalid test colour: ${value}`);
  const linear = rgba.slice(0, 3).map((channel) => {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return { light: linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722, alpha: rgba[3] / 255 };
}
function localPoint(transform: number[], x: number, y: number): [number, number] | null {
  const [a, b, c, d, e, f] = transform as [number, number, number, number, number, number];
  const determinant = a * d - b * c;
  return determinant ? [((x - e) * d - (y - f) * c) / determinant,
    ((y - f) * a - (x - e) * b) / determinant] : null;
}
// Sample inside the cache surface, intersecting the painted rectangle. Gradients
// keep their creation transform; later paint transforms must not move the falloff.
function gradientAlpha(paint: Paint, surface: HTMLCanvasElement, u: number, v: number): number {
  const gradient = paint.fillStyle;
  if (typeof gradient === "string") throw new Error("Expected a radial gradient");
  const canvasX = surface.width * u, canvasY = surface.height * v;
  const point = localPoint(paint.transform, canvasX, canvasY);
  const [x, y, width, height] = paint.args as [number, number, number, number];
  if (!point || !(point[0] >= x && point[0] <= x + width && point[1] >= y && point[1] <= y + height)) return 0;
  const radialPoint = localPoint(gradient.transform, canvasX, canvasY);
  if (!radialPoint) return 0;
  const [x0, y0, r0, x1, y1, r1] = gradient.circles;
  const px = radialPoint[0] - x0, py = radialPoint[1] - y0;
  const dx = x1 - x0, dy = y1 - y0, dr = r1 - r0;
  // Intersect the sample point with the interpolated circles C(t), R(t).
  const qa = dx * dx + dy * dy - dr * dr;
  const qb = -2 * (px * dx + py * dy + r0 * dr), qc = px * px + py * py - r0 * r0;
  const discriminant = qb * qb - 4 * qa * qc;
  if (discriminant < 0) return 0;
  const roots = Math.abs(qa) < 1e-9 ? [-qc / qb] :
    [(-qb - Math.sqrt(discriminant)) / (2 * qa), (-qb + Math.sqrt(discriminant)) / (2 * qa)];
  const t = Math.max(...roots.filter((root) => r0 + root * dr >= 0));
  if (!Number.isFinite(t)) return 0;
  const stops = [...gradient.stops].sort((left, right) => left.offset - right.offset);
  const first = stops[0]!, last = stops.at(-1)!;
  if (t <= first.offset) return colour(first.colour).alpha * paint.globalAlpha;
  for (let i = 1; i < stops.length; i++) {
    const left = stops[i - 1]!, right = stops[i]!;
    if (t <= right.offset) {
      const fraction = (t - left.offset) / (right.offset - left.offset);
      return (colour(left.colour).alpha * (1 - fraction) + colour(right.colour).alpha * fraction) * paint.globalAlpha;
    }
  }
  return colour(last.colour).alpha * paint.globalAlpha;
}
const corners = [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99]] as const;
function visibleVignette(paint: Paint, surface: HTMLCanvasElement): void {
  expect(gradientAlpha(paint, surface, 0.5, 0.5)).toBeLessThan(0.1);
  for (const [u, v] of corners) expect(gradientAlpha(paint, surface, u, v)).toBeGreaterThan(0.35);
  for (const [u, v] of [[0.01, 0.5], [0.99, 0.5], [0.5, 0.01], [0.5, 0.99]] as const) {
    expect(gradientAlpha(paint, surface, u, v)).toBeGreaterThan(0.05);
  }
}
function floorColour(s: ReturnType<typeof scene>): Paint["fillStyle"] {
  return s.fixture.surfaces.flatMap(({ context }) => context.paints)
    .find((p) => p.op === "fillRect" && typeof p.fillStyle === "string")!.fillStyle;
}
function contrast(a: Paint["fillStyle"], b: Paint["fillStyle"]): number {
  const x = colour(a).light, y = colour(b).light;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function visibleStroke(s: ReturnType<typeof scene>, paint: Paint, minimumAlpha = 0.5): void {
  expect(colour(paint.strokeStyle).alpha * paint.globalAlpha).toBeGreaterThan(minimumAlpha);
  expect(contrast(paint.strokeStyle, floorColour(s))).toBeGreaterThan(1.5);
  expect(paint.lineWidth).toBeGreaterThan(0);
}
function readableLabel(s: ReturnType<typeof scene>, label: Paint): void {
  const glyph = s.fixture.source(label).paints.find((p) => p.op === "fillText" && p.args[0] === "+")!;
  const pixels = Number(glyph.font.match(/([\d.]+)px/)![1]);
  const canvas = label.args[0] as HTMLCanvasElement;
  const cssHeight = pixels * Math.hypot(glyph.transform[2]!, glyph.transform[3]!) *
    Number(label.args[8]) / canvas.height * Math.hypot(label.transform[2]!, label.transform[3]!);
  // Half a CSS pixel allows backing-store rounding at fractional viewport scales.
  expect(cssHeight).toBeGreaterThanOrEqual(17.5);
  expect(glyph.font).toMatch(/\b(bold|bolder|[6-9]00)\b/);
  expect(contrast(glyph.fillStyle, floorColour(s))).toBeGreaterThan(4);
  expect(colour(glyph.fillStyle).alpha * glyph.globalAlpha * label.globalAlpha).toBeGreaterThan(0.5);
}
function imageCentre(paint: Paint): [number, number] {
  const offset = paint.args.length === 9 ? 4 : 0;
  const x = Number(paint.args[1 + offset]) + Number(paint.args[3 + offset]) / 2, y = Number(paint.args[2 + offset]) + Number(paint.args[4 + offset]) / 2;
  const [a, b, c, d, e, f] = paint.transform as [number, number, number, number, number, number];
  return [a * x + c * y + e, b * x + d * y + f];
}
function glow(s: ReturnType<typeof scene>, paint: Paint): boolean {
  return paint.op === "drawImage" && Number(paint.args[3]) < SQUARE_ARENA.width &&
    s.fixture.source(paint).paints.some((source) => {
      if (source.op !== "fillRect" || typeof source.fillStyle === "string") return false;
      const surface = paint.args[0] as HTMLCanvasElement;
      return colour(source.fillStyle.stops[0]!.colour).light > 0.2 &&
        gradientAlpha(source, surface, 0.5, 0.5) * paint.globalAlpha > 0.1 &&
        [[0.4, 0.5], [0.6, 0.5], [0.5, 0.4], [0.5, 0.6]].every(([u, v]) => gradientAlpha(source, surface, u!, v!) > 0.2) &&
        corners.every(([u, v]) => gradientAlpha(source, surface, u, v) < 0.1);
    });
}

test("renderer reuses caches across frames and unchanged sizes, replaces on resize and disposes stores", () => {
  const s = scene(), initialCount = s.fixture.created;
  expect(initialCount).toBeGreaterThan(0);
  for (let i = 0; i < 100; i++) s.render();
  expect(s.fixture.created).toBe(initialCount);
  s.renderer.resize(600, 600, 1); expect(s.fixture.created).toBe(initialCount);
  const oldSurfaces = [...s.fixture.surfaces];
  s.renderer.resize(390, 700, 2); expect(s.fixture.created).toBeGreaterThan(initialCount);
  expect(oldSurfaces.every(({ canvas }) => canvas.width === 0)).toBe(true);
  s.renderer.dispose(); expect(s.fixture.surfaces.every(({ canvas }) => canvas.width === 0)).toBe(true);
});

test("arena paints its cached grid and edge vignette within a fixed clip", () => {
  const s = scene(), paints = s.render(), images = paints.filter((p) => p.op === "drawImage");
  const arenaImages = images.filter((p) => Number(p.args[3]) >= SQUARE_ARENA.width && Number(p.args[4]) >= SQUARE_ARENA.height);
  expect(arenaImages.some((p) => s.fixture.source(p).paints.some((source) => source.op === "stroke" && hasShape(source, "lineTo")))).toBe(true);
  expect(arenaImages.some((p) => s.fixture.source(p).paints.some((source) => typeof source.fillStyle !== "string"))).toBe(true);
  expect(paints.some((p) => p.op === "clip" && hasShape(p, "rect"))).toBe(true);
  const floor = colour(floorColour(s));
  expect(floor.light).toBeLessThan(0.08); expect(floor.alpha).toBeGreaterThan(0.8);
  const gridStrokes = arenaImages.flatMap((p) => s.fixture.source(p).paints)
    .filter((p) => p.op === "stroke" && hasShape(p, "lineTo"));
  expect(gridStrokes.some((p) => contrast(p.strokeStyle, floorColour(s)) > 1.1 &&
    contrast(p.strokeStyle, floorColour(s)) < 5 && colour(p.strokeStyle).alpha * p.globalAlpha > 0.1)).toBe(true);
  for (const backdrop of paints.slice(0, paints.indexOf(images[0]!)).filter((p) => p.op === "fillRect")) {
    expect(colour(backdrop.fillStyle).light).toBeLessThan(0.08);
  }
  const vignetteImage = arenaImages.find((image) => s.fixture.source(image).paints
    .some((p) => p.op === "fillRect" && typeof p.fillStyle !== "string"))!;
  const vignette = s.fixture.source(vignetteImage).paints.find((p) => p.op === "fillRect" && typeof p.fillStyle !== "string")!;
  if (typeof vignette.fillStyle === "string") throw new Error("Missing vignette gradient");
  visibleVignette(vignette, vignetteImage.args[0] as HTMLCanvasElement);
  expect(colour(vignette.fillStyle.stops.at(-1)!.colour).light).toBeLessThan(0.08);
  expect(vignetteImage.globalAlpha).toBeGreaterThan(0.5);
});

test.each([
  { arena: { width: 450, height: 800 }, screen: [390, 844], bounds: [0, 226 / 3, 390, 2080 / 3] },
  { arena: { width: 800, height: 450 }, screen: [844, 390], bounds: [226 / 3, 0, 2080 / 3, 390] },
  { arena: { width: 450, height: 800 }, screen: [844, 390], bounds: [312.3125, 0, 219.375, 390] },
])("grid, vignette, clip and edge labels fit $arena in $screen, including rotation", ({ arena, screen, bounds }) => {
  const s = scene(arena, screen[0]!, screen[1]!);
  s.fx.labels.pop(arena.width - 1, arena.height - 1);
  const paints = s.render();
  const layers = paints.filter((p) => p.op === "drawImage" && p.args[3] === arena.width && p.args[4] === arena.height);
  expect(layers).toHaveLength(2);
  for (const layer of layers) {
    const actual = [layer.transform[4]!, layer.transform[5]!, Number(layer.args[3]) * layer.transform[0]!, Number(layer.args[4]) * layer.transform[3]!];
    actual.forEach((value, i) => expect(value).toBeCloseTo(bounds[i]!, 6));
    const source = s.fixture.source(layer);
    // The cached paint itself must cover the backing store, not stretch a 600px floor.
    const fill = source.paints.find((p) => p.op === "fillRect")!;
    expect(Number(fill.args[2]) * fill.transform[0]!).toBeCloseTo(bounds[2]!, 6);
    expect(Number(fill.args[3]) * fill.transform[3]!).toBeCloseTo(bounds[3]!, 6);
    if (typeof fill.fillStyle !== "string") visibleVignette(fill, layer.args[0] as HTMLCanvasElement);
  }
  const grid = s.fixture.source(layers[0]!).paints.find((p) => p.op === "stroke")!;
  expect(grid.path.some((p) => p.op === "lineTo" && p.args[0] === arena.width)).toBe(true);
  expect(grid.path.some((p) => p.op === "lineTo" && p.args[1] === arena.height)).toBe(true);
  expect(paints.find((p) => p.op === "clip")!.path).toEqual([{ op: "rect", args: [0, 0, arena.width, arena.height] }]);
  const glyphs = paints.filter((p) => p.op === "drawImage" && s.fixture.source(p).paints.some((source) => source.op === "fillText"));
  const label = glyphs.at(-1)!;
  readableLabel(s, label);
  const centre = imageCentre(label);
  expect(centre[0]).toBeGreaterThan(bounds[0]! + bounds[2]! * 0.8);
  expect(centre[1]).toBeGreaterThan(bounds[1]! + bounds[3]! * 0.8);
  expect(centre[0] + Number(label.args[7]) * label.transform[0]! / 2).toBeLessThan(bounds[0]! + bounds[2]!);
  expect(centre[1] + Number(label.args[8]) * label.transform[3]! / 2).toBeLessThan(bounds[1]! + bounds[3]!);
});

test("a new run's world shape replaces caches at the same canvas size", () => {
  const s = scene({ width: 450, height: 800 }, 844, 390), old = [...s.fixture.surfaces];
  s.renderer.draw(createSimulation(1, { width: 800, height: 450 }), s.fx);
  expect(old.every(({ canvas }) => canvas.width === 0)).toBe(true);
  expect(s.fixture.context.paints.some((p) => p.op === "drawImage" && p.args[3] === 800 && p.args[4] === 450)).toBe(true);
  const count = s.fixture.created;
  s.renderer.resize(844, 390, 1, { width: 800, height: 450 });
  expect(s.fixture.created).toBe(count);
});

test("robot has a filled rounded chassis, cached core glow and bright core", () => {
  const s = scene(), paints = s.render(), { x, y } = s.state.robot;
  expect(paints.some((p) => p.op === "fill" && at(p, x, y) && hasShape(p, "roundRect"))).toBe(true);
  expect(paints.some((p) => glow(s, p) && imageCentre(p)[0] === x && imageCentre(p)[1] === y)).toBe(true);
  expect(paints.some((p) => p.op === "fill" && at(p, x, y) && hasShape(p, "arc"))).toBe(true);
  const chassis = paints.find((p) => p.op === "fill" && at(p, x, y) && hasShape(p, "roundRect"))!;
  expect(contrast(chassis.fillStyle, floorColour(s))).toBeGreaterThan(1.5);
  expect(colour(chassis.fillStyle).alpha * chassis.globalAlpha).toBeGreaterThan(0.5);
  const core = paints.find((p) => p.op === "fill" && at(p, x, y) && hasShape(p, "arc"))!;
  expect(contrast(core.fillStyle, floorColour(s))).toBeGreaterThan(3);
  expect(colour(core.fillStyle).alpha * core.globalAlpha).toBeGreaterThan(0.8);
});

test("beetles face the robot and animate their articulated legs with visual time", () => {
  const s = scene(); s.state.bugs.push({ id: 7, kind: "base", x: 100, y: 100 });
  const beetle = (paints: Paint[]) => paints.find((p) => p.op === "fill" && at(p, 100, 100) && hasShape(p, "ellipse"))!;
  const legs = (paints: Paint[]) => paints.find((p) => p.op === "stroke" && at(p, 100, 100) && p.path.filter((part) => part.op === "lineTo").length >= 6)!;
  const first = s.render(); expect(beetle(first)).toBeDefined(); expect(legs(first)).toBeDefined();
  visibleStroke(s, legs(first));
  expect(heading(beetle(first))).toBeCloseTo(Math.atan2(200, 200));
  s.fx.time += 0.1;
  const animated = s.render(); expect(legs(animated).path).not.toEqual(legs(first).path);
  visibleStroke(s, legs(animated));
  s.state.robot.y = 100;
  const turned = s.render(); expect(heading(beetle(turned))).toBeCloseTo(0);
  visibleStroke(s, legs(turned));
});

test("fast beetles have a smaller bright shell and quicker gait selected from the kind table", () => {
  const s = scene();
  s.state.bugs.push({ id: 7, kind: "base", x: 100, y: 100 }, { id: 7, kind: "fast", x: 200, y: 100 });
  const first = s.render();
  const body = (x: number, colour: string) => first.find((p) => p.op === "fill" && at(p, x, 100) && p.fillStyle === colour)!;
  const base = body(100, BUG_STYLES.base.body), fast = body(200, BUG_STYLES.fast.body);
  expect(base).toBeDefined(); expect(fast).toBeDefined(); expect(fast.fillStyle).not.toBe(base.fillStyle);
  for (const shell of [base, fast]) {
    expect(contrast(shell.fillStyle, floorColour(s))).toBeGreaterThan(3);
    expect(colour(shell.fillStyle).alpha * shell.globalAlpha).toBeGreaterThan(0.5);
  }
  expect(fast.path[0]!.args[2]!).toBeLessThan(base.path[0]!.args[2]!);
  expect(fast.path[0]!.args[3]!).toBeLessThan(base.path[0]!.args[3]!);
  const legs = (paints: Paint[], x: number) => paints.find((p) => p.op === "stroke" && at(p, x, 100) && p.path.length === 18)!;
  s.fx.time = 2 * Math.PI / BUG_STYLES.fast.gait;
  const later = s.render();
  visibleStroke(s, legs(first, 200)); visibleStroke(s, legs(later, 200));
  legs(later, 200).path.forEach((part, i) => part.args.forEach((value, j) => expect(value).toBeCloseTo(legs(first, 200).path[i]!.args[j]!, 6)));
  expect(legs(later, 100).path).not.toEqual(legs(first, 100).path);
  expect(BUG_STYLES.fast.gait).toBeGreaterThan(BUG_STYLES.base.gait);
});

test("shots paint long bright streaks and cached glow aligned with their velocity", () => {
  const s = scene(); s.state.shots.push({ x: 450, y: 200, vx: 300, vy: 100, life: 1 });
  const streak = (paints: Paint[]) => paints.find((p) => p.op === "stroke" && at(p, 450, 200) && hasShape(p, "lineTo"))!;
  const first = s.render(); expect(streak(first)).toBeDefined();
  expect(contrast(streak(first).strokeStyle, floorColour(s))).toBeGreaterThan(3);
  expect(colour(streak(first).strokeStyle).alpha * streak(first).globalAlpha).toBeGreaterThan(0.5);
  expect(heading(streak(first))).toBeCloseTo(Math.atan2(100, 300));
  const line = streak(first).path.filter((p) => p.op === "lineTo" || p.op === "moveTo");
  expect(Math.hypot(line[1]!.args[0]! - line[0]!.args[0]!, line[1]!.args[1]! - line[0]!.args[1]!)).toBeGreaterThan(streak(first).lineWidth);
  expect(first.some((p) => glow(s, p) && at(p, 450, 200))).toBe(true);
  s.state.shots[0]!.vx = -100; s.state.shots[0]!.vy = 300;
  expect(heading(streak(s.render()))).toBeCloseTo(Math.atan2(300, -100));
});

test("active trails, squash particles and +10 glyphs reach the canvas and disappear on expiry", () => {
  const s = scene(); s.fx.advance(0); s.fx.squash(400, 100);
  s.fx.trails.movement(100, 500, true, 1); s.fx.advance(50);
  const paints = s.render(), images = paints.filter((p) => p.op === "drawImage");
  expect(images.every((p) => p.globalAlpha > 0)).toBe(true);
  expect(images.some((p) => glow(s, p) && imageCentre(p)[0] === 100 && imageCentre(p)[1] === 500)).toBe(true);
  for (let i = 0; i < s.fx.particles.capacity; i++) {
    if (s.fx.particles.life[i]! <= 0) continue;
    expect(images.some((p) => glow(s, p) && Math.hypot(imageCentre(p)[0] - s.fx.particles.x[i]!, imageCentre(p)[1] - s.fx.particles.y[i]!) < 1e-6)).toBe(true);
  }
  const label = images.find((p) => s.fixture.source(p).paints.some((source) => source.op === "fillText" && source.args[0] === "+"));
  expect(label).toBeDefined(); expect(imageCentre(label!)[1]).toBeLessThan(100);
  readableLabel(s, label!);
  for (let timestamp = 100; timestamp <= 1000; timestamp += 50) s.fx.advance(timestamp);
  const expired = s.render();
  expect(expired.filter((p) => p.op === "drawImage").length).toBeLessThan(images.length);
  expect(expired.some((p) => p.op === "drawImage" && s.fixture.source(p).paints.some((source) => source.op === "fillText"))).toBe(false);
});

test("a hit flashes the chassis white and translates the world while the clip and caller context stay fixed", () => {
  const s = scene(); s.fx.advance(0);
  const whiteBody = (p: Paint) => p.op === "fill" && hasShape(p, "roundRect") &&
    colour(p.fillStyle).light > 0.9 && colour(p.fillStyle).alpha * p.globalAlpha > 0.8;
  expect(s.render().some(whiteBody)).toBe(false);
  s.fx.hit(); const hit = s.render();
  expect(hit.some(whiteBody)).toBe(true);
  expect(hit.some((p) => p.op === "drawImage" && Number(p.args[3]) >= SQUARE_ARENA.width && at(p, s.fx.shake.x, s.fx.shake.y))).toBe(true);
  expect(hit.find((p) => p.op === "clip")!.transform).toEqual([1, 0, 0, 1, 0, 0]);
  s.fixture.context.fillRect(0, 0, 1, 1);
  expect(s.fixture.context.paints.at(-1)!.transform).toEqual([1, 0, 0, 1, 0, 0]);
  s.fx.advance(80); s.fx.advance(160); s.fx.advance(240);
  const recovered = s.render(); expect(recovered.some(whiteBody)).toBe(false);
  expect(recovered.find((p) => p.op === "drawImage" && Number(p.args[3]) >= SQUARE_ARENA.width)!.transform).toEqual([1, 0, 0, 1, 0, 0]);
});

test.each(["robot", "drone"] as const)("review laser stretches both its bright streak and cached glow (%s)", source => {
  const s = scene();
  s.state.shots = [{ x: 450, y: 200, vx: 300, vy: 0, life: 1, source }];
  const geometry = () => {
    const paints = s.render().filter(p => at(p, 450, 200));
    const stroke = paints.find(p => p.op === "stroke")!;
    visibleStroke(s, stroke);
    expect(paints.some(p => glow(s, p))).toBe(true);
    const line = stroke.path.filter(p => p.op === "moveTo" || p.op === "lineTo");
    return [Math.abs(line[1]!.args[0]! - line[0]!.args[0]!), Number(paints.find(p => p.op === "drawImage")!.args[3])];
  };
  const normal = geometry(); s.state.shots[0]!.laser = true;
  const laser = geometry();
  expect(laser[0]!).toBeGreaterThan(normal[0]!);
  expect(laser[1]!).toBeGreaterThan(normal[1]!);
});

test("shield bubble exists only with charges; two charges add a second outline", () => {
  const s = scene();
  const outlines = () => s.render().filter(p => p.op === "stroke" && at(p, 300, 300) && p.path.some(c => c.op === "arc" && c.args[2]! >= 30));
  expect(outlines()).toHaveLength(0);
  for (const charges of [1, 2]) {
    s.state.shieldCharges = charges;
    const active = outlines();
    expect(active).toHaveLength(charges);
    for (const outline of active) visibleStroke(s, outline);
  }
  s.state.shieldCharges = 0; expect(outlines()).toHaveLength(0);
});

test.each([
  { arena: SQUARE_ARENA, x: 300, y: 300 },
  { arena: { width: 800, height: 450 }, x: 20, y: 30 },
  { arena: { width: 450, height: 800 }, x: 430, y: 770 },
])("bomb ring expands across $arena from ($x, $y), fades and expires", ({ arena, x, y }) => {
  const s = scene(arena), farthestX = Math.max(x, arena.width - x), farthestY = Math.max(y, arena.height - y);
  const cornerDistance = Math.hypot(farthestX, farthestY);
  s.fx.advance(0); s.fx.bomb(x, y, cornerDistance);
  const ring = () => s.render().find(p => p.op === "stroke" && p.path.some(c => c.op === "arc" && c.args[0] === x && c.args[1] === y));
  expect(ring()).toBeDefined();
  const first = ring()!; s.fx.advance(80); s.fx.advance(160); s.fx.advance(240);
  const later = ring()!;
  visibleStroke(s, first); visibleStroke(s, later, 0.1);
  expect(later.path[0]!.args[2]!).toBeGreaterThan(first.path[0]!.args[2]!);
  expect(later.globalAlpha).toBeGreaterThan(0.8); // stays bright through most expansion
  for (let t = 320; t <= 560; t += 80) s.fx.advance(t);
  expect(ring()!.globalAlpha).toBeLessThan(first.globalAlpha);
  s.fx.advance(640);
  const nearEnd = ring()!, radius = nearEnd.path[0]!.args[2]!;
  // Before expiry the painted ring must cross every arena edge and approach
  // the farthest corner, not merely grow a little around the detonation.
  visibleStroke(s, nearEnd, 0.02);
  expect(radius).toBeGreaterThan(Math.max(farthestX, farthestY));
  expect(radius).toBeGreaterThanOrEqual(cornerDistance * 0.95);
  s.fx.advance(720);
  expect(ring()).toBeUndefined();
});

test("each drone has a larger core and cached glow at its simulation orbit position", () => {
  const s = scene(); s.state.drones = [{ fireIn: 0 }, { fireIn: 0 }]; s.state.time = 2;
  const paints = s.render();
  for (let i = 0; i < 2; i++) {
    const p = { x: 0, y: 0 }; dronePosition(s.state, i, p);
    expect(paints.some(paint => glow(s, paint) && Math.hypot(imageCentre(paint)[0] - p.x, imageCentre(paint)[1] - p.y) < 1e-6 && Number(paint.args[3]) >= 44 && Number(paint.args[3]) < 60)).toBe(true);
    const core = paints.find(paint => paint.op === "stroke" && paint.path.some(c => c.op === "arc" && c.args[0] === p.x && c.args[1] === p.y && c.args[2]! >= 7))!;
    expect(core).toBeDefined(); visibleStroke(s, core);
  }
});

test.each([false, true])("robot identity survives every foreground effect, hit and immunity (hit=%s)", hit => {
  const s = scene(); s.state.bugs.push({ id: 1, kind: "base", ...s.state.robot });
  s.fx.squash(300, 300); s.fx.bomb(300, 300, 850);
  if (hit) s.fx.hit(); else s.state.invulnerableUntil = 10;
  const paints = s.render();
  const ring = paints.filter(p => p.op === "stroke" && at(p, 300 + s.fx.shake.x, 300 + s.fx.shake.y) && p.path.some(c => c.op === "arc" && c.args[2]! >= 20 && c.args[2]! <= 26)).at(-1)!;
  expect(ring).toBeDefined(); visibleStroke(s, ring, 0.9);
  expect(contrast(ring.strokeStyle, floorColour(s))).toBeGreaterThan(8);
  expect(ring.lineWidth).toBeGreaterThanOrEqual(3);
  expect(paints.at(-1)).toBe(ring);
  const chassis = paints.filter(p => p.op === "fill" && hasShape(p, "roundRect"));
  expect(chassis).toHaveLength(hit ? 2 : 1);
  const bodyIndex = paints.indexOf(chassis[0]!);
  const textIndex = paints.map(p => p.op === "drawImage" && p.args.length === 9).lastIndexOf(true);
  const bugIndex = paints.map(p => hasShape(p, "ellipse")).lastIndexOf(true);
  expect(bodyIndex).toBeGreaterThan(textIndex); expect(bodyIndex).toBeGreaterThan(bugIndex);
  const halo = paints.find(p => glow(s, p) && Number(p.args[3]) >= 80 && Number(p.args[3]) <= 100 && Number(p.args[4]) >= 80 && Number(p.args[4]) <= 100 && Math.hypot(imageCentre(p)[0] - 300 - s.fx.shake.x, imageCentre(p)[1] - 300 - s.fx.shake.y) < 1e-6)!;
  expect(halo).toBeDefined(); expect(paints.indexOf(halo)).toBeGreaterThan(textIndex);
  // Particle and vignette passes also precede text and identity.
  const vignetteIndex = paints.map(p => p.op === "drawImage" && p.args[3] === 600).lastIndexOf(true);
  expect(textIndex).toBeGreaterThan(vignetteIndex);
  expect(vignetteIndex).toBeGreaterThan(paints.map(p => p.op === "drawImage" && p.args.length === 5 && p.args[3] === 18).lastIndexOf(true));
});

test("last-charge shield flash remains visible without a bubble, outside the identity ring", () => {
  const s = scene(); s.fx.advance(0); s.fx.block();
  const rim = () => s.render().filter(p => p.op === "stroke" && at(p, 300, 300) && p.path.some(c => c.op === "arc" && c.args[2]! >= 30));
  const first = rim(); expect(first).toHaveLength(2); first.forEach(p => visibleStroke(s, p));
  s.fx.advance(80); expect(rim()[0]!.path[0]!.args[2]!).toBeGreaterThan(first[0]!.path[0]!.args[2]!);
  s.fx.advance(160); s.fx.advance(240); expect(rim()).toHaveLength(0);
});

test.each([false, true])("shot sources retain different visible colours with laser=%s", laser => {
  const s = scene();
  s.state.shots = ["robot", "drone"].map((source, i) => ({ source: source as "robot" | "drone", laser, x: 100 + i * 100, y: 200, vx: 300, vy: 0, life: 1 }));
  const paints = s.render();
  const robot = paints.filter(p => p.op === "stroke" && at(p, 100, 200));
  const drone = paints.filter(p => p.op === "stroke" && at(p, 200, 200));
  expect(robot).toHaveLength(2); expect(drone).toHaveLength(2);
  for (let i = 0; i < 2; i++) {
    visibleStroke(s, robot[i]!); visibleStroke(s, drone[i]!);
    expect(robot[i]!.strokeStyle).not.toBe(drone[i]!.strokeStyle);
    const rgbRobot = Bun.color(robot[i]!.strokeStyle as string, "[rgb]")!, rgbDrone = Bun.color(drone[i]!.strokeStyle as string, "[rgb]")!;
    expect(rgbRobot[0] - rgbRobot[2]).toBeGreaterThan(20);
    expect(rgbDrone[2] - rgbDrone[0]).toBeGreaterThan(20);
  }
});

test.each([10, 30, 1500])("numeric atlas composes +%i in order, centered and clamped as a whole", total => {
  for (const x of [0, 300, 600]) {
    const s = scene(); for (let i = 0; i < total / 10; i++) s.fx.labels.pop(x, 100);
    const paints = s.render().filter(p => p.op === "drawImage" && p.args.length === 9);
    expect(paints).toHaveLength(String(total).length + 1);
    const text = paints.map(p => {
      const cell = Math.round(Number(p.args[1]) / Number(p.args[3]));
      return s.fixture.source(p).paints.filter(q => q.op === "fillText")[cell]!.args[0];
    }).join("");
    expect(text).toBe(`+${total}`);
    const left = Number(paints[0]!.args[5]), last = paints.at(-1)!, right = Number(last.args[5]) + Number(last.args[7]);
    expect(left).toBeGreaterThanOrEqual(5); expect(right).toBeLessThanOrEqual(595);
    expect(right - left).toBeCloseTo(paints.length * Number(last.args[7]));
    if (x === 300) expect((left + right) / 2).toBeCloseTo(300);
    paints.forEach(p => readableLabel(s, p));
    expect(s.fixture.source(last).paints.filter(p => p.op === "fillText")).toHaveLength(11);
  }
});

test.each([1, 2])("joystick ring/knob retain CSS geometry at DPR %i across world scales and shake", ratio => {
  for (const [width, height] of [[390, 844], [844, 390], [1280, 720]]) {
    const s = scene({ width: 450, height: 800 }, width!, height!);
    s.fixture.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    s.renderer.resize(width!, height!, ratio, s.state.arena);
    s.fx.hit();
    for (const [dx, dy] of [[0, 0], [36, -48]]) {
      s.fixture.context.paints.length = 0;
      s.renderer.draw(s.state, s.fx, { x: 15, y: 200, dx: dx!, dy: dy! });
      const circles = s.fixture.context.paints.filter(p => p.path.some(c => c.op === "arc" && c.args[0] === 15 + (p.op === "fill" ? dx! : 0) && c.args[1] === 200 + (p.op === "fill" ? dy! : 0)));
      const ring = circles.find(p => p.op === "stroke")!, knob = circles.find(p => p.op === "fill")!;
      expect(ring).toBeDefined(); expect(knob).toBeDefined();
      expect(ring.path[0]!.args[2]).toBe(60); expect(knob.path[0]!.args[2]).toBe(12);
      for (const paint of [ring, knob]) {
        expect(paint.transform).toEqual([ratio, 0, 0, ratio, 0, 0]);
        const alpha = colour(paint.op === "fill" ? paint.fillStyle : paint.strokeStyle).alpha * paint.globalAlpha;
        expect(alpha).toBeGreaterThan(0.2); expect(alpha).toBeLessThan(0.8);
        expect(paint.shadowBlur).toBe(0);
      }
      expect(ring.lineWidth).toBeGreaterThan(0); expect(ring.lineWidth).toBeLessThan(3);
      expect(s.fixture.depth).toBe(0);
      s.fixture.context.fillRect(0, 0, 1, 1);
      expect(s.fixture.context.paints.at(-1)!.transform).toEqual([ratio, 0, 0, ratio, 0, 0]);
    }
    s.fixture.context.paints.length = 0; s.renderer.draw(s.state, s.fx, null);
    expect(s.fixture.context.paints.some(p => p.path.some(c => c.op === "arc" && c.args[0] === 15 && c.args[1] === 200))).toBe(false);
  }
});
