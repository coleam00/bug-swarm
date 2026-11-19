import { expect, test } from "bun:test";
import { ARENA_SIZE } from "./config";
import { Renderer } from "./draw";
import { Effects } from "./fx";
import { createSimulation } from "./simulation";
import { canvasFixture, type Paint } from "./canvas-fixture.test-support";

function scene() {
  const fixture = canvasFixture(), renderer = new Renderer(fixture.context as unknown as CanvasRenderingContext2D, fixture.factory);
  const state = createSimulation(1), fx = new Effects();
  renderer.resize(ARENA_SIZE, ARENA_SIZE, 1);
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
  return paint.op === "drawImage" && Number(paint.args[3]) < ARENA_SIZE &&
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
  const arenaImages = images.filter((p) => Number(p.args[3]) >= ARENA_SIZE && Number(p.args[4]) >= ARENA_SIZE);
  expect(arenaImages.some((p) => s.fixture.source(p).paints.some((source) => source.op === "stroke" && hasShape(source, "lineTo")))).toBe(true);
  expect(arenaImages.some((p) => s.fixture.source(p).paints.some((source) => typeof source.fillStyle !== "string"))).toBe(true);
  expect(paints.some((p) => p.op === "clip" && hasShape(p, "rect"))).toBe(true);
});

test("robot has a filled rounded chassis, cached core glow and bright core", () => {
  const s = scene(), paints = s.render(), { x, y } = s.state.robot;
  expect(paints.some((p) => p.op === "fill" && at(p, x, y) && hasShape(p, "roundRect"))).toBe(true);
  expect(paints.some((p) => glow(s, p) && imageCentre(p)[0] === x && imageCentre(p)[1] === y)).toBe(true);
  expect(paints.some((p) => p.op === "fill" && at(p, x, y) && hasShape(p, "arc"))).toBe(true);
});

test("beetles face the robot and animate their articulated legs with visual time", () => {
  const s = scene(); s.state.bugs.push({ id: 7, x: 100, y: 100 });
  const beetle = (paints: Paint[]) => paints.find((p) => p.op === "fill" && at(p, 100, 100) && hasShape(p, "ellipse"))!;
  const legs = (paints: Paint[]) => paints.find((p) => p.op === "stroke" && at(p, 100, 100) && p.path.filter((part) => part.op === "lineTo").length >= 6)!;
  const first = s.render(); expect(beetle(first)).toBeDefined(); expect(legs(first)).toBeDefined();
  expect(heading(beetle(first))).toBeCloseTo(Math.atan2(200, 200));
  s.fx.time += 0.1;
  const animated = s.render(); expect(legs(animated).path).not.toEqual(legs(first).path);
  s.state.robot.y = 100;
  const turned = s.render(); expect(heading(beetle(turned))).toBeCloseTo(0);
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
  expect(hit.some((p) => p.op === "drawImage" && Number(p.args[3]) >= ARENA_SIZE && at(p, s.fx.shake.x, s.fx.shake.y))).toBe(true);
  expect(hit.find((p) => p.op === "clip")!.transform).toEqual([1, 0, 0, 1, 0, 0]);
  s.fixture.context.fillRect(0, 0, 1, 1);
  expect(s.fixture.context.paints.at(-1)!.transform).toEqual([1, 0, 0, 1, 0, 0]);
  s.fx.advance(80); s.fx.advance(160); s.fx.advance(240);
  const recovered = s.render(); expect(recovered.some(whiteBody)).toBe(false);
  expect(recovered.find((p) => p.op === "drawImage" && Number(p.args[3]) >= ARENA_SIZE)!.transform).toEqual([1, 0, 0, 1, 0, 0]);
});
