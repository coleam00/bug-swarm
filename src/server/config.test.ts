import { expect, test } from "bun:test";
import { readConfig } from "./config";

test("start defaults to port 3000, data/, and all interfaces", () => {
  expect(readConfig({})).toEqual({ port: 3000, dataDir: "data", hostname: "0.0.0.0" });
});

test("explicit production mode listens on all interfaces", () => {
  expect(readConfig({ NODE_ENV: "production" }).hostname).toBe("0.0.0.0");
});

test("production honors PORT and DATA_DIR", () => {
  expect(readConfig({ NODE_ENV: "production", PORT: "8080", DATA_DIR: "/data" })).toEqual({
    port: 8080,
    dataDir: "/data",
    hostname: "0.0.0.0",
  });
});

test("development keeps loopback binding and environment overrides", () => {
  expect(readConfig({ NODE_ENV: "development", PORT: "8081", DATA_DIR: "scratch/data" })).toEqual({
    port: 8081,
    dataDir: "scratch/data",
    hostname: "127.0.0.1",
  });
});
