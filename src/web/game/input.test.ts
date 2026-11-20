import { expect, test } from "bun:test";
import { keyboardInput, mapPointer, PointerControl, touchInput, viewport } from "./input";
import { createSimulation, IDLE } from "./simulation";
import { FixedStepper } from "./loop";

test.each([
  { arena: { width: 450, height: 800 }, screen: [390, 844], points: [
    [0, 226 / 3, 0, 0], [390, 2306 / 3, 450, 800], [78, 746 / 3, 90, 200], [195, 422, 225, 400], [-100, 900, 0, 800],
  ] },
  { arena: { width: 800, height: 450 }, screen: [844, 390], points: [
    [226 / 3, 0, 0, 0], [2306 / 3, 390, 800, 450], [746 / 3, 78, 200, 90], [422, 195, 400, 225], [-100, 900, 0, 450],
  ] },
  { arena: { width: 450, height: 800 }, screen: [844, 390], points: [
    [312.3125, 0, 0, 0], [531.6875, 390, 450, 800], [356.1875, 97.5, 90, 200], [422, 195, 225, 400], [844, -10, 450, 0],
  ] },
])("pointer maps independent screen coordinates for $arena in $screen", ({ arena, screen, points }) => {
  const v = viewport(screen[0]!, screen[1]!, arena);
  for (const [x, y, expectedX, expectedY] of points) {
    const point = mapPointer(x!, y!, v);
    expect(point.x).toBeCloseTo(expectedX!, 6); expect(point.y).toBeCloseTo(expectedY!, 6);
  }
});

test("portrait and landscape use the same centered logical arena and clamp outside points", () => {
  expect(mapPointer(195, 350, viewport(390, 700))).toEqual({ x: 300, y: 300 });
  expect(mapPointer(350, 195, viewport(700, 390))).toEqual({ x: 300, y: 300 });
  expect(mapPointer(155, 0, viewport(700, 390))).toEqual({ x: 0, y: 0 });
  expect(mapPointer(545, 390, viewport(700, 390))).toEqual({ x: 600, y: 600 });
  expect(mapPointer(0, 155, viewport(390, 700))).toEqual({ x: 0, y: 0 });
  expect(mapPointer(390, 545, viewport(390, 700))).toEqual({ x: 600, y: 600 });
  expect(mapPointer(-100, 900, viewport(390, 700))).toEqual({ x: 0, y: 600 });
});
test("WASD and arrows produce equivalent inputs and opposing keys cancel", () => {
  const target = { x: 0, y: 0 };
  for (const [key, x, y] of [
    ["w", 0, -1], ["a", -1, 0], ["s", 0, 1], ["d", 1, 0],
    ["arrowup", 0, -1], ["arrowleft", -1, 0], ["arrowdown", 0, 1], ["arrowright", 1, 0],
  ] as const) expect(keyboardInput(new Set([key]), null)).toEqual({ x, y, target: null });
  expect(keyboardInput(new Set(["w", "d"]), target)).toEqual({ x: 1, y: -1, target });
  expect(keyboardInput(new Set(["arrowup", "arrowright"]), target)).toEqual({ x: 1, y: -1, target });
  expect(keyboardInput(new Set(["a", "d"]), null).x).toBe(0);
});
test("fixed loop caps catch-up at five steps and visibility reset drops elapsed time", () => {
  const loop = new FixedStepper(), state = createSimulation(1);
  loop.advance(0, state, IDLE); loop.advance(10000, state, IDLE);
  expect(state.time).toBeCloseTo(5 / 60);
  loop.reset(); loop.advance(20000, state, IDLE); expect(state.time).toBeCloseTo(5 / 60);
  loop.advance(20000 + 1000 / 60, state, IDLE); expect(state.time).toBeCloseTo(6 / 60);
});

test("touch has a radial dead zone, continuous speed and normalized direction in every quadrant", () => {
  for (const [dx, dy] of [[0, 0], [5, 0], [0, -6], [3.6, 4.8]]) expect(touchInput(dx!, dy!)).toEqual(IDLE);
  expect(touchInput(6.01, 0).speed).toBeCloseTo(0.00018518518518518518, 10);
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [-0.6, 0.8], [0.6, -0.8], [-0.6, -0.8]]) {
    for (const [radius, speed] of [[19.5, 0.25], [33, 0.5], [46.5, 0.75], [60, 1], [150, 1]]) {
      const input = touchInput(x! * radius!, y! * radius!);
      expect(input.x).toBeCloseTo(x!); expect(input.y).toBeCloseTo(y!);
      expect(Math.hypot(input.x, input.y)).toBeCloseTo(1);
      expect(input.speed).toBeCloseTo(speed!); expect(input.target).toBeNull();
    }
  }
});

test("first pointer fixes the origin, clamps the knob and ignores every non-owner event", () => {
  const p = new PointerControl();
  expect(p.down(7, "touch", 140, 500)).toBe(true);
  expect(p.input).toEqual(IDLE); expect(p.joystick).toEqual({ x: 140, y: 500, dx: 0, dy: 0 });
  p.move(7, 230, 620);
  expect(p.joystick).toEqual({ x: 140, y: 500, dx: 36, dy: 48 });
  expect(p.input).toEqual({ x: 0.6, y: 0.8, speed: 1, target: null });
  const before = structuredClone(p);
  expect(p.down(8, "touch", 0, 0)).toBe(false);
  for (const type of ["touch", "mouse", "pen"]) {
    expect(p.down(8, type, 0, 0)).toBe(false); p.move(8, -100, -100);
    expect(p.release(8)).toBe(false); expect({ ...p }).toEqual(before);
  }
  p.move(7, 173, 500); expect(p.input.speed).toBe(0.5);
  p.move(7, 140, 500); expect(p.input).toEqual(IDLE);
  expect(p.release(7)).toBe(true); expect(p.joystick).toBeNull();
  p.move(8, 200, 500); p.move(7, 200, 500);
  expect(p.id).toBeNull(); expect(p.input).toEqual(IDLE);
  expect(p.down(8, "touch", -20, 60)).toBe(true);
  p.move(8, -80, 60); expect(p.input.x).toBe(-1);
  p.reset(); expect(p.id).toBeNull(); expect(p.type).toBeNull(); expect(p.joystick).toBeNull(); expect(p.input).toEqual(IDLE);
});
