import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "./server";
import { guardPlaytest } from "./playtest";
test("production instrumentation requires explicit opt-in before SQLite opens; instrumented static/real socket use the normal server", async () => {
  const parent = join(process.cwd(), ".evidence", "86", "tests"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "server-")), assets = join(root, "assets"), data = join(root, "data"); mkdirSync(assets);
  writeFileSync(join(assets, "build.json"), JSON.stringify({ buildId: "playtest-test", playtest: true })); writeFileSync(join(assets, "index.html"), "<title>Test arena</title>");
  writeFileSync(join(assets, "test.js"), "console.log('fixture')");
  let app: ReturnType<typeof createServer> | undefined, socket: WebSocket | undefined;
  try {
    expect(() => createServer({ assets, dataDir: data, env: { NODE_ENV: "production" }, playtest: {} })).toThrow("explicit ARENA_PLAYTEST"); expect(existsSync(data)).toBe(false);
    expect(() => guardPlaytest({ NODE_ENV: "production" }, false, assets)).toThrow();
    let observations = 0;
    app = createServer({ port: 0, hostname: "127.0.0.1", assets, dataDir: data, env: { NODE_ENV: "production", ARENA_PLAYTEST: "1" }, playtest: { observe: () => { observations++; } } });
    expect(await (await fetch(app.server.url + "test.js")).text()).toBe("console.log('fixture')");
    socket = new WebSocket(app.server.url.href.replace("http", "ws") + "ws");
    await new Promise<void>((resolve, reject) => { socket!.onerror = () => reject(Error("socket failed")); socket!.onopen = () => socket!.send(JSON.stringify({ v: 1, type: "hello", playerId: crypto.randomUUID(), name: "Pilot", team: "tabs", touch: false, buildId: "playtest-test" })); socket!.onmessage = event => { if (JSON.parse(String(event.data)).type === "snapshot") resolve(); }; });
    expect(observations).toBeGreaterThan(0);
    expect((await fetch(app.server.url + "api/playtest")).status).toBe(404);
  } finally { socket?.close(); await app?.stop(); rmSync(root, { recursive: true, force: true }); }
});
