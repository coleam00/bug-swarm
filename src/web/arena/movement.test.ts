import { expect, test } from "bun:test";
import { ArenaInput } from "./input";
import { Prediction } from "./prediction";
import { Interpolation } from "./interpolation";
import { cameraFor } from "./camera";
import { movePlayer } from "../../shared/arena/movement";
import { neutralInput, lifeDefaults } from "../../shared/arena/types";
import type { InputMessage, Snapshot } from "../../shared/arena/protocol";
const player = () => ({ ...lifeDefaults(), id: crypto.randomUUID(), name: "Robot", team: "tabs" as const, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 0 });
test("floating stick has a dead zone, analog strength, exclusive left-touch ownership and cancellation", () => {
  const input = new ArenaInput();
  expect(input.down(2, 350, 100, 390)).toBe(true); expect(input.down(1, 50, 200, 390)).toBe(true);
  expect(input.down(3, 100, 250, 390)).toBe(false); input.move(2, 300, 300); expect(input.sample().move).toEqual({ x: 0, y: 0 });
  input.move(1, 56, 200); expect(input.sample().move.x).toBe(0); input.move(1, 83, 200); expect(input.sample().move.x).toBe(0.5);
  input.up(2); expect(input.stick?.id).toBe(1); input.up(1); input.move(1, 300, 200); expect(input.stick).toBeNull();
  input.keys.add("KeyW"); input.keys.add("KeyD"); expect(Math.hypot(input.sample().move.x, input.sample().move.y)).toBeCloseTo(1);
  input.fire = true; const lastAim = input.sample().aim; input.clear(); expect(input.sample()).toEqual({ ...neutralInput(), aim: lastAim });
});
test("prediction converges through delayed acknowledgements, superseded inputs, stops and boundaries", () => {
  const prediction = new Prediction(), p = player(); prediction.reconcile(p);
  const inputs: InputMessage[] = Array.from({ length: 6 }, (_, i) => ({ v: 1, type: "input", life: 1, touch: false, seq: i + 1, move: { x: 1, y: 0 }, aim: 0, fire: false }));
  for (const input of inputs) prediction.advance(input);
  const server = { ...p }; movePlayer(server, inputs[1]!); server.ackSeq = 2;
  prediction.reconcile(server); expect(prediction.pending.map(p => p.seq)).toEqual([3, 4, 5, 6]); expect(prediction.player!.x).toBe(server.x + 36);
  for (const input of inputs.slice(2)) movePlayer(server, input); server.ackSeq = 6;
  prediction.reconcile(server); expect(prediction.player!.x).toBe(server.x); expect(prediction.pending).toHaveLength(0);
  server.x = 2386; prediction.reconcile(server); prediction.advance({ ...inputs[0]!, seq: 7 }); expect(prediction.player!.x).toBe(2386);
  prediction.reset(); expect(prediction.player).toBeNull(); expect(prediction.pending).toHaveLength(0);
});
test("prediction history is bounded", () => {
  const prediction = new Prediction(); prediction.reconcile(player());
  for (let seq = 1; seq <= 120; seq++) expect(prediction.advance({ v: 1, type: "input", life: 1, touch: false, seq, ...neutralInput() })).toBe(true);
  expect(prediction.advance({ v: 1, type: "input", life: 1, touch: false, seq: 121, ...neutralInput() })).toBe(false);
});
test("remote interpolation runs 100ms behind, takes shortest angle, clamps gaps, removes leaves", () => {
  const interpolation = new Interpolation(), p = player();
  const snapshot = (tick: number, x: number, facing = 0): Snapshot => ({ v: 1, type: "snapshot", tick, arenaId: "room", wave: 1, bugs: [], shots: [], events: [], players: [{ ...p, x, facing }] });
  interpolation.push(snapshot(1, 100, Math.PI - 0.1), 50); interpolation.push(snapshot(3, 200, -Math.PI + 0.1), 150);
  expect(interpolation.players(200)[0]!.x).toBe(150); expect(interpolation.players(200)[0]!.facing).toBeCloseTo(Math.PI);
  expect(interpolation.players(10000)[0]!.x).toBe(200);
  interpolation.push(snapshot(2, 50), 200); expect(interpolation.players(10000)[0]!.x).toBe(200);
  interpolation.push({ ...snapshot(4, 0), players: [] }, 200); expect(interpolation.players(200)).toHaveLength(0);
  interpolation.clear(); expect(interpolation.players(300)).toHaveLength(0);
});
test("camera follows and stops at all world edges in desktop and phone viewports", () => {
  expect(cameraFor(1200, 1200, 1000, 800)).toEqual({ x: 700, y: 800 });
  expect(cameraFor(0, 0, 390, 844)).toEqual({ x: 0, y: 0 });
  expect(cameraFor(2400, 2400, 844, 390)).toEqual({ x: 1556, y: 2010 });
});
test("twin sticks retain sides across crossing, independent release, dead zone and mouse/Space OR", () => {
  const input = new ArenaInput(); input.down(1, 40, 200, 390); input.down(2, 350, 200, 390);
  input.move(1, 400, 200); input.move(2, 100, 100);
  expect(input.sample().move.x).toBe(1); expect(input.sample().fire).toBe(true); expect(input.sample().aim).toBeCloseTo(Math.atan2(-100, -250));
  input.up(1); expect(input.sample().move.x).toBe(0); expect(input.sample().fire).toBe(true);
  input.move(2, 354, 200); expect(input.sample().fire).toBe(false); input.up(2);
  input.fire = true; input.keys.add("Space"); input.fire = false; expect(input.sample().fire).toBe(true);
  input.fire = true; input.keys.delete("Space"); expect(input.sample().fire).toBe(true);
  let camera = 0; input.mouse = { x: 100, y: 50 }; input.resolveAim = (x, y) => Math.atan2(y - 100, x + camera - 100);
  expect(input.sample().aim).toBeCloseTo(-Math.PI / 2); camera = 50; expect(input.sample().aim).toBeCloseTo(-Math.PI / 4);
  input.clear(); expect(input.sample().fire).toBe(false);
});
