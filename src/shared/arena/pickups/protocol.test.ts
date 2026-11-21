import { expect, test } from "bun:test";
import { parseServer, serializeSnapshot, type Snapshot } from "../protocol";
import { createArena, joinPlayer } from "../simulation";
test("snapshot parser bounds floor identities, kinds, locations, timers and active effect maps", () => {
  const arena = createArena(79), player = joinPlayer(arena, { id: crypto.randomUUID(), name: "Pilot", team: "tabs" })!;
  const s: Snapshot = { v: 1, type: "snapshot", arenaId: "test", tick: 10, wave: 1, players: [{ ...player, effects: { shield: 20500 }, ackSeq: 0 }],
    pickups: [{ id: 1, kind: "shield", x: 0, y: 2400, expiresAt: 12500 }], bugs: [], shots: [], events: [] };
  const parse = (s: Snapshot) => parseServer(serializeSnapshot(s));
  expect(parse(s)).not.toBeNull();
  for (const patch of [{ id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { kind: "constructor" }, { kind: "rapid" }, { x: -0.01 }, { y: 2401 }, { x: NaN }, { expiresAt: 500 }, { expiresAt: 12500.01 }, { expiresAt: Infinity }]) {
    const bad = structuredClone(s); Object.assign(bad.pickups[0]!, patch); expect(parse(bad)).toBeNull();
  }
  for (const effects of [undefined, null, [], { rapid: 1000 }, { constructor: 1000 }, { shield: 500 }, { shield: 20500.01 }, { shield: "1000" }, { shield: Infinity }]) {
    const bad = structuredClone(s); bad.players[0]!.effects = effects as any; expect(parse(bad)).toBeNull();
  }
  const bad = structuredClone(s); bad.pickups.push({ ...bad.pickups[0]! }); expect(parse(bad)).toBeNull();
  bad.pickups = Array.from({ length: 7 }, (_, id) => ({ ...s.pickups[0]!, id })); expect(parse(bad)).toBeNull();
  bad.pickups = s.pickups; bad.bugs = [{ id: 1, kind: "crawler", hp: 1, facing: 0, x: 500, y: 500, vx: 0, vy: 0 }]; expect(parse(bad)).toBeNull();
  bad.bugs = []; bad.shots = [{ id: 1, owner: player.id, life: 1, x: 500, y: 500, vx: 900, vy: 0, born: 500 }]; expect(parse(bad)).toBeNull();
  for (const status of ["downed", "out"] as const) { const bad = structuredClone(s); Object.assign(bad.players[0]!, { status, hits: 0, downedUntil: status === "downed" ? 10500 : 0 }); expect(parse(bad)).toBeNull(); }
});
