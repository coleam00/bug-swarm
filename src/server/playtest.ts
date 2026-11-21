import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function guardPlaytest(env: Record<string, string | undefined>, requested: boolean, assets: string) {
  const manifest = join(assets, "build.json");
  const marked = existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).playtest === true;
  if ((requested || marked) && env.ARENA_PLAYTEST !== "1") throw new Error("Playtest instrumentation requires explicit ARENA_PLAYTEST=1, including in production");
  if (requested && !marked) throw new Error("Playtest requires instrumented assets");
}
