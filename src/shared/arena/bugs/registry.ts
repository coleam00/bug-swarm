import { crawler } from "./crawler";
import { dasher } from "./dasher";
import { beetle } from "./beetle";
import { spitter } from "./spitter";
import { hive } from "./hive";
import type { Bug, BugKind } from "../types";
export const BUGS = { crawler, dasher, spitter, beetle, hive } as const;
export const isBugKind = (value: unknown): value is BugKind => typeof value === "string" && Object.hasOwn(BUGS, value);
export function createBug(kind: BugKind, id: number, x: number, y: number, time = 0): Bug {
  const bug: Bug = { kind, id, x, y, vx: 0, vy: 0, hp: BUGS[kind].health, facing: 0 };
  BUGS[kind].initialize(bug, time); return bug;
}
