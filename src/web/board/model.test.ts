import { expect, test } from "bun:test";
import { applyLeaders, applyTeams, displayScore, exactScore, expireHighlights, highlightDeadline, initialState, readLeaders, readTeams } from "./model";

const entry = (playerId: string, score = 42, name = "Robot") => ({ playerId, name, score });
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
    [entry("a", 1, "a")], [entry("")], [entry("a"), entry("a")]]) {
    expect(() => readLeaders(value)).toThrow();
  }
  for (const value of [null, [], {}, { tabs: 0 }, { tabs: -1, spaces: 0 }, { tabs: 1, spaces: "2" }, { tabs: NaN, spaces: 0 }]) {
    expect(() => readTeams(value)).toThrow();
  }
  expect(readLeaders([entry("a", 0, " Good Robot ")])[0]?.name).toBe("Good Robot");
});

test("score formatting is deterministic, compact above 999999, and keeps exact accessible values", () => {
  expect(displayScore(0)).toBe("0"); expect(displayScore(999999)).toBe("999,999");
  expect(displayScore(1000000)).toBe("1M"); expect(displayScore(1234567)).toBe("1.2M");
  expect(exactScore(1234567)).toBe("1,234,567");
  expect(displayScore(Number.MAX_SAFE_INTEGER).length).toBeLessThan(10);
});
