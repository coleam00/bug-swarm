import type { Best, Leader, Standing, TeamTotals } from "../shared/api";

export interface ScoresApi {
  best(playerId: string): Promise<Best>;
  standing(playerId: string): Promise<Standing>;
  leaders(): Promise<Leader[]>;
  teams(): Promise<TeamTotals>;
}
export async function request<T>(path: string, fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch, timeout = 5000): Promise<T> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(new Error("Request timed out")); }, timeout);
  });
  try {
    const operation = async () => {
      const response = await fetcher(path, {
        method: "GET", cache: "no-store", signal: abort.signal,
      });
      if (!response.ok) {
        const message = await response.text();
        throw new Error(`API ${response.status}: ${message}`);
      }
      return await response.json() as T;
    };
    return await Promise.race([operation(), deadline]);
  } finally { clearTimeout(timer!); }
}
export const api: ScoresApi = {
  best: (id) => request(`/api/players/${id}/best`),
  standing: (id) => request(`/api/players/${id}/standing`),
  leaders: () => request("/api/leaderboard"),
  teams: () => request("/api/teams"),
};
