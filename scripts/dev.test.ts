import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readConfig } from "../src/server/config";

test("dev hands development mode and inherited settings to the API child", () => {
  const scratch = mkdtempSync(join(tmpdir(), "dev-launch-test-"));
  const home = join(scratch, "home");
  mkdirSync(home);
  const dataDir = join(scratch, "data");
  const probe = `
const calls = [];
Bun.spawn = (command, options) => {
  calls.push({ command, options });
  return { exited: Promise.resolve(0), kill() {} };
};
await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "dev.ts")).href)});
await Bun.write("launch.json", JSON.stringify(calls));
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], {
      cwd: scratch,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        APPDATA: join(home, "AppData", "Roaming"),
        LOCALAPPDATA: join(home, "AppData", "Local"),
        XDG_CONFIG_HOME: join(home, ".config"),
        XDG_CACHE_HOME: join(home, ".cache"),
        NODE_ENV: "production",
        LOAD_TEST_START_LIMIT: undefined,
        TRUST_PROXY_HOPS: undefined,
        TRUSTED_PROXIES: undefined,
        PORT: "8081",
        DATA_DIR: dataDir,
      },
      stdout: "pipe", stderr: "pipe", timeout: 10_000,
    });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    const calls = JSON.parse(readFileSync(join(scratch, "launch.json"), "utf8")) as {
      command: string[]; options: { env?: Record<string, string | undefined> };
    }[];
    const api = calls.find(({ command }) => command.includes("src/server/main.ts"));
    expect(api).toBeDefined();
    expect(api!.options.env?.NODE_ENV).toBe("development");
    expect(readConfig(api!.options.env ?? {})).toEqual({
      hostname: "127.0.0.1", port: 8081, dataDir, startLimit: 300, trustProxyHops: 0,
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 15_000);
