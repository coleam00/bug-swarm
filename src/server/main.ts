import { createServer } from "./server";

const app = createServer();
console.log(`App on http://${app.server.hostname ?? "0.0.0.0"}:${app.server.port ?? process.env.PORT ?? 3000}`);
let stopping: Promise<void> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => {
  if (stopping) return;
  const started = performance.now();
  const watchdog = setTimeout(() => { console.error("Arena shutdown watchdog: unfinished work", [...app.arenas.connections].map(c => c.record?.runId)); process.exit(1); }, 4800);
  stopping = app.stop().then(saved => {
    console.log(`Shutdown completed in ${(performance.now() - started).toFixed(1)} ms; saves ${saved ? "complete" : "failed"}`);
    process.exitCode = saved ? 0 : 1;
  }, error => { console.error("Shutdown failed", error); process.exitCode = 1; }).finally(() => { clearTimeout(watchdog); process.exit(process.exitCode); });
});
