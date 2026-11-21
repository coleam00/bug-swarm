import { expect, test } from "bun:test";
import { createArena, endLife, joinPlayer, respawnPlayer, stepArena } from "./simulation";
import { downPlayer } from "./revive";
import { DOWNED_MS, REVIVE_MS, STEP_MS } from "./constants";
import { neutralInput, type ArenaState, type Input } from "./types";
import { crawler } from "./bugs/crawler";

function fixture() {
  const a = createArena(1), p = joinPlayer(a, { id: "victim", name: "Victim", team: "tabs" })!;
  const q = joinPlayer(a, { id: "rescuer", name: "Rescuer", team: "spaces" })!;
  Object.assign(p, { x: 1200, y: 1200, hits: 1, spawnProtectedUntil: 0, score: 37, points: 370, streak: 7, kills: 3, touch: true });
  Object.assign(q, { x: 1600, y: 1200 });
  a.bugs = [{ id: 99, kind: "crawler", x: p.x, y: p.y, vx: 0, vy: 0 }];
  stepArena(a, new Map()); a.bugs = [];
  return { a, p, q };
}
function steps(a: ArenaState, n: number, inputs = new Map<string, Input>()) {
  for (let i = 0; i < n; i++) { a.bugs = []; stepArena(a, inputs); }
}

test("third hit downs for a full ten seconds, cancels shots without a miss, and blocks play/respawn", () => {
  const { a, p, q } = fixture();
  expect(p).toMatchObject({ status: "downed", hits: 0, downedUntil: STEP_MS + DOWNED_MS, reviveMs: 0, reviving: false, vx: 0, vy: 0, score: 37, streak: 7 });
  expect(a.ended).toHaveLength(0); expect(respawnPlayer(a, p.id, p.life)).toBeNull();
  p.heat = 12;
  steps(a, 1, new Map([[p.id, { move: { x: 1, y: 0 }, aim: 2, fire: true }]]));
  expect(p.x).toBe(1200); expect(p.facing).toBe(0); expect(p.heat).toBeCloseTo(11.7); expect(a.shots).toHaveLength(0);
  expect(a.spawnCredits.has(p.id)).toBe(false);
  const b = { id: 999, kind: "crawler" as const, x: 1200, y: 1200, vx: 0, vy: 0 };
  crawler.move(b, [p, q]); expect(b.vx).toBe(140); crawler.move(b, [p]); expect(b.vx).toBe(0);
});

test("inclusive 90-unit contact accumulates across gaps and different teams, without stacking", () => {
  const { a, p, q } = fixture(), r = joinPlayer(a, { id: "a", name: "Second", team: "tabs" })!;
  Object.assign(q, { x: 1290 }); Object.assign(r, { x: 1200, y: 1110 });
  steps(a, 20); expect(p.reviveMs).toBe(1000); expect(p.reviving).toBe(true);
  q.x = 1290.001; r.y = 1109.999; steps(a, 10);
  expect(p.reviveMs).toBe(1000); expect(p.reviving).toBe(false);
  q.x = 1290; steps(a, 19); expect(p.status).toBe("downed"); expect(p.reviveMs).toBe(1950);
  r.y = 1110; steps(a, 1);
  expect(p).toMatchObject({ status: "active", hits: 1, life: 1, score: 37, points: 370, streak: 7, kills: 3, touch: true, startedTick: 0, reviveMs: 0, downedUntil: 0, reviving: false });
  expect(r.score).toBe(50); expect(r.points).toBe(500); expect(r.kills).toBe(0); expect(r.streak).toBe(0); expect(q.score).toBe(0);
  expect(a.ended).toHaveLength(0); expect(a.events).toHaveLength(0);
  expect(p.immuneUntil).toBe(a.tick * STEP_MS + 1500);
});

test("timeout ends the life once; exact deadline completion succeeds", () => {
  for (const contactSteps of [39, 40]) {
    const { a, p, q } = fixture();
    steps(a, DOWNED_MS / STEP_MS - contactSteps); expect(p.status).toBe("downed");
    q.x = p.x; steps(a, contactSteps - 1); expect(p.status).toBe("downed");
    steps(a, 1); expect(p.status).toBe(contactSteps === 40 ? "active" : "out");
    expect(a.ended).toHaveLength(contactSteps === 40 ? 0 : 1);
    if (p.status === "out") {
      expect(a.ended[0]).toMatchObject({ score: 37, seconds: 10.05, life: 1 });
      expect(endLife(a, p.id)).toBeNull(); steps(a, 1); expect(a.ended).toHaveLength(0);
      expect(respawnPlayer(a, p.id, 1)?.life).toBe(2);
    }
  }
});

test("no contact on the damaging step; no self/downed rescue or same-step rescue chains", () => {
  const { a, p, q } = fixture(); q.x = p.x;
  const r = joinPlayer(a, { id: "third", name: "Third", team: "tabs" })!;
  Object.assign(r, { x: 1120, y: 1200 }); q.x = 1280;
  downPlayer(a, r); p.reviveMs = REVIVE_MS - STEP_MS; r.reviveMs = REVIVE_MS - STEP_MS;
  steps(a, 1); expect(p.status).toBe("active"); expect(r.status).toBe("downed"); expect(r.reviveMs).toBe(1950);
  steps(a, 1); expect(r.status).toBe("active"); expect(p.score).toBe(87); expect(q.score).toBe(50);
  downPlayer(a, p); downPlayer(a, q); downPlayer(a, r); steps(a, 3); expect(p.reviveMs).toBe(0);
  const single = createArena(2), solo = joinPlayer(single, { id: "solo", name: "Solo", team: "tabs" })!;
  Object.assign(solo, { hits: 1, spawnProtectedUntil: 0 });
  single.bugs = [{ id: 1, kind: "crawler", x: solo.x, y: solo.y, vx: 0, vy: 0 }];
  stepArena(single, new Map()); expect(solo.reviveMs).toBe(0);
});

test("post-damage eligibility excludes a rescuer who goes down that step", () => {
  const { a, p, q } = fixture(); p.reviveMs = 1950;
  Object.assign(q, { x: p.x, hits: 1, spawnProtectedUntil: 0 });
  a.bugs = [{ id: 1, kind: "crawler", x: q.x, y: q.y, vx: 0, vy: 0 }]; stepArena(a, new Map());
  expect(q.status).toBe("downed"); expect(p.status).toBe("downed"); expect(p.reviveMs).toBe(1950); expect(q.reviveMs).toBe(0);
});

test("revival immunity lasts exactly 1.5 seconds even when firing; repeated downing resets progress", () => {
  const { a, p, q } = fixture(); q.x = p.x; steps(a, 40);
  const immuneUntil = p.immuneUntil;
  const inputs = new Map([[p.id, { ...neutralInput(), fire: true, aim: Math.PI }]]);
  for (let i = 0; i < 30; i++) {
    a.bugs = [{ id: 9000, kind: "crawler", x: p.x, y: p.y + 20, vx: 0, vy: 0 }];
    stepArena(a, inputs); expect(p.status).toBe("active"); expect(p.immuneUntil).toBe(immuneUntil);
  }
  expect(a.tick * STEP_MS).toBe(immuneUntil);
  const streak = p.streak;
  a.bugs = [{ id: 9001, kind: "crawler", x: p.x, y: p.y + 20, vx: 0, vy: 0 }]; stepArena(a, inputs);
  expect(p.status).toBe("downed"); expect(p.reviveMs).toBe(0); expect(p.reviving).toBe(false);
  expect(p.streak).toBe(streak); expect(a.shots).toHaveLength(0); expect(a.spawnCredits.has(p.id)).toBe(false);
  expect(p.downedUntil).toBe(a.tick * STEP_MS + DOWNED_MS);
});

test("revive reward remains in points after a later accuracy-multiplied kill; one rescuer can help several", () => {
  const { a, p, q } = fixture(), r = joinPlayer(a, { id: "second", name: "Second", team: "tabs" })!;
  Object.assign(r, { x: p.x, y: p.y }); downPlayer(a, r); q.x = p.x;
  steps(a, 40); expect(q.score).toBe(100); expect(p.status).toBe("active"); expect(r.status).toBe("active");
  q.streak = 10;
  a.bugs = [{ id: 9000, kind: "crawler", x: q.x + 25, y: q.y, vx: 0, vy: 0 }];
  stepArena(a, new Map([[q.id, { ...neutralInput(), fire: true }]]));
  expect(q.points).toBe(1210); expect(q.score).toBe(121); expect(q.kills).toBe(1);
});

test("revival resumes personal threat at the original life age without accumulated spawn debt", () => {
  const { a, p, q } = fixture(); a.tick = 1200; p.status = "active"; p.hits = 1;
  a.spawnCredits.set(p.id, 99); downPlayer(a, p); q.x = p.x;
  steps(a, 40); expect(p.status).toBe("active"); expect(p.startedTick).toBe(0);
  expect(a.spawnCredits.has(p.id)).toBe(false);
  steps(a, 1); expect(a.spawnCredits.get(p.id)).toBeGreaterThan(0.21); expect(a.spawnCredits.get(p.id)).toBeLessThan(0.22);
  expect(a.bugs).toHaveLength(0);
});
