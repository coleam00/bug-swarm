import { START_LIMIT } from "./app";

export function readConfig(env: Record<string, string | undefined>) {
  const raw = env.LOAD_TEST_START_LIMIT;
  if (raw !== undefined && (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)))) {
    throw new Error("LOAD_TEST_START_LIMIT must be a positive safe integer.");
  }
  const hops = env.TRUST_PROXY_HOPS;
  if (hops !== undefined && (hops.trim() !== hops || !/^(0|[1-9]\d*)$/.test(hops) || !Number.isSafeInteger(Number(hops)))) {
    throw new Error("TRUST_PROXY_HOPS must be a canonical nonnegative safe integer.");
  }
  return {
    trustProxyHops: hops === undefined ? 0 : Number(hops),
    startLimit: raw === undefined ? START_LIMIT : Number(raw),
    port: Number(env.PORT ?? 3000),
    dataDir: env.DATA_DIR ?? "data",
    hostname: env.NODE_ENV === "development" ? "127.0.0.1" : "0.0.0.0",
  };
}
