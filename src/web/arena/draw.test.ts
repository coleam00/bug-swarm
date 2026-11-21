import { expect, test } from "bun:test";
import { ArenaRenderer } from "./draw";
import { ArenaInput } from "./input";
import { canvasFixture } from "../test-support/canvas-fixture.test-support";
import { TEAM_COLOURS } from "../../shared/teams";
import { validateName } from "../../server/rules";
import { PLAYER_RADIUS, HEAT_CAPACITY } from "../../shared/arena/constants";
import { lifeDefaults } from "../../shared/arena/types";
import { cameraFor } from "./camera";
import type { Paint } from "../test-support/canvas-fixture.test-support";
import { createBug } from "../../shared/arena/bugs/registry";
import type { Snapshot } from "../../shared/arena/protocol";

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
    const body = (paints: Paint[]) => paints.find(p => p.op === "fill" && p.path.some(q => q.op === "moveTo" && q.args[0] === 19))!;
    expect(Math.hypot(body(hot).transform[0]!, body(hot).transform[1]!)).toBeLessThan(Math.hypot(body(ordinary).transform[0]!, body(ordinary).transform[1]!));
    const cached = fixture.created; draw(); expect(fixture.created).toBe(cached);
    b.x = 50; b.facing = 0; expect(draw().some(p => p.op === "stroke" && p.path.some(q => q.op === "lineTo" && q.args[0]! > 200))).toBe(true);
    b.x = 2390; b.facing = 0;
    fixture.context.paints.length = 0; renderer.draw(800, 600, { x: 2000, y: 100 }, [], null, input, [b]);
    expect(fixture.context.paints.some(p => p.op === "stroke" && p.path.length === 2 && p.path[1]!.args[0] === 10)).toBe(true);
    renderer.events([{ id: 2, tick: 1, kind: "dasher", type: "hit", x: 500, y: 500, points: 0 }], 0);
    const spark = draw(); expect(spark.some(p => p.op === "stroke" && p.path.length === 16)).toBe(true);
    expect(spark.some(p => p.op === "fillText" && String(p.args[0]).startsWith("+"))).toBe(false);
    renderer.reset(); expect(draw().some(p => p.op === "stroke" && p.path.length === 16)).toBe(false);
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
    const snapshot: Snapshot = { v: 1, type: "snapshot", arenaId: "room", tick: 1, wave: 19, players, bugs: [], shots: [], events: [] };
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
