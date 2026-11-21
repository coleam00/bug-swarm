/** Shared signal path for production and the owned playtest child. */
export function registerShutdown(app: { stop(): Promise<boolean>; arenas: { connections: Set<{ record?: { runId: string } }> } }, completed: () => void = () => {}) {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const started = performance.now();
    const watchdog = setTimeout(() => { console.error("Arena shutdown watchdog: unfinished work", [...app.arenas.connections].map(c => c.record?.runId)); process.exit(1); }, 4800);
    void app.stop().then(saved => {
      completed();
      console.log(`Shutdown completed in ${(performance.now() - started).toFixed(1)} ms; saves ${saved ? "complete" : "failed"}`);
      process.exitCode = saved ? 0 : 1;
    }).catch(error => { console.error("Shutdown failed", error); process.exitCode = 1; }).finally(() => { clearTimeout(watchdog); process.exit(process.exitCode); });
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
  return stop;
}
