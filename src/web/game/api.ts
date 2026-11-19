import type { Best, Finish, Identity, Leader, RunStarted, Saved, TeamTotals } from "../../shared/api";

export interface GameApi {
  start(identity: Identity): Promise<RunStarted>;
  finish(runId: string, result: Finish): Promise<Saved>;
  best(playerId: string): Promise<Best>;
  leaders(): Promise<Leader[]>;
  teams(): Promise<TeamTotals>;
}
export async function request<T>(path: string, body?: unknown, fetcher: (input: string, init?: RequestInit) => Promise<Response> = fetch, timeout = 5000): Promise<T> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { abort.abort(); reject(new Error("Request timed out")); }, timeout);
  });
  try {
    const operation = async () => {
      const response = await fetcher(path, {
        method: body === undefined ? "GET" : "POST", cache: "no-store", signal: abort.signal,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
      return await response.json() as T;
    };
    return await Promise.race([operation(), deadline]);
  } finally { clearTimeout(timer!); }
}
export const api: GameApi = {
  start: (identity) => request("/api/runs", identity),
  finish: (id, finish) => request(`/api/runs/${id}/finish`, finish),
  best: (id) => request(`/api/players/${id}/best`),
  leaders: () => request("/api/leaderboard"),
  teams: () => request("/api/teams"),
};
