import type { Bug, BugKind } from "../../../shared/arena/types";
import { drawCrawler } from "./crawler";
import { createDasherDraw, dasherExtent } from "./dasher";
import { createBeetleDraw } from "./beetle";
import { createSpitterDraw } from "./spitter";
export type BugDraw = (c: CanvasRenderingContext2D, bug: Bug, time: number) => void;
export const BUG_DRAW = {
  crawler: { create: () => drawCrawler, extent: () => 30 },
  dasher: { create: createDasherDraw, extent: dasherExtent },
  beetle: { create: createBeetleDraw, extent: () => 48 },
  spitter: { create: createSpitterDraw, extent: () => 60 },
} satisfies Record<BugKind, { create: () => BugDraw; extent: (b: Bug) => number }>;
export function createBugDraws(): Record<BugKind, BugDraw> {
  return Object.fromEntries(Object.entries(BUG_DRAW).map(([kind, definition]) => [kind, definition.create()])) as Record<BugKind, BugDraw>;
}
