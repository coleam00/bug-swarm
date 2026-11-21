import { expect, test } from "bun:test";
import { FirstLifeHint, HINT_KEY, type HintView } from "./hint";
import { lifeDefaults } from "../../shared/arena/types";
import { FakeScheduler } from "../board/polling.test-support";

function fixture(storage?: () => Storage, memory = { seen: false, logged: false }) {
  const clock = new FakeScheduler(), views: HintView[] = [], values = new Map<string, string>(), errors: unknown[] = [];
  const hint = new FirstLifeHint(view => views.push(view), storage ?? (() => ({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } })),
    { now: clock.now, schedule: clock.setTimeout, cancel: clock.clearTimeout }, memory, (...args) => errors.push(args));
  return { hint, clock, views, values, errors, memory };
}
test("only a living snapshot consumes onboarding; natural protection expiry keeps it until six seconds", async () => {
  const f = fixture(), p = lifeDefaults();
  expect(f.values.size).toBe(0); f.hint.dismiss(); expect(f.memory.seen).toBe(false);
  f.hint.observe({ ...p, hits: 0 }, false); expect(f.values.size).toBe(0);
  f.hint.observe(p, false); expect(f.values.get(HINT_KEY)).toBe("1");
  expect(f.views).toEqual([{ touch: false, fading: false }]);
  await f.clock.tick(5999); f.hint.observe(p, false); expect(f.views).toHaveLength(1);
  await f.clock.tick(1); expect(f.views.at(-1)).toEqual({ touch: false, fading: true });
  await f.clock.tick(200); expect(f.views.at(-1)).toBeNull();
  f.hint.observe(lifeDefaults(200, 2), true); expect(f.views).toHaveLength(3);
});
test("actual touch changes visible copy; a confirmed shot fades even if no projectile survives a snapshot", async () => {
  const f = fixture(), p = lifeDefaults();
  f.hint.observe(p, false); f.hint.observe(p, true);
  expect(f.views.at(-1)).toEqual({ touch: true, fading: false });
  f.hint.observe({ ...p, spawnProtectedUntil: 0 }, true);
  expect(f.views.at(-1)?.fading).toBe(true);
  await f.clock.tick(200); expect(f.views.at(-1)).toBeNull();
});
test("death, disconnect and effect cleanup dismiss without rearming; saved or failed storage suppresses later lives", () => {
  for (const death of [true, false]) {
    const f = fixture(); f.hint.observe(lifeDefaults(), true);
    if (death) f.hint.observe({ ...lifeDefaults(), hits: 0 }, true); else f.hint.dismiss();
    expect(f.views.at(-1)).toBeNull(); f.hint.observe(lifeDefaults(300, 2), false); expect(f.views).toHaveLength(2);
  }
  const memory = { seen: false, logged: false }, blocked = () => { throw Error("blocked"); };
  const first = fixture(blocked, memory); first.hint.observe(lifeDefaults(), false); first.hint.dismiss();
  expect(first.errors).toHaveLength(1);
  const second = fixture(blocked, memory); second.hint.observe(lifeDefaults(), false); expect(second.views).toHaveLength(0); expect(second.errors).toHaveLength(0);
  const saved = fixture(() => ({ getItem: () => "1", setItem() {} }) as unknown as Storage);
  saved.hint.observe(lifeDefaults(), false); expect(saved.views).toHaveLength(0);
});
