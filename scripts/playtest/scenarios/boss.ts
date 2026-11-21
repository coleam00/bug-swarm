import { BUGS } from "../../../src/shared/arena/bugs/registry";
import type { Context } from "../context";
/** The boss item supplies its encounter/health/arrow/contribution adapter here. */
export default async function boss(c: Context) {
  const capable = Object.entries(BUGS).some(([kind, definition]) => /boss/i.test(kind) || "boss" in definition);
  if (capable) throw Error("Boss capability detected: implement the fifth-wave browser encounter adapter; do not skip an existing boss");
  c.report.status = "skip"; c.report.skip = "No boss exists in the bug registry (crawler, dasher, spitter).";
  console.log("boss: SKIP — " + c.report.skip);
}
