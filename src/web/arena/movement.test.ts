import { expect, test } from "bun:test";
import { ArenaInput } from "./input";
import { Prediction } from "./prediction";
import { Interpolation } from "./interpolation";
import { cameraFor } from "./camera";
import { movePlayer } from "../../shared/arena/movement";
import { neutralInput, lifeDefaults } from "../../shared/arena/types";
import type { InputMessage, Snapshot } from "../../shared/arena/protocol";
import { createArena, joinPlayer, stepArena } from "../../shared/arena/simulation";
import { createBug } from "../../shared/arena/bugs/registry";
const player = () => ({ ...lifeDefaults(), id: crypto.randomUUID(), name: "Robot", team: "tabs" as const, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0, ackSeq: 0 });

test("glob birth, one-snapshot travel, removal and +5 share the monotonic delayed clock", () => {
  const interpolation = new Interpolation();
  const snapshot = (tick: number): Snapshot => ({ pickups: [], v: 1, type: "snapshot", arenaId: "room", tick, wave: 4, players: [], bugs: [], shots: [],
    globs: tick === 2 ? [{ id: 1, x: 100, y: 100, vx: 320, vy: 0, born: 100 }] : [],
    events: tick === 4 ? [{ id: 2, tick: 4, x: 132, y: 100, type: "glob-pop", points: 5 }] : [] });
  interpolation.push(snapshot(1), 50); interpolation.push(snapshot(2), 100); interpolation.push(snapshot(4), 200);
  expect(interpolation.combat(175).globs).toHaveLength(0);
  expect(interpolation.combat(200).globs[0]!.x).toBe(100);
  expect(interpolation.combat(250).globs[0]!.x).toBe(116);
  expect(interpolation.combat(275).globs[0]!.x).toBe(124); expect(interpolation.combat(275).events).toHaveLength(0);
  const end = interpolation.combat(300); expect(end.globs).toHaveLength(0); expect(end.events[0]!.type).toBe("glob-pop");
  expect(interpolation.combat(250).globs).toHaveLength(0); expect(interpolation.combat(350).events).toHaveLength(0);
});

test("glob extrapolation clips at expiry and world exit; swell never emits predicted entities", () => {
  for (const x of [100, 2390]) {
    const interpolation = new Interpolation(), b = createBug("spitter", 3, 800, 100, 0); Object.assign(b, { phase: "swell", phaseUntil: 2200 });
    const s: Snapshot = { pickups: [], v: 1, type: "snapshot", arenaId: "room", tick: 39, wave: 4, players: [], bugs: [b], shots: [], events: [], globs: [{ id: 1, x, y: 100, vx: 320, vy: 0, born: x === 100 ? 0 : 1950 }] };
    interpolation.push(s, 1950); interpolation.push({ ...s, tick: 45, bugs: [], globs: [] }, 2250);
    const view = interpolation.combat(2075); expect(view.globs[0]!.x).toBe(x + 8); expect(view.bugs[0]!.phase).toBe("swell");
    expect(interpolation.combat(2100).globs).toHaveLength(0);
    expect(interpolation.combat(2300).globs).toHaveLength(0);
  }
});

function dasherHistory() {
  const arena = createArena(71), p = joinPlayer(arena, { id: "a", name: "Pilot", team: "tabs" })!;
  p.x = p.y = 1200;
  const bug = createBug("dasher", arena.nextId++, 960, 1200); arena.bugs.push(bug);
  const snapshot = (): Snapshot => structuredClone({ globs: [], v: 1, type: "snapshot", pickups: [], arenaId: "gap", tick: arena.tick, wave: arena.wave,
    players: [{ ...p, ackSeq: 0 }], bugs: arena.bugs, shots: arena.shots, events: arena.events });
  const advance = () => { stepArena(arena, new Map()); if (arena.tick === 1) p.y = 1400; return snapshot(); };
  return { arena, p, bug, snapshot, advance };
}

test.each([13, 21])("committed dash stays on its authoritative path across a gap from tick %i into recovery", start => {
  const f = dasherHistory(), history = new Map<number, Snapshot>();
  while (f.arena.tick < 29) { const s = f.advance(); history.set(s.tick, s); }
  const interpolation = new Interpolation(); interpolation.push(history.get(start)!, start * 50); interpolation.push(history.get(29)!, 1450);
  for (let tick = start; tick <= 29; tick++) {
    const rendered = interpolation.combat(tick * 50 + 100).bugs[0]!, actual = history.get(tick)!.bugs[0]!;
    expect(rendered.x).toBeCloseTo(actual.x); expect(rendered.y).toBeCloseTo(actual.y);
    if (tick <= 23) { expect(rendered.y).toBe(1200); expect(rendered.facing).toBe(0); }
    expect(rendered.phase).toBe(actual.phase);
  }
});

test("committed wind-up and dash advance before a lethal removal, with the kill effect at removal time", () => {
  const f = dasherHistory(), history = new Map<number, Snapshot>(); f.bug.hp = 1;
  while (f.arena.tick < 18) {
    if (f.arena.tick === 17) f.arena.shots.push({ id: f.arena.nextId++, owner: f.p.id, life: f.p.life,
      x: f.bug.x, y: f.bug.y, vx: 900, vy: 0, born: 850 });
    const s = f.advance(); history.set(s.tick, s);
  }
  const removed = history.get(18)!; expect(removed.bugs).toHaveLength(0); expect(removed.events[0]!.type).toBe("kill");
  const interpolation = new Interpolation(); interpolation.push(history.get(13)!, 650); interpolation.push(removed, 900);
  for (const tick of [13, 14, 15, 16, 17]) {
    const combat = interpolation.combat(tick * 50 + 100), actual = history.get(tick)!.bugs[0]!;
    expect(combat.bugs[0]!.x).toBeCloseTo(actual.x); expect(combat.bugs[0]!.y).toBe(actual.y);
    expect(combat.bugs[0]!.phase).toBe(actual.phase); expect(combat.events).toHaveLength(0);
  }
  expect(interpolation.combat(1000)).toMatchObject({ bugs: [], events: removed.events });
  expect(interpolation.combat(1001).events).toHaveLength(0);
});

test("a committed diagonal dash stops at the first world edge across skipped snapshots", () => {
  const f = dasherHistory();
  Object.assign(f.bug, { x: 2390, y: 1200, phase: "dash", phaseUntil: 450, facing: Math.PI / 4,
    vx: 490 / Math.sqrt(2), vy: 490 / Math.sqrt(2) });
  const first = f.snapshot(); while (f.arena.tick < 13) f.advance();
  const interpolation = new Interpolation(); interpolation.push(first, 0); interpolation.push(f.snapshot(), 650);
  const wall = interpolation.combat(200).bugs[0]!;
  expect(wall.x).toBe(2400); expect(wall.y).toBeCloseTo(1210); expect(wall.phase).toBe("dash"); expect(wall.vx).toBe(0); expect(wall.vy).toBe(0);
});

test("delayed dasher timeline holds wind-up through gaps and keeps HP/facing and hit sparks at their snapshot", () => {
  const interpolation = new Interpolation(), b = createBug("dasher", 1, 100, 100);
  Object.assign(b, { phase: "windup", phaseUntil: 700 });
  const snapshot = (tick: number): Snapshot => ({ globs: [], v: 1, type: "snapshot", pickups: [], arenaId: "room", tick, wave: 3, players: [], shots: [], bugs: [{ ...b }], events: [] });
  interpolation.push(snapshot(12), 600);
  Object.assign(b, { x: 149, vx: 490, phase: "dash", phaseUntil: 1150, hp: 1 });
  interpolation.push({ ...snapshot(16), events: [{ id: 2, tick: 16, x: 149, y: 100, kind: "dasher", type: "hit", points: 0 }] }, 800);
  const early = interpolation.combat(750); expect(early.bugs[0]!.x).toBe(100); expect(early.bugs[0]!.phase).toBe("windup"); expect(early.bugs[0]!.hp).toBe(2); expect(early.events).toHaveLength(0);
  const travelling = interpolation.combat(850); expect(travelling.bugs[0]).toMatchObject({ hp: 2, facing: 0, phase: "dash", phaseUntil: 1150 }); expect(travelling.bugs[0]!.x).toBeCloseTo(124.5);
  const hit = interpolation.combat(900); expect(hit.bugs[0]).toMatchObject({ x: 149, hp: 1, phase: "dash" }); expect(hit.events).toHaveLength(1);
  expect(interpolation.combat(901).events).toHaveLength(0); interpolation.clear(); expect(interpolation.combat(1000).bugs).toHaveLength(0);
});
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

test("same-life down/revive clears movement history and correction, and never interpolates across status", () => {
  const prediction = new Prediction(), p = player(), interpolation = new Interpolation();
  const snapshot = (tick: number, current: typeof p): Snapshot => ({ globs: [], v: 1, type: "snapshot", pickups: [], arenaId: "room", tick, wave: 1, players: [current], bugs: [], shots: [], events: [] });
  prediction.reconcile(p); prediction.advance({ v: 1, type: "input", seq: 1, life: 1, touch: false, move: { x: 1, y: 0 }, aim: 0, fire: true });
  interpolation.push(snapshot(1, p), 0);
  const downed = { ...p, status: "downed" as const, hits: 0, x: 1201, downedUntil: 10050, reviveMs: 1000, reviving: true };
  prediction.reconcile(downed); expect(prediction.pending).toHaveLength(0);
  expect(prediction.visual({ move: { x: 1, y: 0 }, aim: 1, fire: true }, 1, 1)?.x).toBe(1201);
  interpolation.push(snapshot(2, downed), 50); expect(interpolation.players(50)[0]).toMatchObject(downed);
  const revived = { ...p, hits: 1, x: 1201 };
  prediction.reconcile(revived); expect(prediction.visual(neutralInput(), 1, 1)?.x).toBe(1201);
  interpolation.push(snapshot(3, revived), 100); expect(interpolation.players(100)[0]?.x).toBe(1201);
});
test("remote interpolation runs 100ms behind, takes shortest angle, clamps gaps, removes leaves", () => {
  const interpolation = new Interpolation(), p = player();
  const snapshot = (tick: number, x: number, facing = 0): Snapshot => ({ globs: [], v: 1, type: "snapshot", pickups: [], tick, arenaId: "room", wave: 1, bugs: [], shots: [], events: [], players: [{ ...p, x, facing }] });
  interpolation.push(snapshot(1, 100, Math.PI - 0.1), 50);
  const latest = snapshot(3, 200, -Math.PI + 0.1); latest.players[0]!.spawnProtectedUntil = 0;
  interpolation.push(latest, 150);
  expect(interpolation.players(200)[0]!.x).toBe(150); expect(interpolation.players(200)[0]!.facing).toBeCloseTo(Math.PI);
  expect((interpolation.players(200)[0] as typeof p).spawnProtectedUntil).toBe(0);
  expect(interpolation.players(10000)[0]!.x).toBe(200);
  interpolation.push(snapshot(2, 50), 200); expect(interpolation.players(10000)[0]!.x).toBe(200);
  interpolation.push({ ...snapshot(4, 0), players: [] }, 200); expect(interpolation.players(200)).toHaveLength(0);
  interpolation.clear(); expect(interpolation.players(300)).toHaveLength(0);
});
test("arriving shots and bugs stay on the delayed timeline without reversing as history arrives", () => {
  const interpolation = new Interpolation(), p = player();
  const snapshot = (tick: number): Snapshot => ({ globs: [], v: 1, type: "snapshot", pickups: [], tick, arenaId: "room", wave: 1, players: [p], events: [],
    shots: tick < 2 ? [] : [{ id: 1, owner: p.id, life: 1, born: 50, x: 100 + (tick - 2) * 45, y: 100, vx: 900, vy: 0 }],
    bugs: tick < 2 ? [] : [{ id: 2, kind: "crawler", hp: 1, facing: 0, x: 100 + (tick - 2) * 7, y: 100, vx: 140, vy: 0 }] });
  const positions: number[] = [];
  for (let tick = 1; tick <= 6; tick++) {
    interpolation.push(snapshot(tick), tick * 50);
    for (const now of [tick * 50, tick * 50 + 25]) {
      const shots = interpolation.combat(now).shots, bugs = interpolation.combat(now).bugs;
      if (tick < 4) { expect(shots).toHaveLength(0); expect(bugs).toHaveLength(0); }
      else {
        expect(shots[0]!.x).toBeCloseTo(100 + (tick - 4 + (now % 50) / 50) * 45);
        expect(bugs[0]!.x).toBeCloseTo(100 + (tick - 4 + (now % 50) / 50) * 7);
        positions.push(shots[0]!.x);
      }
    }
  }
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  interpolation.push({ ...snapshot(7), shots: [], globs: [], bugs: [] }, 350);
  expect(interpolation.combat(350).shots).toHaveLength(1); expect(interpolation.combat(350).bugs).toHaveLength(1);
  const removed = interpolation.combat(450); expect(removed.shots).toHaveLength(0); expect(removed.bugs).toHaveLength(0);
  interpolation.clear(); expect(interpolation.combat(1000).shots).toHaveLength(0);
});
test.each([1325, 1360])("a short-lived shot at crawler x=%i has visible travelling frames before its kill", x => {
  const arena = createArena(1), p = joinPlayer(arena, { id: crypto.randomUUID(), name: "Pilot", team: "tabs" })!;
  p.x = p.y = 1200; arena.bugs = [{ id: arena.nextId++, kind: "crawler", hp: 1, facing: 0, x, y: 1200, vx: 0, vy: 0 }];
  const interpolation = new Interpolation();
  const snapshot = (): Snapshot => structuredClone({ globs: [], v: 1, type: "snapshot", pickups: [], arenaId: "short", tick: arena.tick, wave: arena.wave,
    players: [{ ...p, ackSeq: 0 }], bugs: arena.bugs, shots: arena.shots, events: arena.events });
  for (const tick of [8, 9, 10]) { arena.tick = tick; interpolation.push(snapshot(), tick * 50); }
  const positions: number[] = [], effects: { at: number; id: number }[] = [];
  let killedAt = 0;
  for (let now = 500; now <= 900; now += 10) {
    if (now > 500 && now % 50 === 0) {
      stepArena(arena, new Map([[p.id, { ...neutralInput(), fire: now === 550 }]])); interpolation.push(snapshot(), now);
      if (arena.events.length) killedAt = now;
    }
    const combat = interpolation.combat(now);
    if (combat.shots[0]) positions.push(combat.shots[0].x);
    if (killedAt && now < killedAt + 100) { expect(combat.bugs).toHaveLength(1); expect(combat.events).toHaveLength(0); }
    for (const event of combat.events) {
      effects.push({ at: now, id: event.id }); expect(combat.shots).toHaveLength(0); expect(combat.bugs).toHaveLength(0);
    }
  }
  expect(p.score).toBe(11); expect(positions.length).toBeGreaterThan(1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(effects).toHaveLength(1); expect(effects[0]!.at).toBe(x === 1325 ? 700 : 750);
  interpolation.clear();
  interpolation.push({ ...snapshot(), events: [{ id: 1, tick: arena.tick, x: 1300, y: 1200, points: 11, type: "kill" as const, kind: "crawler" as const }] }, 900);
  expect(interpolation.combat(1000).events.map(e => e.id)).toEqual([1]);
  expect(interpolation.combat(1010).events).toHaveLength(0);
});
test("combat does not rewind or replay effects after a delayed next snapshot", () => {
  const interpolation = new Interpolation(), p = player();
  const snapshot = (tick: number): Snapshot => ({ globs: [], v: 1, type: "snapshot", pickups: [], arenaId: "stall", tick, wave: 1, players: [p], bugs: [],
    shots: [{ id: 1, owner: p.id, life: 1, born: 0, x: 100 + tick * 45, y: 100, vx: 900, vy: 0 }],
    events: [{ id: tick + 1, tick, x: 100, y: 100, points: 11, type: "kill", kind: "crawler" }] });
  interpolation.push(snapshot(1), 50); interpolation.push(snapshot(2), 100);
  const caughtUp = interpolation.combat(250); expect(caughtUp.shots[0]!.x).toBe(190); expect(caughtUp.events).toHaveLength(2);
  interpolation.push(snapshot(3), 300);
  expect(interpolation.combat(300).shots[0]!.x).toBe(190); expect(interpolation.combat(300).events).toHaveLength(0);
  const resumed = interpolation.combat(400); expect(resumed.shots[0]!.x).toBe(235); expect(resumed.events.map(e => e.id)).toEqual([4]);
  expect(interpolation.combat(410).events).toHaveLength(0);
});
test("camera follows and reserves feedback clearance at all world edges in desktop and phone viewports", () => {
  expect(cameraFor(1200, 1200, 1000, 800)).toEqual({ x: 700, y: 800 });
  expect(cameraFor(0, 0, 390, 844)).toEqual({ x: -112, y: -144 });
  expect(cameraFor(2400, 2400, 844, 390)).toEqual({ x: 1668, y: 2074 });
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
