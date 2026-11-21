import { expect, test } from "bun:test";
import { createArena, joinPlayer, leavePlayer, stepArena } from "./simulation";
import { MAX_PLAYERS, PLAYER_RADIUS, PLAYER_SPEED, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "./constants";
import { clampMove } from "./movement";
import { neutralInput } from "./types";
const identity = (i = 0) => ({ id: String(i), name: `bot-${i}`, team: "tabs" as const });
test("seeded joins reproduce, vary across seeds and cannot overwrite players", () => {
  const a = createArena(42), b = createArena(42);
  for (let i = 0; i < MAX_PLAYERS; i++) expect(joinPlayer(a, identity(i))).toEqual(joinPlayer(b, identity(i)));
  const positions = new Set(Array.from({ length: 10 }, (_, seed) => { const p = joinPlayer(createArena(seed), identity(0))!; return `${p.x},${p.y}`; }));
  expect(positions.size).toBeGreaterThan(1);
  expect(joinPlayer(a, identity(21))).toBeNull(); expect(joinPlayer(a, identity(0))).toBeNull();
  leavePlayer(a, "3"); expect(a.players.has("3")).toBe(false); expect(a.slots.has("3")).toBe(false);
  expect(joinPlayer(a, identity(21))).not.toBeNull(); expect(a.players.size).toBe(MAX_PLAYERS);
});
test("fixed steps preserve analog magnitude, clamp diagonals/extreme inputs and normalize facing", () => {
  const a = createArena(1), p = joinPlayer(a, identity())!, start = { ...p };
  stepArena(a, new Map([[p.id, { move: { x: 0.5, y: 0 }, aim: 9 * Math.PI, fire: true }]]));
  expect(a.tick).toBe(1); expect(p.x - start.x).toBeCloseTo(PLAYER_SPEED * STEP_MS / 2000); expect(p.vx).toBe(90);
  expect(Math.abs(p.facing)).toBeCloseTo(Math.PI);
  const diagonal = clampMove(Number.MAX_VALUE, Number.MAX_VALUE); expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(1);
  expect(clampMove(1, 1)).toEqual(diagonal); expect(clampMove(0.2, 0.3)).toEqual({ x: 0.2, y: 0.3 });
  for (const move of [{ x: 3, y: 4 }, { x: -3, y: -4 }, { x: Number.MAX_VALUE, y: Number.MAX_VALUE }]) {
    const x = p.x, y = p.y;
    stepArena(a, new Map([[p.id, { move, aim: 0, fire: false }]]));
    expect(Math.hypot(p.x - x, p.y - y)).toBeCloseTo(PLAYER_SPEED * STEP_MS / 1000);
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(PLAYER_SPEED);
  }
  const before = { ...p }; stepArena(a, new Map([[p.id, { ...neutralInput(), fire: true }]]));
  expect(p.x).toBe(before.x); expect(p.y).toBe(before.y);
});
test.each([[PLAYER_RADIUS, 100, -1, 0], [WORLD_WIDTH - PLAYER_RADIUS, 100, 1, 0], [100, PLAYER_RADIUS, 0, -1], [100, WORLD_HEIGHT - PLAYER_RADIUS, 0, 1]])("world edge %j clamps center and actual velocity", (x, y, dx, dy) => {
  const a = createArena(1), p = joinPlayer(a, identity())!; p.x = x!; p.y = y!;
  stepArena(a, new Map([[p.id, { move: { x: dx!, y: dy! }, aim: 0, fire: false }]]));
  expect(p.x).toBe(x); expect(p.y).toBe(y); expect(p.vx).toBe(0); expect(p.vy).toBe(0);
});
