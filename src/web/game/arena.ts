import { ARENA_AREA, MIN_ARENA_ASPECT, MAX_ARENA_ASPECT } from "./config";

export interface Arena { readonly width: number; readonly height: number }

export function arenaForViewport(width: number, height: number): Arena {
  const aspect = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? Math.max(MIN_ARENA_ASPECT, Math.min(MAX_ARENA_ASPECT, width / height)) : 1;
  return { width: Math.sqrt(ARENA_AREA * aspect), height: Math.sqrt(ARENA_AREA / aspect) };
}

export const SQUARE_ARENA: Arena = Object.freeze(arenaForViewport(1, 1));
