import type { Identity } from "../../shared/api";
import { isId, validateName } from "../../server/rules";
import { isTeam } from "../../shared/teams";
export interface Resume { identity: Identity; touch: boolean; target: string; attempted: string[]; resume: boolean }
export interface ResumeStore { read(): Resume | null; write(value: Resume): boolean }
const key = "bug-swarm-arena-reload-v1";
function valid(value: any): value is Resume {
  return !!value && !!value.identity && isId(value.identity.playerId) && !validateName(value.identity.name).error && isTeam(value.identity.team) &&
    typeof value.touch === "boolean" && typeof value.target === "string" && value.target.length > 0 && value.target.length <= 128 &&
    typeof value.resume === "boolean" && Array.isArray(value.attempted) && value.attempted.every((v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 128);
}
export const resumeStore: ResumeStore = {
  read() {
    try { const value = JSON.parse(sessionStorage.getItem(key) ?? "null"); if (valid(value)) return value; } catch { /* history fallback */ }
    try { const value = history.state?.[key]; if (valid(value)) return value; } catch { /* unavailable */ }
    return null;
  },
  write(value) {
    let saved = false;
    try { sessionStorage.setItem(key, JSON.stringify(value)); saved = true; } catch { /* history fallback */ }
    try { history.replaceState({ ...history.state, [key]: value }, ""); saved = true; } catch { /* unavailable */ }
    if (!saved) console.error("Arena reload guard storage unavailable; automatic reload suppressed");
    return saved;
  },
};
export function consumeResume(store = resumeStore): Resume | null {
  const value = store.read();
  return value?.resume && store.write({ ...value, resume: false }) ? value : null;
}
export function clearResume(store = resumeStore) {
  const value = store.read(); if (value?.resume) store.write({ ...value, resume: false });
}
