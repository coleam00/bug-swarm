import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { serveStatic } from "hono/bun";
import { createApp, resolveClientIp, START_LIMIT } from "./app";
import { readConfig } from "./config";
import { openDb } from "./db";
import { createShareAssets } from "./share-assets";
import { configuredOrigin, renderShareMeta } from "./share-meta";
import { RoomManager, type Connection } from "./arena/rooms";
import { SERVER_MESSAGE_BYTES } from "../shared/arena/constants";
import { packagedBuildId } from "./build";

// Production and integration tests use the same HTTP/WebSocket boundary.
export function createServer(options: { port?: number; hostname?: string; dataDir?: string; env?: Record<string, string | undefined> } = {}) {
  const env = options.env ?? process.env, config = readConfig(env);
  const { port, dataDir, hostname } = { ...config, ...options };
  const { startLimit, trustProxyHops } = config;
  // Validate configuration and prepare assets before opening SQLite.
  const publicOrigin = configuredOrigin(env), shareAssets = createShareAssets();
  const template = existsSync("dist/index.html") ? readFileSync("dist/index.html", "utf8") : undefined;
  const buildId = packagedBuildId();
  if (startLimit > START_LIMIT) console.warn(`LOAD TEST: start limit raised to ${startLimit} per IP per ten minutes. Unset LOAD_TEST_START_LIMIT before serving players.`);
  let invalidateScores = () => {};
  const db = openDb(join(dataDir, "app.db")), arenas = new RoomManager(db, buildId, { invalidate: () => invalidateScores() });
  try {
    const peers = new WeakMap<Request, string>();
    const trusted = (env.TRUSTED_PROXIES ?? "").split(",").map(v => v.trim()).filter(Boolean);
    const app = createApp(db, { scoreCacheHook: invalidate => { invalidateScores = invalidate; }, startLimit, arenaStats: () => arenas.stats(), clientIp: request => resolveClientIp(
      peers.get(request) ?? "unknown", request.headers.get("x-forwarded-for"), trusted, trustProxyHops,
    ) });
    app.route("/", shareAssets);
    const html = (requestUrl: string) => template === undefined ? new Response("UI not built", { status: 404 }) :
      new Response(renderShareMeta(template, publicOrigin ?? new URL(requestUrl).origin), {
        headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-cache" },
      });
    // Neither / nor /index.html may bypass share metadata substitution.
    app.get("/", c => html(c.req.url));
    app.get("/index.html", c => html(c.req.url));
    app.use("/*", serveStatic({ root: "./dist" }));
    app.get("*", c => html(c.req.url));

    const server = Bun.serve<{ connection?: Connection }>({
      port, hostname,
      fetch(request, server) {
        if (new URL(request.url).pathname === "/ws") {
          if (!arenas.accepting) return new Response("Server restarting", { status: 503 });
          if (request.method === "GET" && server.upgrade(request, { data: {} })) return undefined;
          return new Response("WebSocket upgrade required", { status: 426 });
        }
        peers.set(request, server?.requestIP(request)?.address ?? "unknown");
        return app.fetch(request);
      },
      websocket: {
        idleTimeout: 30,
        // Transport backstop; the directional parser drops/counts messages over 1 KiB.
        maxPayloadLength: SERVER_MESSAGE_BYTES,
        open(socket) { socket.data.connection = arenas.open(socket); },
        message(socket, message) { if (socket.data.connection) arenas.message(socket.data.connection, message); },
        close(socket) { if (socket.data.connection) arenas.leave(socket.data.connection); },
      },
    });
    let stopping: Promise<boolean> | undefined;
    return { server, db, arenas, stop() {
      return stopping ??= (async () => {
        const start = performance.now();
        const drain = arenas.stop(start + 4000); // synchronously stop admission and freeze lives
        const stopped = server.stop(false);
        let saved = false;
        try { saved = await drain; }
        finally {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try { await Promise.race([stopped, new Promise(resolve => { timer = setTimeout(resolve, 500); })]); }
          finally { clearTimeout(timer); try { await server.stop(true); } finally { db.close(); } }
        }
        return saved;
      })();
    } };
  } catch (error) { void arenas.stop().finally(() => db.close()); throw error; }
}
