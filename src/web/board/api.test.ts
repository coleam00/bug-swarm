import { expect, test } from "bun:test";
import { boardApi } from "./api";

test("board stats reads the existing endpoint with the shared uncached GET client", async () => {
  const original = globalThis.fetch;
  const calls: { path: unknown; init?: RequestInit }[] = [];
  const stats = { totalPlayers: 25, arenas: [{ id: "internal-room", players: 25 }] };
  globalThis.fetch = (async (path, init) => {
    calls.push({ path, init });
    return Response.json(stats);
  }) as typeof fetch;
  try {
    expect(await boardApi.stats()).toEqual(stats);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/api/arena/stats");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(calls[0]?.init?.cache).toBe("no-store");
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  } finally { globalThis.fetch = original; }
});
