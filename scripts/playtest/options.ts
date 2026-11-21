import { existsSync, realpathSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname, join } from "node:path";
export const scenarios = ["together", "combat", "revive", "late-join", "phone-desktop", "restart", "boss"] as const;
export type ScenarioName = typeof scenarios[number];
export function parseArgs(args: string[]) {
  if (args[0] === "--") args = args.slice(1);
  const result: { scenario?: ScenarioName; issue: string; out?: string; bots?: number } = { issue: "86" };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!, value = args[i + 1];
    if (!["--scenario", "--issue", "--out", "--bots"].includes(flag) || seen.has(flag) || !value || value.startsWith("--")) throw Error("Usage: bun run playtest -- [--scenario <name>] [--issue <number>] [--out <checkout-folder>] [--bots <0..16>]");
    seen.add(flag);
    if (flag === "--scenario") { if (!scenarios.includes(value as ScenarioName)) throw Error("Unknown scenario: " + value); result.scenario = value as ScenarioName; }
    if (flag === "--issue") { if (!/^[1-9]\d*$/.test(value)) throw Error("Invalid issue number"); result.issue = value; }
    if (flag === "--out") result.out = value;
    if (flag === "--bots") { if (!/^(0|[1-9]\d*)$/.test(value) || Number(value) > 16) throw Error("Bot count must be 0..16 (20 total participants maximum)"); result.bots = Number(value); }
  }
  if (result.bots !== undefined && !result.scenario) throw Error("--bots requires --scenario because required scenario populations differ");
  if (result.bots !== undefined && result.scenario === "together" && result.bots !== 10) throw Error("together requires exactly 10 bots");
  if (result.bots !== undefined && result.scenario === "late-join" && result.bots < 8) throw Error("late-join requires at least eight bots");
  if (result.bots && result.scenario === "revive") throw Error("revive requires no bots so only the browser rescuer can complete it");
  return result;
}
/** Check lexical containment AND every existing ancestor (Windows junctions included). */
export function containedPath(root: string, candidate: string) {
  root = realpathSync(root); const path = resolve(root, candidate);
  const inside = (p: string) => { const r = relative(root, p); return r === "" || (!r.startsWith("..") && !isAbsolute(r)); };
  if (!inside(path)) throw Error("Output must stay inside the checkout");
  let ancestor = path;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (!inside(realpathSync(ancestor))) throw Error("Output ancestor escapes checkout through a link");
  return path;
}
export function runDirectory(root: string, options: ReturnType<typeof parseArgs>) {
  const path = containedPath(root, options.out ?? join(".evidence", options.issue, "playtest", crypto.randomUUID().slice(0, 8)));
  if (existsSync(path) && readdirSync(path).length) throw Error("Playtest output must be a fresh or empty folder");
  mkdirSync(path, { recursive: true }); return path;
}
export function scratchEnv(root: string) {
  const home = join(root, "home"), temp = join(root, "tmp");
  // Windows known-folder lookups derive AppData paths from USERPROFILE.
  // They must exist even when Chrome uses a separate --user-data-dir.
  for (const path of [home, temp, join(home, "AppData", "Local"), join(home, "AppData", "Roaming")]) mkdirSync(path, { recursive: true });
  const env: Record<string, string | undefined> = { ...process.env,
    HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData", "Roaming"), LOCALAPPDATA: join(home, "AppData", "Local"), XDG_CONFIG_HOME: home, XDG_CACHE_HOME: temp, TEMP: temp, TMP: temp, TMPDIR: temp,
    DATA_DIR: join(root, "data"), PORT: "0", LOAD_TEST_START_LIMIT: undefined, TRUST_PROXY_HOPS: "0", TRUSTED_PROXIES: undefined,
    PUBLIC_ORIGIN: undefined, RAILWAY_PUBLIC_DOMAIN: undefined, RAILWAY_GIT_COMMIT_SHA: undefined,
  };
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  return env;
}
