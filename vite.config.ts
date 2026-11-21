import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { configuredOrigin, renderShareMeta } from "./src/server/share-meta";
import { resolveBuildId } from "./src/server/build";
import { arenaRedirect } from "./src/server/arena-redirect";
const buildId = process.env.NODE_ENV === "production" ? resolveBuildId() : "development";

function shareMetadata(): Plugin {
  const origin = configuredOrigin(process.env);
  return {
    name: "share-metadata",
    apply: "serve",
    transformIndexHtml(html, context) {
      const local = context.server?.resolvedUrls?.local[0];
      if (!origin && !local) throw new Error("Vite has no resolved frontend origin");
      return renderShareMeta(html, origin ?? new URL(local!).origin);
    },
  };
}

const target = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

// In development the UI runs on Vite (5173) and calls the API server on PORT (3000).
export default defineConfig(({ mode }) => {
  const playtest = mode === "playtest";
  if (playtest && process.env.ARENA_PLAYTEST !== "1") throw new Error("Playtest builds require ARENA_PLAYTEST=1");
  return {
    define: { __ARENA_BUILD_ID__: JSON.stringify(buildId), __ARENA_PLAYTEST__: JSON.stringify(playtest) },
    plugins: [react(), arenaRedirect(), shareMetadata(), { name: "build-identity", generateBundle() {
      this.emitFile({ type: "asset", fileName: "build.json", source: JSON.stringify({ buildId, ...(playtest ? { playtest: true } : {}) }) });
    } }],
    server: {
      port: 5173,
      proxy: {
        "/ws": { target, ws: true },
        "/api": target,
        "/health": target,
        "^/(favicon\\.svg|favicon\\.ico|apple-touch-icon\\.png|og-image\\.png)$": target,
      },
    },
  };
});
