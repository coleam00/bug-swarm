import { join } from "node:path";
import { serveStatic } from "hono/bun";
import { createApp, resolveClientIp, START_LIMIT } from "./app";
import { readConfig } from "./config";
import { openDb } from "./db";

// Production mode: one process serves the API and the built UI from dist/.
const { port, dataDir, hostname, startLimit } = readConfig(process.env);
if (startLimit > START_LIMIT) console.warn(`LOAD TEST: start limit raised to ${startLimit} per IP per ten minutes. Unset LOAD_TEST_START_LIMIT before serving players.`);
const db = openDb(join(dataDir, "app.db"));
const peers = new WeakMap<Request, string>();
const trusted = (process.env.TRUSTED_PROXIES ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const app = createApp(db, { startLimit, clientIp: (request) => resolveClientIp(
  peers.get(request) ?? "unknown", request.headers.get("x-forwarded-for"), trusted,
) });
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

Bun.serve({ port, hostname, fetch(request, server) {
  peers.set(request, server?.requestIP(request)?.address ?? "unknown");
  return app.fetch(request);
} });
console.log(`App on http://${hostname}:${port}`);
