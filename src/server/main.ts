import { join } from "node:path";
import { serveStatic } from "hono/bun";
import { createApp } from "./app";
import { readConfig } from "./config";
import { openDb } from "./db";

// Production mode: one process serves the API and the built UI from dist/.
const { port, dataDir, hostname } = readConfig(process.env);
const db = openDb(join(dataDir, "app.db"));
const app = createApp(db);
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

Bun.serve({ port, hostname, fetch: app.fetch });
console.log(`App on http://${hostname}:${port}`);
