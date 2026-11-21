import { expect, test } from "bun:test";
import { ArenaResults } from "./results";
import type { LifeOver } from "../../shared/arena/protocol";
import type { ScoresApi } from "../api";

function fixture() {
  const requests = { best: [] as any[], standing: [] as any[], teams: [] as any[] };
  const api = Object.fromEntries(Object.keys(requests).map(field => [field, () => new Promise((resolve, reject) => requests[field as keyof typeof requests].push({ resolve, reject }))])) as unknown as Pick<ScoresApi, keyof typeof requests>;
  const timers = new Map<number, () => void>(), updates: any[] = [], logs: any[] = [];
  let id = 0;
  const controller = new ArenaResults("pilot", api, view => updates.push(view), {
    schedule: (fn, ms) => { expect(ms).toBe(2000); timers.set(++id, fn); return id; }, cancel: id => { timers.delete(id as number); },
  }, (...args) => logs.push(args));
  const show = (save: LifeOver["save"], life = 1) => controller.show({ v: 1, type: "life_over", playerId: "pilot", life, score: 99, kills: 1, seconds: 10, touch: false, reason: "death", save });
  const poll = () => { const [id, fn] = [...timers][0]!; timers.delete(id); fn(); };
  const settle = () => Promise.resolve();
  return { controller, requests, timers, updates, logs, show, poll, settle };
}
test("terminal saves gate independent server reads, failures recover and duplicate notices don't restart polling", async () => {
  const f = fixture(); f.show("pending");
  expect(f.controller.view!.result.score).toBe(99); expect(f.requests.best).toHaveLength(0); expect(f.timers.size).toBe(0);
  f.show("failed"); f.show("failed"); expect(f.requests.best).toHaveLength(1); expect(f.timers.size).toBe(1);
  f.requests.best[0].resolve({ best: null }); f.requests.standing[0].reject(Error("offline")); f.requests.teams[0].resolve({ tabs: 0, spaces: 0 }); await f.settle();
  expect(f.controller.view).toMatchObject({ best: null, bestStatus: "ready", standingStatus: "failed", teamsStatus: "ready", teamTotals: { tabs: 0, spaces: 0 }, result: { save: "failed" } });
  f.poll(); f.requests.standing[1].reject(Error("still offline")); await f.settle(); expect(f.logs).toHaveLength(1);
  f.show("saved"); expect(f.controller.view).toMatchObject({ bestStatus: "loading", standingStatus: "loading", teamsStatus: "loading" });
  expect(f.requests.best).toHaveLength(3); expect(f.timers.size).toBe(1);
  f.requests.best[2].resolve({ best: 120 }); f.requests.standing[2].resolve({ rank: 2, total: 20, next: { rank: 1, pointsToBeat: 10 } }); await f.settle();
  expect(f.controller.view).toMatchObject({ best: 120, bestStatus: "ready", standingStatus: "ready" });
  f.requests.best[1].resolve({ best: 1 }); await f.settle(); expect(f.controller.view!.best).toBe(120);
  f.controller.dispose(); expect(f.timers.size).toBe(0);
});
test("out-of-order reads, respawn, replacement, reconnect with life 1 and disposal fence both successes and failures", async () => {
  const f = fixture(); f.show("saved"); f.poll();
  f.requests.best[1].resolve({ best: 80 }); await f.settle();
  f.requests.best[0].resolve({ best: 1000 }); await f.settle(); expect(f.controller.view!.best).toBe(80);
  f.controller.show(null); expect(f.controller.view).toBeNull(); expect(f.timers.size).toBe(0);
  f.show("saved"); f.requests.standing[1].reject(Error("stale")); f.requests.teams[0].resolve({ tabs: 1, spaces: 2 }); await f.settle();
  expect(f.logs).toHaveLength(0); expect(f.controller.view!.teamsStatus).toBe("loading");
  f.show("saved", 2); f.requests.best[2].resolve({ best: 100 }); await f.settle(); expect(f.controller.view!.bestStatus).toBe("loading");
  f.controller.dispose(); const count = f.updates.length;
  f.requests.best[3].reject(Error("disposed")); f.requests.teams[3].resolve({ tabs: 50, spaces: 20 }); await f.settle();
  expect(f.updates).toHaveLength(count); expect(f.logs).toHaveLength(0); expect(f.timers.size).toBe(0);
});
test("reads slower than the polling cadence still display and failed fields recover on a later poll", async () => {
  const f = fixture(); f.show("saved"); f.poll();
  f.requests.best[0].resolve({ best: 60 }); f.requests.standing[0].reject(Error("offline")); await f.settle();
  expect(f.controller.view).toMatchObject({ best: 60, bestStatus: "ready", standingStatus: "failed" });
  f.requests.standing[1].resolve({ rank: 1, total: 1, next: null }); await f.settle();
  expect(f.controller.view).toMatchObject({ best: 60, standingStatus: "ready", standing: { rank: 1 } });
  f.requests.teams[1].resolve({ tabs: 10, spaces: 5 }); await f.settle();
  f.requests.teams[0].reject(Error("old failure")); await f.settle();
  expect(f.controller.view).toMatchObject({ teamsStatus: "ready", teamTotals: { tabs: 10, spaces: 5 } });
  expect(f.logs).toHaveLength(1); f.controller.dispose();
});
