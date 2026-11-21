import { expect, test } from "bun:test";
import { applyLeaders, applyStats, applyTeams, displayScore, exactScore, expireHighlights, highlightDeadline, initialState, readLeaders, readStats, readTeams } from "./model";

const entry = (playerId: string, score = 42, name = "Robot") => ({ playerId, name, score });
const populations = (players: number[]) => players.map((players, index) => ({ id: `room-${index}`, players }));

test("activity distinguishes loading from zero and keeps the authoritative total, numbering before population sorting", () => {
  expect(initialState().stats.data).toBeNull();
  expect(applyStats(initialState(), { totalPlayers: 0, arenas: [] }).stats).toEqual({
    data: { totalPlayers: 0, arenas: [], moreArenas: 0 }, failed: false,
  });
  const input = { totalPlayers: 1000, arenas: populations([7, 18, 18]) };
  const original = structuredClone(input);
  const activity = readStats(input);
  expect(activity.totalPlayers).toBe(1000);
  expect(activity.arenas.map(({ number, players }) => [number, players])).toEqual([[2, 18], [3, 18], [1, 7]]);
  expect(input).toEqual(original);
});

test.each([0, 8, 9, 10])("activity caps %i arenas at eight after sorting and counts the omitted arenas", count => {
  const input = { totalPlayers: count, arenas: populations(Array.from({ length: count }, (_, i) => i)) };
  const activity = readStats(input);
  expect(activity.arenas.map(arena => arena.number)).toEqual(Array.from({ length: Math.min(count, 8) }, (_, i) => count - i));
  expect(activity.moreArenas).toBe(Math.max(0, count - 8));
});

test("activity rejects malformed counts and ids throughout the snapshot, including omitted arenas", () => {
  const valid = { totalPlayers: 25, arenas: populations([20, 5]) };
  for (const totalPlayers of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "25", null, undefined]) {
    expect(() => readStats({ ...valid, totalPlayers })).toThrow();
  }
  for (const arena of [null, {}, { id: "", players: 1 }, { id: "  ", players: 1 }, { id: 42, players: 1 },
    ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined].map(players => ({ id: "bad", players }))]) {
    expect(() => readStats({ ...valid, arenas: [...populations(Array(8).fill(20)), arena] })).toThrow();
  }
  for (const value of [null, [], {}, { ...valid, arenas: null }, { ...valid, arenas: {} },
    { ...valid, arenas: [valid.arenas[0], valid.arenas[0]] }]) {
    expect(() => readStats(value)).toThrow();
  }
  expect(readStats({ totalPlayers: Number.MAX_SAFE_INTEGER, arenas: [{ id: "room", players: 0 }], tick: {} }).totalPlayers).toBe(Number.MAX_SAFE_INTEGER);
});
test("mapping preserves server order, ties and duplicate names, caps at ten and ranks by position", () => {
  const input = Array.from({ length: 12 }, (_, i) => entry(String(i), i < 2 ? 50 : 90));
  const rows = applyLeaders(initialState(), input, 100).leaders.data!;
  expect(rows.map(row => row.playerId)).toEqual(input.slice(0, 10).map(row => row.playerId));
  expect(rows.map(row => row.score)).toEqual(input.slice(0, 10).map(row => row.score));
  expect(rows.map(row => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(rows.every(row => row.name === "Robot" && row.highlightUntil === 0)).toBe(true);
});

test("missing data differs from empty rows and neutral zero totals; positive bars use all team points", () => {
  let state = initialState();
  expect(state.leaders.data).toBeNull(); expect(state.teams.data).toBeNull();
  state = applyLeaders(state, [], 0);
  state = applyTeams(state, { tabs: 0, spaces: 0 }, 0);
  expect(state.leaders.data).toEqual([]);
  expect(state.teams.data?.shares).toEqual({ tabs: 0.5, spaces: 0.5 });
  state = applyTeams(state, { tabs: 1, spaces: 3 }, 0);
  expect(state.teams.data?.shares).toEqual({ tabs: 0.25, spaces: 0.75 });
  expect(applyTeams(state, { tabs: 0, spaces: 99 }, 0).teams.data?.shares).toEqual({ tabs: 0, spaces: 1 });
  expect(applyTeams(state, { tabs: 0, spaces: 0 }, 0).teams.data?.totals).toEqual({ tabs: 0, spaces: 0 });
  expect(applyLeaders(applyLeaders(state, [entry("a")], 0), [], 1).leaders.data).toEqual([]);
});

test("only arrivals after initial hydration highlight; identities survive score and rank changes", () => {
  let state = applyLeaders(initialState(), [entry("a"), entry("b")], 100);
  state = applyLeaders(state, [entry("b", 99), entry("a"), entry("c")], 200);
  expect(state.leaders.data?.map(row => row.highlightUntil)).toEqual([0, 0, 3200]);
  state = applyLeaders(state, [entry("c", 100), entry("b")], 1000);
  expect(state.leaders.data?.map(row => row.highlightUntil)).toEqual([3200, 0]);
  state = applyLeaders(state, [entry("a"), entry("c")], 2000);
  expect(state.leaders.data?.map(row => row.highlightUntil)).toEqual([5000, 3200]);
  expect(highlightDeadline(state)).toBe(3200);
  state = expireHighlights(state, 3200);
  expect(state.leaders.data?.map(row => row.highlightUntil)).toEqual([5000, 0]);
  expect(highlightDeadline(expireHighlights(state, 5000))).toBeNull();
  const emptyBaseline = applyLeaders(initialState(), [], 0);
  expect(applyLeaders(emptyBaseline, [entry("a")], 2).leaders.data?.[0]?.highlightUntil).toBe(3002);
});

test.each([
  { totals: [[0, 0], [1, 0]], highlights: [0, 0] },
  { totals: [[1, 0], [1, 1], [1, 2]], highlights: [0, 3002] },
  { totals: [[1, 0], [1, 1], [2, 1]], highlights: [0, 0] },
  { totals: [[0, 1], [1, 1], [2, 1]], highlights: [3002, 0] },
  { totals: [[0, 1], [1, 1], [1, 2]], highlights: [0, 0] },
  { totals: [[1, 0], [0, 1]], highlights: [0, 3001] },
  { totals: [[0, 1], [1, 0]], highlights: [3001, 0] },
])("overtakes retain the last non-tied leader: $totals", ({ totals, highlights }) => {
  let state = initialState();
  totals.forEach(([tabs, spaces], i) => { state = applyTeams(state, { tabs, spaces }, i); });
  expect(Object.values(state.teams.data!.highlightUntil)).toEqual([...highlights]);
  const repeated = applyTeams(state, state.teams.data!.totals, 1000);
  expect(repeated.teams.data?.highlightUntil).toEqual(state.teams.data?.highlightUntil);
  expect(expireHighlights(state, 4000).teams.data?.highlightUntil).toEqual({ tabs: 0, spaces: 0 });
});

test("malformed snapshots are rejected in full, including unsafe names and duplicate ids", () => {
  for (const value of [null, {}, [null], [entry("a", -1)], [entry("a", 1.1)], [entry("a", Infinity)],
    [entry("a", Number.MAX_SAFE_INTEGER + 1)], [entry("a", 1, "<img src=x>")], [entry("a", 1, "shit")],
    ...["nigga", "f u c k", "fuuuck", "cole medin", "admin"].map(name => [entry("a", 1, name)]),
    [entry("a", 1, "a")], [entry("")], [entry("a"), entry("a")]]) {
    expect(() => readLeaders(value)).toThrow();
  }
  for (const value of [null, [], {}, { tabs: 0 }, { tabs: -1, spaces: 0 }, { tabs: 1, spaces: "2" }, { tabs: NaN, spaces: 0 }]) {
    expect(() => readTeams(value)).toThrow();
  }
  expect(readLeaders([entry("a", 0, " Good Robot ")])[0]?.name).toBe("Good Robot");
  for (const name of ["Scunthorpe", "Hancock", "Annalise", "Jason", "therapist"]) {
    expect(readLeaders([entry("a", 1, name)])[0]?.name).toBe(name);
  }
});

test("score formatting is deterministic, compact above 999999, and keeps exact accessible values", () => {
  expect(displayScore(0)).toBe("0"); expect(displayScore(999999)).toBe("999,999");
  expect(displayScore(1000000)).toBe("1M"); expect(displayScore(1234567)).toBe("1.2M");
  expect(exactScore(1234567)).toBe("1,234,567");
  expect(displayScore(Number.MAX_SAFE_INTEGER).length).toBeLessThan(10);
});
