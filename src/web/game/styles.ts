import { BUG_DEFINITIONS, type BugKind } from "./config";

// Colours and visual dimensions in one table, sized to the simulation footprints.
interface BugStyle { body: string; highlight: string; legs: string; length: number; width: number; leg: number; gait: number }
export const BUG_STYLES: Record<BugKind, BugStyle> = {
  base: { body: "#e47c73", highlight: "#ffd0ab", legs: "#9d6069", length: BUG_DEFINITIONS.base.radius, width: 9, leg: 17, gait: 14 },
  fast: { body: "#f5c85a", highlight: "#fff3ae", legs: "#b88c55", length: BUG_DEFINITIONS.fast.radius, width: 6, leg: 13, gait: 27 },
};
