import { expect, test } from "bun:test";
import { ArenaRenderer, lifeClock } from "./draw";
import { ArenaInput } from "./input";
import { canvasFixture } from "../game/canvas-fixture.test-support";
import { TEAM_COLOURS } from "../../shared/teams";
import { validateName } from "../../server/rules";
import { PLAYER_RADIUS, HEAT_CAPACITY } from "../../shared/arena/constants";
import { lifeDefaults, type CombatPlayer } from "../../shared/arena/types";
import { cameraFor } from "./camera";
import type { Paint } from "../game/canvas-fixture.test-support";

test("downed robots remain visible with countdown/progress, local copy and remote edge Help; revival removes them", () => {
  const fixture = canvasFixture(), original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => fixture.factory() } });
  try {
    const renderer = new ArenaRenderer(fixture.context as unknown as CanvasRenderingContext2D), input = new ArenaInput();
    const p = { ...lifeDefaults(), status: "downed" as const, hits: 0, downedUntil: 10000, reviveMs: 1000, reviving: true,
      id: "victim", name: "Victim", team: "tabs" as const, x: 200, y: 300, vx: 0, vy: 0, facing: 0 };
    const q = { ...p, id: "remote", x: 1200 };
    const draw = (local: CombatPlayer, remote = [q], now = 0) => {
      fixture.context.paints.length = 0;
      renderer.draw(390, 844, { x: 0, y: 0 }, [local, ...remote], local, input, [], [], 1, 40, now);
      return [...fixture.context.paints];
    };
    const body = (paints: Paint[]) => paints.find(p => p.op === "stroke" && p.path.some(c => c.op === "roundRect"))!;
    const marker = (paints: Paint[]) => paints.find(paint => paint.op === "fillText" && paint.args[1] === p.x && Number(paint.args[2]) > p.y)!;
    const arrows = (paints: Paint[]) => paints.filter(paint => paint.op === "fill" && paint.path[0]?.op === "moveTo" && paint.path.some(c => c.op === "lineTo"));
    const overlay = (paints: Paint[]) => paints.find(paint => paint.op === "fillRect" && Number(paint.args[2]) > 390 / 2 &&
      Number(paint.args[1]) > 78 && Number(paint.args[1]) + Number(paint.args[3]) < p.y);
    const paints = draw(p), panel = overlay(paints);
    expect(panel).toBeDefined();
    expect(paints.filter(paint => paint.op === "fillText" && Number(paint.args[2]) > Number(panel!.args[1]) &&
      Number(paint.args[2]) < Number(panel!.args[1]) + Number(panel!.args[3])).length).toBeGreaterThanOrEqual(2);
    expect(paints.some(paint => paint.op === "fillText" && paint.args[0] === "8s")).toBe(true);
    const rings = paints.filter(p => p.op === "stroke").flatMap(p => p.path.filter(c => c.op === "arc"));
    expect(rings.some(c => Math.abs(Number(c.args[4]) - Number(c.args[3]) - Math.PI) < 1e-8)).toBe(true);
    expect(rings.some(c => Math.abs(Number(c.args[4]) - Number(c.args[3]) - Math.PI * 1.6) < 1e-8)).toBe(true);
    const markerAlphas: number[] = [], arrowAlphas: number[] = [];
    for (const now of [0, 180, 360, 540]) {
      const frame = draw(p, [q], now), help = marker(frame), edge = arrows(frame);
      expect(help).toBeDefined(); expect(edge).toHaveLength(1);
      for (const alpha of [help.globalAlpha, edge[0]!.globalAlpha]) { expect(alpha).toBeGreaterThan(0); expect(alpha).toBeLessThanOrEqual(1); }
      markerAlphas.push(help.globalAlpha); arrowAlphas.push(edge[0]!.globalAlpha);
    }
    expect(Math.max(...markerAlphas) - Math.min(...markerAlphas)).toBeGreaterThan(0.1);
    expect(Math.max(...arrowAlphas) - Math.min(...arrowAlphas)).toBeGreaterThan(0.1);
    for (const position of [{ x: 1200, y: 300 }, { x: 200, y: -1000 }, { x: 200, y: 1844 }]) {
      const edge = arrows(draw(p, [{ ...q, ...position }])); expect(edge).toHaveLength(1);
      expect(edge[0]!.transform[4]).toBeGreaterThanOrEqual(32); expect(edge[0]!.transform[4]).toBeLessThanOrEqual(358);
      expect(edge[0]!.transform[5]).toBeGreaterThanOrEqual(112); expect(edge[0]!.transform[5]).toBeLessThanOrEqual(804);
      if (position.x > 390) expect(edge[0]!.transform[0]).toBeGreaterThan(0);
      if (position.y < 0) expect(edge[0]!.transform[1]).toBeLessThan(0);
      if (position.y > 844) expect(edge[0]!.transform[1]).toBeGreaterThan(0);
    }
    const revived = { ...p, status: "active" as const, hits: 1, downedUntil: 0, reviveMs: 0, reviving: false };
    const active = draw(revived, []), fallenBody = body(paints), activeBody = body(active);
    const aspect = (paint: Paint) => {
      const [a, b, c, d] = paint.transform as [number, number, number, number];
      const x = Math.hypot(a, b), y = Math.hypot(c, d); return Math.min(x, y) / Math.max(x, y);
    };
    expect(aspect(fallenBody)).toBeLessThan(aspect(activeBody) * 0.75);
    expect(fallenBody.globalAlpha).toBeGreaterThan(0); expect(fallenBody.globalAlpha).toBeLessThan(activeBody.globalAlpha);
    expect(overlay(active)).toBeUndefined(); expect(marker(active)).toBeUndefined(); expect(arrows(active)).toHaveLength(0);
    fixture.context.paints.length = 0;
    const out = { ...p, status: "out" as const };
    renderer.draw(390, 844, { x: 0, y: 0 }, [out], null, input);
    expect(fixture.context.paints.some(p => p.op === "drawImage")).toBe(false);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
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
    const hud = first.find(p => p.op === "fillText" && String(p.args[0]).includes("Wave"))!;
    expect(hud.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(first.some(p => p.op === "fillText" && /\b0:00\b/.test(String(p.args[0])))).toBe(true);
    expect(draw(1260).some(p => p.op === "fillText" && /\b1:03\b/.test(String(p.args[0])))).toBe(true);
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

test("life clock uses authoritative ticks, resets on a new life and freezes at the terminal duration", () => {
  const p = { ...lifeDefaults(9600), id: "local", name: "Pilot", team: "tabs" as const, x: 1200, y: 1200, vx: 0, vy: 0, facing: 0 };
  expect(lifeClock(p, 9600)).toBe("0:00"); expect(lifeClock(p, 10860)).toBe("1:03");
  const dead = { ...p, status: "out" as const, hits: 0, result: { playerId: p.id, life: p.life, score: 37, kills: 3, seconds: 63.95, touch: false } };
  expect(lifeClock(dead, 12000)).toBe("1:03");
  expect(lifeClock({ ...p, ...lifeDefaults(12000, 2) }, 12020)).toBe("0:01");
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
      const hud = paints.find(q => q.op === "fillRect" && Number(q.args[2]) > 100 && Number(q.args[3]) > 40 && Number(q.args[3]) < 100)!;
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
    const effectTime = 1_000_000_000, kill = { id: 1, tick: 4, x: 550, y: 550, points: 11 };
    renderer.events([kill], effectTime);
    expect(draw(effectTime / 50).some(paint => paint.op === "fillText" && paint.args[0] === "+11" && paint.globalAlpha > 0)).toBe(true);
    renderer.events([kill], effectTime + 100);
    expect(draw(effectTime / 50 + 15).some(paint => paint.op === "fillText" && paint.args[0] === "+11")).toBe(false);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original); else Reflect.deleteProperty(globalThis, "document");
  }
});
