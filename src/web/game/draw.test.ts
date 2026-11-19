import { expect, test } from "bun:test";
import { SQUARE_ARENA, type Arena } from "./arena";
import { BUG_STYLES } from "./styles";
import { Renderer } from "./draw";
import { Effects } from "./fx";
import { createSimulation } from "./simulation";
import { canvasFixture, type Paint } from "./canvas-fixture.test-support";

function scene(arena: Arena = SQUARE_ARENA, width = arena.width, height = arena.height) {
  const fixture = canvasFixture(), renderer = new Renderer(fixture.context as unknown as CanvasRenderingContext2D, fixture.factory);
  const state = createSimulation(1, arena), fx = new Effects();
  renderer.resize(width, height, 1, arena);
  return { fixture, renderer, state, fx, render() {
    fixture.context.paints.length = 0; renderer.draw(state, fx);
    expect(fixture.depth).toBe(0); expect("shadowBlur" in fixture.context).toBe(false);
    return [...fixture.context.paints];
  } };
}
const hasShape = (paint: Paint, shape: string) => paint.path.some((part) => part.op === shape);
const at = (paint: Paint, x: number, y: number) => Math.hypot(paint.transform[4]! - x, paint.transform[5]! - y) < 1e-6;
const heading = (paint: Paint) => Math.atan2(paint.transform[1]!, paint.transform[0]!);
function imageCentre(paint: Paint): [number, number] {
  const x = Number(paint.args[1]) + Number(paint.args[3]) / 2, y = Number(paint.args[2]) + Number(paint.args[4]) / 2;
  const [a, b, c, d, e, f] = paint.transform as [number, number, number, number, number, number];
  return [a * x + c * y + e, b * x + d * y + f];
}
function glow(s: ReturnType<typeof scene>, paint: Paint): boolean {
  return paint.op === "drawImage" && Number(paint.args[3]) < SQUARE_ARENA.width &&
    s.fixture.source(paint).paints.some((source) => typeof source.fillStyle !== "string");
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
  }
  const grid = s.fixture.source(layers[0]!).paints.find((p) => p.op === "stroke")!;
  expect(grid.path.some((p) => p.op === "lineTo" && p.args[0] === arena.width)).toBe(true);
  expect(grid.path.some((p) => p.op === "lineTo" && p.args[1] === arena.height)).toBe(true);
  expect(paints.find((p) => p.op === "clip")!.path).toEqual([{ op: "rect", args: [0, 0, arena.width, arena.height] }]);
  const label = paints.find((p) => p.op === "drawImage" && s.fixture.source(p).paints.some((source) => source.op === "fillText"))!;
  const centre = imageCentre(label);
  expect(centre[0]).toBeGreaterThan(bounds[0]! + bounds[2]! * 0.8);
  expect(centre[1]).toBeGreaterThan(bounds[1]! + bounds[3]! * 0.8);
  expect(centre[0] + Number(label.args[3]) * label.transform[0]! / 2).toBeLessThan(bounds[0]! + bounds[2]!);
  expect(centre[1] + Number(label.args[4]) * label.transform[3]! / 2).toBeLessThan(bounds[1]! + bounds[3]!);
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
});

test("beetles face the robot and animate their articulated legs with visual time", () => {
  const s = scene(); s.state.bugs.push({ id: 7, kind: "base", x: 100, y: 100 });
  const beetle = (paints: Paint[]) => paints.find((p) => p.op === "fill" && at(p, 100, 100) && hasShape(p, "ellipse"))!;
  const legs = (paints: Paint[]) => paints.find((p) => p.op === "stroke" && at(p, 100, 100) && p.path.filter((part) => part.op === "lineTo").length >= 6)!;
  const first = s.render(); expect(beetle(first)).toBeDefined(); expect(legs(first)).toBeDefined();
  expect(heading(beetle(first))).toBeCloseTo(Math.atan2(200, 200));
  s.fx.time += 0.1;
  const animated = s.render(); expect(legs(animated).path).not.toEqual(legs(first).path);
  s.state.robot.y = 100;
  const turned = s.render(); expect(heading(beetle(turned))).toBeCloseTo(0);
});

test("fast beetles have a smaller bright shell and quicker gait selected from the kind table", () => {
  const s = scene();
  s.state.bugs.push({ id: 7, kind: "base", x: 100, y: 100 }, { id: 7, kind: "fast", x: 200, y: 100 });
  const first = s.render();
  const body = (x: number, colour: string) => first.find((p) => p.op === "fill" && at(p, x, 100) && p.fillStyle === colour)!;
  const base = body(100, BUG_STYLES.base.body), fast = body(200, BUG_STYLES.fast.body);
  expect(base).toBeDefined(); expect(fast).toBeDefined(); expect(fast.fillStyle).not.toBe(base.fillStyle);
  expect(fast.path[0]!.args[2]!).toBeLessThan(base.path[0]!.args[2]!);
  expect(fast.path[0]!.args[3]!).toBeLessThan(base.path[0]!.args[3]!);
  const legs = (paints: Paint[], x: number) => paints.find((p) => p.op === "stroke" && at(p, x, 100) && p.path.length === 18)!;
  s.fx.time = 2 * Math.PI / BUG_STYLES.fast.gait;
  const later = s.render();
  legs(later, 200).path.forEach((part, i) => part.args.forEach((value, j) => expect(value).toBeCloseTo(legs(first, 200).path[i]!.args[j]!, 6)));
  expect(legs(later, 100).path).not.toEqual(legs(first, 100).path);
  expect(BUG_STYLES.fast.gait).toBeGreaterThan(BUG_STYLES.base.gait);
});

test("shots paint long bright streaks and cached glow aligned with their velocity", () => {
  const s = scene(); s.state.shots.push({ x: 450, y: 200, vx: 300, vy: 100, life: 1 });
  const streak = (paints: Paint[]) => paints.find((p) => p.op === "stroke" && at(p, 450, 200) && hasShape(p, "lineTo"))!;
  const first = s.render(); expect(streak(first)).toBeDefined();
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
  const label = images.find((p) => s.fixture.source(p).paints.some((source) => source.op === "fillText" && source.args[0] === "+10"));
  expect(label).toBeDefined(); expect(imageCentre(label!)[1]).toBeLessThan(100);
  for (let timestamp = 100; timestamp <= 1000; timestamp += 50) s.fx.advance(timestamp);
  const expired = s.render();
  expect(expired.filter((p) => p.op === "drawImage").length).toBeLessThan(images.length);
  expect(expired.some((p) => p.op === "drawImage" && s.fixture.source(p).paints.some((source) => source.op === "fillText"))).toBe(false);
});

test("a hit flashes the chassis white and translates the world while the clip and caller context stay fixed", () => {
  const s = scene(); s.fx.advance(0);
  const whiteBody = (p: Paint) => p.op === "fill" && hasShape(p, "roundRect") && p.fillStyle === "#fff";
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
