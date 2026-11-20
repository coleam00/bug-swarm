import { expect, test } from "bun:test";
import { Session } from "./session";
import { SteeringHint, SteeringHintMemory, STEERING_HINT_KEY } from "./steering-hint";
import { FakeTiming } from "./timing.test-support";
import { openChoice } from "./upgrades";

function fixture(memory?: SteeringHintMemory) {
  const time = new FakeTiming(), data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const session = new Session({ playerId: crypto.randomUUID(), name: "Robot" }, {
    start: () => new Promise(() => {}), finish: async () => ({ saved: true, held: false }),
    standing: async () => ({ rank: null, total: 0, next: null }),
    best: async () => ({ best: null }), leaders: async () => [], teams: async () => ({ tabs: 0, spaces: 0 }),
  }, () => 1, undefined, undefined, undefined, undefined, time);
  const hint = new SteeringHint(memory ?? new SteeringHintMemory(() => storage), time);
  const changes: boolean[] = [];
  return { time, data, storage, session, hint, changes, attach: () => hint.attach(session, visible => changes.push(visible)) };
}

test("entry does not consume eligibility; a local start persists separately without waiting for the API", () => {
  const h = fixture(), detach = h.attach();
  try {
    expect(h.hint.visible).toBe(false); expect(h.data.size).toBe(0);
    h.session.start();
    expect(h.hint.visible).toBe(true); expect(h.data.get(STEERING_HINT_KEY)).toBe("1");
    expect(h.hint.pending(h.session.view.token)).toBe(true);
    // A fresh controller/page uses the persisted value.
    const reload = fixture(new SteeringHintMemory(() => h.storage)); reload.session.start();
    const cleanup = reload.attach(); expect(reload.hint.visible).toBe(false); cleanup();
  } finally { detach(); }
});

test("expiry is inclusive at four wall seconds, including early timers and a throttled foreground return", () => {
  const h = fixture(); h.session.start(); const detach = h.attach();
  try {
    h.time.advance(1000);
    const [id, timer] = [...h.time.pending][0]!; h.time.pending.delete(id); timer.callback();
    expect(h.time.pending.size).toBe(1);
    h.time.advance(2999); expect(h.hint.visible).toBe(true);
    h.time.advance(1); expect(h.hint.visible).toBe(false); expect(h.time.pending.size).toBe(0);
  } finally { detach(); }
  const background = fixture(); background.session.start(); const cleanup = background.attach();
  background.time.time = 9000; background.hint.refresh();
  expect(background.hint.visible).toBe(false); expect(background.time.pending.size).toBe(0); cleanup();
});

test("actual movement dismisses once for the original token; stale callbacks and restart cannot rearm", () => {
  const h = fixture(); h.session.start(); const detach = h.attach();
  try {
    const callback = [...h.time.pending.values()][0]!.callback;
    h.hint.moved(0); expect(h.hint.visible).toBe(true);
    h.hint.moved(1); h.hint.moved(1); callback();
    expect(h.changes.filter(value => !value)).toHaveLength(1);
    expect(h.time.pending.size).toBe(0);
    h.session.start(); expect(h.hint.pending(2)).toBe(false); expect(h.hint.visible).toBe(false);
  } finally { detach(); }
});

test.each(["death", "choice", "replacement"])("%s ends the hint and its timer", reason => {
  const h = fixture(); h.session.start(); const detach = h.attach();
  try {
    if (reason === "death") h.session.end();
    else if (reason === "choice") { openChoice(h.session.current!.simulation.upgrades); h.session.publishChoice(); }
    else h.session.start();
    expect(h.hint.visible).toBe(false); expect(h.hint.pending(1)).toBe(false);
  } finally { detach(); }
  expect(h.time.pending.size).toBe(0);
});

test("Strict Mode detach cancels work; reattach keeps the original token and remaining deadline", () => {
  const h = fixture(); h.session.start(); let detach = h.attach();
  const stale = [...h.time.pending.values()][0]!.callback;
  h.time.advance(1500); detach(); expect(h.time.pending.size).toBe(0);
  h.time.advance(1000); detach = h.attach(); stale();
  expect(h.hint.visible).toBe(true); expect(h.time.pending.size).toBe(1);
  h.time.advance(1499); expect(h.hint.visible).toBe(true);
  h.time.advance(1); expect(h.hint.visible).toBe(false); detach();
  const late = fixture(); late.session.start(); late.attach()(); late.time.advance(5000);
  const cleanup = late.attach(); expect(late.hint.visible).toBe(false); cleanup();
});

test.each(["getter", "read", "write"])("storage %s failure logs once and suppresses repeats for the page", failure => {
  const logs: unknown[] = [];
  const memory = new SteeringHintMemory(() => {
    if (failure === "getter") throw Error("blocked getter");
    return { getItem: () => { if (failure === "read") throw Error("blocked read"); return null; },
      setItem: () => { throw Error("blocked write"); } };
  }, (...args) => logs.push(args));
  expect(memory.consume()).toBe(true); expect(memory.consume()).toBe(false);
  expect(logs).toHaveLength(1);
  const h = fixture(memory); h.session.start(); const detach = h.attach();
  expect(h.hint.visible).toBe(false); detach(); expect(logs).toHaveLength(1);
});
