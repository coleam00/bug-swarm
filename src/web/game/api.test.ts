import { expect, test } from "bun:test";
import { request } from "./api";
test("requests have a deadline even when the transport ignores abort", async () => {
  let signal: AbortSignal | null | undefined;
  const stalled = ((_path: unknown, options?: RequestInit) => { signal = options?.signal; return new Promise<Response>(() => {}); }) as typeof fetch;
  await expect(request("/api/runs", {}, stalled, 5)).rejects.toThrow("timed out");
  expect(signal?.aborted).toBe(true);
});
test("request sends JSON, reads server responses and surfaces errors", async () => {
  const fetcher = (async (_path: unknown, options?: RequestInit) => {
    expect(options?.body).toBe('{"name":"Robot"}'); expect(options?.cache).toBe("no-store");
    return Response.json({ runId: "server" });
  }) as typeof fetch;
  expect(await request("/api/runs", { name: "Robot" }, fetcher)).toEqual({ runId: "server" });
  await expect(request("/api/leaderboard", undefined, async () => new Response("down", { status: 503 }))).rejects.toThrow("503");
});
test("the deadline also covers a response body that never completes", async () => {
  await expect(request("/api/leaderboard", undefined, async () => new Response(new ReadableStream({ start() {} })), 5)).rejects.toThrow("timed out");
});
