import type { Leader, TeamTotals } from "../../shared/api";
import { TEAMS, type Team } from "../../shared/teams";
import { validateName } from "../../server/rules";

export const HIGHLIGHT_MS = 3000;
export interface Row extends Leader { rank: number; highlightUntil: number }
export interface Race {
  totals: TeamTotals;
  shares: TeamTotals;
  highlightUntil: TeamTotals;
}
export interface Lane<T> { data: T | null; failed: boolean }
export interface BoardState {
  leaders: Lane<Row[]>;
  teams: Lane<Race>;
  lastLeader: Team | null;
}
export const initialState = (): BoardState => ({
  leaders: { data: null, failed: false }, teams: { data: null, failed: false }, lastLeader: null,
});
const isScore = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function readLeaders(value: unknown): Leader[] {
  if (!Array.isArray(value)) throw new Error("Invalid leaderboard");
  const ids = new Set<string>();
  const leaders = value.map((row: unknown) => {
    if (!row || typeof row !== "object") throw new Error("Invalid leaderboard row");
    const entry = row as Leader;
    const name = validateName(entry.name);
    if (typeof entry.playerId !== "string" || !entry.playerId.trim() || ids.has(entry.playerId) || name.error || !isScore(entry.score)) {
      throw new Error("Invalid leaderboard row");
    }
    ids.add(entry.playerId);
    return { playerId: entry.playerId, name: name.name!, score: entry.score };
  });
  return leaders.slice(0, 10);
}

export function readTeams(value: unknown): TeamTotals {
  if (!value || typeof value !== "object" || !TEAMS.every(team => isScore((value as TeamTotals)[team]))) {
    throw new Error("Invalid team totals");
  }
  return { tabs: (value as TeamTotals).tabs, spaces: (value as TeamTotals).spaces };
}

export function applyLeaders(state: BoardState, value: unknown, now: number): BoardState {
  const previous = state.leaders.data;
  const byId = new Map(previous?.map(row => [row.playerId, row]));
  const rows = readLeaders(value).map((row, index) => ({
    ...row, rank: index + 1,
    highlightUntil: byId.get(row.playerId)?.highlightUntil ?? (previous === null ? 0 : now + HIGHLIGHT_MS),
  }));
  return { ...state, leaders: { data: rows, failed: false } };
}

export function applyTeams(state: BoardState, value: unknown, now: number): BoardState {
  const totals = readTeams(value), sum = totals.tabs + totals.spaces;
  const leader = totals.tabs === totals.spaces ? null : totals.tabs > totals.spaces ? TEAMS[0] : TEAMS[1];
  const highlights = { ...(state.teams.data?.highlightUntil ?? { tabs: 0, spaces: 0 }) };
  if (leader && state.lastLeader && state.lastLeader !== leader) highlights[leader] = now + HIGHLIGHT_MS;
  return {
    ...state, lastLeader: leader ?? state.lastLeader,
    teams: { failed: false, data: { totals, shares: sum ? { tabs: totals.tabs / sum, spaces: totals.spaces / sum } : { tabs: 0.5, spaces: 0.5 }, highlightUntil: highlights } },
  };
}

export function highlightDeadline(state: BoardState): number | null {
  const deadlines = [
    ...(state.leaders.data?.map(row => row.highlightUntil) ?? []),
    ...Object.values(state.teams.data?.highlightUntil ?? {}),
  ].filter(deadline => deadline > 0);
  return deadlines.length ? Math.min(...deadlines) : null;
}

export function expireHighlights(state: BoardState, now: number): BoardState {
  const expire = (deadline: number) => deadline <= now ? 0 : deadline;
  return {
    ...state,
    leaders: { ...state.leaders, data: state.leaders.data?.map(row => ({ ...row, highlightUntil: expire(row.highlightUntil) })) ?? null },
    teams: { ...state.teams, data: state.teams.data ? {
      ...state.teams.data, highlightUntil: { tabs: expire(state.teams.data.highlightUntil.tabs), spaces: expire(state.teams.data.highlightUntil.spaces) },
    } : null },
  };
}

const integer = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
export const exactScore = (score: number) => integer.format(score);
export const displayScore = (score: number) => score <= 999_999 ? exactScore(score) : compact.format(score);
