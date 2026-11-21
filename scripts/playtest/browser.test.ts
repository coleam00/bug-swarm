import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { scratchEnv } from "./options";

test("Chrome startup reports an early process exit and stderr without waiting for the deadline", () => {
  const parent = join(process.cwd(), ".evidence", "86", "tests"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "chrome-exit-"));
  try {
    // Bun cannot run Chrome's about:blank entry point. Keep the overridden
    // executable and scratch environment in an owned child, not this runner.
    const module = pathToFileURL(join(process.cwd(), "scripts/playtest/browser.ts")).href;
    const probe = `import {Browser} from ${JSON.stringify(module)};const b=new Browser();try{await b.start(${JSON.stringify(root)});throw Error('unexpected startup')}catch(e){console.error(String(e));process.exitCode=1}finally{await b.close()}`;
    const result = Bun.spawnSync([process.execPath, "--eval", probe], {
      env: { ...scratchEnv(root), CHROME_PATH: process.execPath }, stdout: "pipe", stderr: "pipe", timeout: 5000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Chrome exited during startup");
    expect(result.stderr.toString()).toContain("about:blank");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 10000);
