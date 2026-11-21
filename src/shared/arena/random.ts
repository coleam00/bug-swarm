// Numerical Recipes LCG: explicit unsigned 32-bit state, identical in Bun and browsers.
export function nextRandom(state: number): number { return (Math.imul(state, 1664525) + 1013904223) >>> 0; }
