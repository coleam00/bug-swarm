import { createServer } from "./server";
import { registerShutdown } from "./shutdown";

const app = createServer();
console.log(`App on http://${app.server.hostname ?? "0.0.0.0"}:${app.server.port ?? process.env.PORT ?? 3000}`);
registerShutdown(app);
