// Visual dimensions only: collision footprints remain in config.ts.
export const BUG_STYLES = {
  base: { body: "#e47c73", highlight: "#ffd0ab", legs: "#9d6069", length: 12, width: 9, leg: 17, gait: 14 },
  // Ready for the swarm item's kind mapping; this adds no simulation kind.
  fast: { body: "#f5c85a", highlight: "#fff3ae", legs: "#b88c55", length: 9, width: 6, leg: 13, gait: 27 },
} as const;
