import { expect, test } from "bun:test";
import { resolveBuildId, packagedBuildId } from "./build";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
    writeFileSync(file, "{}"); expect(() => packagedBuildId(file)).toThrow("Invalid packaged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
