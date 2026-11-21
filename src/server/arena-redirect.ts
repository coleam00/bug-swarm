import type { Plugin } from "vite";

/** Runs before Vite's SPA fallback, matching the production alias. */
export function arenaRedirect(): Plugin {
  return { name: "arena-redirect", configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== "/arena" && url.pathname !== "/arena/") { next(); return; }
      response.writeHead(307, { Location: "/" + url.search }); response.end();
    });
  } };
}
