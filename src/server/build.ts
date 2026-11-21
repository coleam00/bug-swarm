import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

/** Resolve once in Vite, then package the same identity for both ends of the wire. */
export function resolveBuildId(env: Record<string, string | undefined> = process.env, git = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }), now = () => new Date()) {
  const commit = env.RAILWAY_GIT_COMMIT_SHA?.trim();
  if (commit) return commit;
  try { const commit = git().trim(); if (commit) return commit; } catch { /* source archive */ }
  return now().toISOString();
}
export function packagedBuildId(path = "dist/build.json") {
  if (!existsSync(path)) return "development";
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (typeof value.buildId !== "string" || !value.buildId.trim()) throw new Error("Invalid packaged build identity");
  return value.buildId;
}
