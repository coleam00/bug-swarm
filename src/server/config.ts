export function readConfig(env: Record<string, string | undefined>) {
  return {
    port: Number(env.PORT ?? 3000),
    dataDir: env.DATA_DIR ?? "data",
    hostname: env.NODE_ENV === "development" ? "127.0.0.1" : "0.0.0.0",
  };
}
