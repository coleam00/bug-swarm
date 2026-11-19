import { expect, test } from "bun:test";
import { keyboardInput, mapPointer, viewport } from "./input";
import { createSimulation, IDLE } from "./simulation";
import { FixedStepper } from "./loop";

test("portrait and landscape use the same centered logical arena and clamp outside points", () => {
  expect(mapPointer(195, 350, viewport(390, 700))).toEqual({ x: 300, y: 300 });
  expect(mapPointer(350, 195, viewport(700, 390))).toEqual({ x: 300, y: 300 });
  expect(mapPointer(-100, 900, viewport(390, 700))).toEqual({ x: 0, y: 600 });
});
test("WASD and arrows produce equivalent inputs and opposing keys cancel", () => {
  const target = { x: 0, y: 0 };
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
