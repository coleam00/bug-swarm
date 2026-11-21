import { createServer } from "./server";

const app = createServer();
console.log(`App on http://${app.server.hostname ?? "0.0.0.0"}:${app.server.port ?? process.env.PORT ?? 3000}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.stop().then(() => process.exit(0)); });
