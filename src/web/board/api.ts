import { api, request, type ScoresApi } from "../api";

export interface ArenaStats {
  totalPlayers: number;
  arenas: { id: string; players: number }[];
}
export interface BoardApi extends Pick<ScoresApi, "leaders" | "teams"> {
  stats(): Promise<ArenaStats>;
}
export const boardApi: BoardApi = {
  leaders: api.leaders,
  teams: api.teams,
  stats: () => request("/api/arena/stats"),
};
