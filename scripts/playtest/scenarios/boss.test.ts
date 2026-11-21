import { test, expect } from "bun:test";
import { hiveBodyInView } from "./boss";
import type { ArenaFrame } from "../../../src/web/arena/observation";
test("hive body checkpoint rejects off-screen ring warnings and respects camera/scale", () => {
  const hive = { kind: "hive", x: 600, y: 250 };
  const frame = { camera: { x: 100, y: 100 }, width: 800, height: 600, scale: 2, paint: { bugs: [hive] } } as unknown as ArenaFrame;
  expect(hiveBodyInView(frame)).toBe(false); // draw dispatched for a ring; body is outside
  hive.x = 250; expect(hiveBodyInView(frame)).toBe(true);
  hive.y = 353; expect(hiveBodyInView(frame)).toBe(false);
  hive.y = 352; expect(hiveBodyInView(frame)).toBe(true);
  hive.y = 180; expect(hiveBodyInView(frame)).toBe(false); // HUD occlusion
  hive.y = 200; hive.x = 430; expect(hiveBodyInView(frame)).toBe(false); // minimap occlusion
  frame.paint.bugs = []; expect(hiveBodyInView(frame)).toBe(false);
});
