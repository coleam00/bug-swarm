import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { serveStatic } from "hono/bun";
import { createApp, resolveClientIp, START_LIMIT } from "./app";
import { readConfig } from "./config";
import { openDb } from "./db";
import { createShareAssets } from "./share-assets";
import { configuredOrigin, renderShareMeta } from "./share-meta";

// Production mode: one process serves the API and the built UI from dist/.
const { port, dataDir, hostname, startLimit, trustProxyHops } = readConfig(process.env);
const publicOrigin = configuredOrigin(process.env);
const shareAssets = createShareAssets();
// Development API startup works without a build; production reads the template once.
const template = existsSync("dist/index.html") ? readFileSync("dist/index.html", "utf8") : undefined;
if (startLimit > START_LIMIT) console.warn(`LOAD TEST: start limit raised to ${startLimit} per IP per ten minutes. Unset LOAD_TEST_START_LIMIT before serving players.`);
const db = openDb(join(dataDir, "app.db"));
const peers = new WeakMap<Request, string>();
const trusted = (process.env.TRUSTED_PROXIES ?? "").split(",").map((v) => v.trim()).filter(Boolean);
const app = createApp(db, { startLimit, clientIp: (request) => resolveClientIp(
  peers.get(request) ?? "unknown", request.headers.get("x-forwarded-for"), trusted, trustProxyHops,
) });
app.route("/", shareAssets);
const html = (requestUrl: string) => template === undefined ? new Response("UI not built", { status: 404 }) :
  new Response(renderShareMeta(template, publicOrigin ?? new URL(requestUrl).origin), {
    headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-cache" },
  });
// Register before static serving: neither / nor /index.html may bypass substitution.
app.get("/", c => html(c.req.url));
app.get("/index.html", c => html(c.req.url));
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", c => html(c.req.url));

Bun.serve({ port, hostname, fetch(request, server) {
  peers.set(request, server?.requestIP(request)?.address ?? "unknown");
  return app.fetch(request);
} });
console.log(`App on http://${hostname}:${port}`);
