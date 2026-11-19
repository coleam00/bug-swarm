import { expect, test } from "bun:test";
import { TEST_SHIELD } from "../../shared/upgrades";
import { createSimulation, IDLE, step } from "./simulation";
import { pick } from "./upgrade-fixture.test-support";

test("shield blocks one, strengthens on repeat picks and caps refills at four; no healing or contact score", () => {
  const s = createSimulation(1); s.spawnIn = s.fireIn = Infinity; s.hits = 1;
  const contact = () => {
    s.bugs.push({ id: s.nextId++, kind: "base", ...s.robot }, { id: s.nextId++, kind: "fast", ...s.robot });
    step(s, IDLE, 0.01);
    const remaining = s.bugs.length;
    s.bugs.length = 0; // Isolate contact probes; persistence is covered in simulation.test.ts.
    return remaining;
  };
  pick(s, TEST_SHIELD); expect(s.shieldCharges).toBe(1);
  expect(contact()).toBe(2); expect(s.shieldCharges).toBe(0); expect(s.hits).toBe(1);
  expect(s.squashes).toBe(0);
  pick(s, TEST_SHIELD); expect(s.shieldCharges).toBe(2);
  contact(); expect(s.shieldCharges).toBe(2); // invulnerable contacts cost nothing
  step(s, IDLE, 0.99); contact(); expect(s.shieldCharges).toBe(1);
  pick(s, TEST_SHIELD); expect(s.shieldCharges).toBe(3); // refill, never add
  for (let i = 0; i < 3; i++) { step(s, IDLE, 1); contact(); }
  expect(s.shieldCharges).toBe(0); expect(s.hits).toBe(1);
  step(s, IDLE, 1); contact(); expect(s.hits).toBe(2); expect(s.dead).toBe(false);
  expect(s.score).toBe(s.seconds);
  pick(s, TEST_SHIELD); expect(s.shieldCharges).toBe(4);
  pick(s, TEST_SHIELD); expect(s.shieldCharges).toBe(4); // full picks cannot grow the cap
  for (let i = 0; i < 4; i++) { step(s, IDLE, 1); contact(); }
  expect(s.shieldCharges).toBe(0);
  pick(s, TEST_SHIELD); expect(s.shieldCharges).toBe(4); // depleted refill retains the cap
  expect(s.upgrades.counts[TEST_SHIELD]).toBe(6); expect(s.hits).toBe(2);
});
