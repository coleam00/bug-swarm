import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, containedPath, scratchEnv, runDirectory } from "./options";
const base = join(process.cwd(), ".evidence", "86", "tests"); mkdirSync(base, { recursive: true });
test("CLI validates scenarios, duplicates, populations and mandatory bots", () => {
  expect(parseArgs(["--", "--scenario", "phone-desktop", "--bots", "16", "--issue", "86"]).bots).toBe(16);
  expect(() => parseArgs(["--bots", "10"])).toThrow("requires --scenario");
  for (const args of [["--scenario", "missing"], ["--bots", "17"], ["--bots", "-1"], ["--scenario", "together", "--bots", "9"], ["--scenario", "late-join", "--bots", "0"], ["--out"], ["--issue", "../x"], ["--scenario", "revive", "--scenario", "revive"], ["--scenario", "revive", "--bots", "1"]]) expect(() => parseArgs(args)).toThrow();
});
test("output checks both lexical paths and existing junction/symlink ancestors", () => {
  const root = mkdtempSync(join(base, "paths-")), checkout = join(root, "checkout"), outside = join(root, "outside"); mkdirSync(checkout); mkdirSync(outside);
  try {
    expect(containedPath(checkout, "a/b")).toBe(join(checkout, "a", "b"));
    expect(() => containedPath(checkout, "../outside")).toThrow();
    symlinkSync(outside, join(checkout, "escape"), process.platform === "win32" ? "junction" : "dir");
    expect(() => containedPath(checkout, "escape/new/file")).toThrow();
    const before = process.env.USERPROFILE; const env = scratchEnv(checkout);
    expect(env.USERPROFILE).toBe(join(checkout, "home")); expect(process.env.USERPROFILE).toBe(before);
    expect(() => runDirectory(checkout, { issue: "86", out: "." })).toThrow("fresh or empty");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("missing Chrome writes a partial failure report and exits nonzero", async () => {
  const root = mkdtempSync(join(base, "failure-"));
  try {
    const out = join(root, "run");
    const child = Bun.spawn([process.execPath, "scripts/playtest.ts", "--scenario", "boss", "--out", out], { env: { ...scratchEnv(root), CHROME_PATH: join(root, "no-chrome") }, stdout: "ignore", stderr: "ignore" });
    expect(await child.exited).toBe(1);
    expect(existsSync(join(out, "report.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(out, "report.json"), "utf8")).error).toContain("Chrome missing");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 15000);
