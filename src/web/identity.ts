import { isId, validateName } from "../server/rules";
import type { Identity } from "../shared/api";
import { isTeam } from "../shared/teams";

export const IDENTITY_KEY = "bug-swarm-player";
export interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function loadIdentity(storage: Storage): Identity | null {
  try {
    const value = JSON.parse(storage.getItem(IDENTITY_KEY) ?? "null");
    if (!value || !isId(value.playerId)) return null;
    const result = validateName(value.name);
    return result.error ? null : { playerId: value.playerId, name: result.name!, ...(isTeam(value.team) ? { team: value.team } : {}) };
  } catch { return null; }
}
export function storeIdentity(storage: Storage, identity: Identity): void {
  try { storage.setItem(IDENTITY_KEY, JSON.stringify(identity)); }
  catch (error) { console.error("Player identity could not be stored; keeping it for this visit", error); }
}
