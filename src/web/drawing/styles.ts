type BugKind = "base" | "fast";

// Decorative entry/share artwork, independent of combat configuration.
export interface BugStyle { body: string; highlight: string; legs: string; length: number; width: number; leg: number; gait: number }
export const BUG_STYLES: Record<BugKind, BugStyle> = {
  base: { body: "#e47c73", highlight: "#ffd0ab", legs: "#9d6069", length: 12, width: 9, leg: 17, gait: 14 },
  fast: { body: "#f5c85a", highlight: "#fff3ae", legs: "#b88c55", length: 8, width: 6, leg: 13, gait: 27 },
};
