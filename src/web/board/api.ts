import { api, request, type GameApi } from "../game/api";

export interface ArenaStats {
  totalPlayers: number;
  arenas: { id: string; players: number }[];
}
export interface BoardApi extends Pick<GameApi, "leaders" | "teams"> {
  stats(): Promise<ArenaStats>;
}
export const boardApi: BoardApi = {
  leaders: api.leaders,
  teams: api.teams,
  stats: () => request("/api/arena/stats"),
};
