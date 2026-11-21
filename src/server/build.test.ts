import { expect, test } from "bun:test";
import { resolveBuildId, packagedBuildId } from "./build";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("build identity prefers a nonempty build commit, then git, then a timestamp; manifest wins at runtime", () => {
  const now = () => new Date("2026-01-01T00:00:00Z"), noGit = () => { throw Error("no git"); };
  expect(resolveBuildId({ RAILWAY_GIT_COMMIT_SHA: " abc " }, noGit, now)).toBe("abc");
  expect(resolveBuildId({ RAILWAY_GIT_COMMIT_SHA: " " }, () => "def\n", now)).toBe("def");
  expect(resolveBuildId({}, noGit, now)).toBe("2026-01-01T00:00:00.000Z");
  const dir = mkdtempSync(join(tmpdir(), "build-id-")), file = join(dir, "build.json");
  try {
    expect(packagedBuildId(file)).toBe("development");
    writeFileSync(file, JSON.stringify({ buildId: "packaged" })); expect(packagedBuildId(file)).toBe("packaged");
    writeFileSync(file, "{}"); expect(() => packagedBuildId(file)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("production output packages the build-time commit in both manifest and client code", () => {
  const dir = mkdtempSync(join(tmpdir(), "build-output-")), home = join(dir, "home"), out = join(dir, "dist");
  mkdirSync(home);
  const commit = "66abcdef0123456789abcdef0123456789abcdef";
  try {
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../../node_modules/vite/bin/vite.js"), "build", "--outDir", out], {
      cwd: join(import.meta.dir, "../.."), env: { ...process.env, NODE_ENV: "production", RAILWAY_GIT_COMMIT_SHA: commit,
        HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home },
      stdout: "pipe", stderr: "pipe", timeout: 30000,
    });
    expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
    expect(JSON.parse(readFileSync(join(out, "build.json"), "utf8")).buildId).toBe(commit);
    const scripts = readdirSync(join(out, "assets")).filter(file => file.endsWith(".js")).map(file => readFileSync(join(out, "assets", file), "utf8"));
    expect(scripts.some(code => code.includes(commit))).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 40000);
