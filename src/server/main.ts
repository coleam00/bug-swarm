import { join } from "node:path";
import { serveStatic } from "hono/bun";
import { createApp, resolveClientIp } from "./app";
import { readConfig } from "./config";
import { openDb } from "./db";

// Production mode: one process serves the API and the built UI from dist/.
const { port, dataDir, hostname } = readConfig(process.env);
const db = openDb(join(dataDir, "app.db"));
const peers = new WeakMap<Request, string>();
const trusted = (process.env.TRUSTED_PROXIES ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const app = createApp(db, { clientIp: (request) => resolveClientIp(
  peers.get(request) ?? "unknown", request.headers.get("x-forwarded-for"), trusted,
) });
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

Bun.serve({ port, hostname, fetch(request, server) {
  peers.set(request, server?.requestIP(request)?.address ?? "unknown");
  return app.fetch(request);
} });
console.log(`App on http://${hostname}:${port}`);
