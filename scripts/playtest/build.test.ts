import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { scratchEnv } from "./options";
test("Vite mode opt-in is explicit; normal builds disable the hook even with the environment flag", () => {
  const parent = join(process.cwd(), ".evidence", "86", "tests"); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "build-")), config = pathToFileURL(join(process.cwd(), "vite.config.ts")).href;
  try {
    for (const enabled of [false, true]) {
      const probe = `import config from ${JSON.stringify(config)}; const normal=config({mode:'production',command:'build'}); if(normal.define.__ARENA_PLAYTEST__!=='false')throw Error('normal hook enabled'); try {const instrumented=config({mode:'playtest',command:'build'});if(!${enabled})throw Error('guard missing');if(instrumented.define.__ARENA_PLAYTEST__!=='true')throw Error('instrumentation missing');}catch(e){if(${enabled}||!String(e).includes('require ARENA_PLAYTEST'))throw e}`;
      const result = Bun.spawnSync([process.execPath, "--eval", probe], { env: { ...scratchEnv(root), ARENA_PLAYTEST: enabled ? "1" : "", NODE_ENV: "production" }, stdout: "pipe", stderr: "pipe", timeout: 5000 });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
