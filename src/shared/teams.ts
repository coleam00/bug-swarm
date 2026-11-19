export const TEAMS = ["tabs", "spaces"] as const;
export type Team = (typeof TEAMS)[number];
export const TEAM_NAMES: Record<Team, string> = { tabs: "Tabs", spaces: "Spaces" };
export const TEAM_COLOURS: Record<Team, string> = { tabs: "#ff9f43", spaces: "#2ed3c6" };
export function isTeam(value: unknown): value is Team {
  return TEAMS.some(team => team === value);
}
