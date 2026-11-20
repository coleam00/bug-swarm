import { APPROVED_NAMES, BLOCKED_WORDS, RESERVED_NAMES } from "./blocked-words";
import type { Finish } from "../shared/api";
import { CHOICE_INTERVAL, UPGRADE_IDS, type AcquiredUpgrade } from "../shared/upgrades";

export const POINTS_PER_SQUASH = 10;
export const POINTS_PER_SECOND = 1;
// Issue #34: the 2,000-run broad pacing matrix at e5bd626 measured a maximum
// 466 / 156 = 2.987179 squashes per submitted second; 4.5 rounds ~1.5x upward.
export const MAX_SQUASHES_PER_SECOND = 4.5;
// Longest measured gameplay was 156.933333 seconds; 300 adds headroom within #34's ceiling.
export const MAX_RUN_SECONDS = 300;
// bun run pacing --broad at 31b5ee6481b59ff19b78784e123f31a9ff96851f:
// maximum 4,816 across 2,000 runs (Windows, Bun 1.4.2).
// Evasive seed 46, 1280x800, ci-drone/review-laser/refactor-bomb/test-shield.
// Owner moderation threshold, independent of that maximum: honest outliers need approval too.
export const REVIEW_SCORE = 3000;
export const needsReview = (score: number): boolean => score > REVIEW_SCORE;
export const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const nameKey = (name: string) => name.trim().toLowerCase();

const swaps: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };
// Browser-safe and deliberately separate from persisted manual-hide nameKey.
function moderationKey(name: string): string {
  return name.toLowerCase().replace(/[ _-]/g, "").replace(/[0134578]/g, c => swaps[c]!)
    .replace(/([a-z])\1+/g, "$1");
}
const blocked = [...new Set(BLOCKED_WORDS.map(moderationKey))];
const shortBlocked = new Set(blocked.filter(word => word.length <= 3));
const substringBlocked = blocked.filter(word => word.length >= 4);
const approved = new Set(APPROVED_NAMES.map(moderationKey));
const reserved = new Set(RESERVED_NAMES.map(moderationKey));

export function validateName(value: unknown): { name: string; error?: never } | { error: string; name?: never } {
  if (typeof value !== "string") return { error: "Enter a name." };
  const name = value.trim();
  if (!/^[A-Za-z0-9 _-]{2,16}$/.test(name)) return { error: "Use 2–16 letters, numbers, spaces, hyphens or underscores." };
  const normalized = moderationKey(name);
  if (reserved.has(normalized)) return { error: "That name is reserved" };
  if (approved.has(normalized)) return { name };
  // Check numeric suffix boundaries BEFORE leet folding (123 becomes i2e).
  // Try each split: 455123 contains both a leet word (455) and a suffix (123).
  // These candidates can only reject a short term, never grant an exception.
  const compact = name.replace(/[ _-]/g, "");
  let shortMatch = shortBlocked.has(normalized);
  for (let end = compact.length; !shortMatch && end > 0 && /[0-9]/.test(compact[end - 1]!); end--) {
    shortMatch = shortBlocked.has(moderationKey(compact.slice(0, end - 1)));
  }
  if (shortMatch || substringBlocked.some(word => normalized.includes(word))) {
    return { error: "That name isn't allowed. Pick another." };
  }
  return { name };
}

export function validFinish(value: unknown): value is Finish {
  return parseFinish(value) !== null;
}

export function parseFinish(value: unknown): Finish | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Finish;
  if (!isId(v.playerId) || typeof v.touch !== "boolean" ||
    ![v.score, v.squashes, v.seconds].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const entries = v.upgrades === undefined ? [] : v.upgrades;
  if (!Array.isArray(entries) || entries.length > UPGRADE_IDS.length) return null;
  const counts = new Map<string, number>();
  let total = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !UPGRADE_IDS.includes(entry.id) || counts.has(entry.id) ||
      !Number.isSafeInteger(entry.count) || entry.count <= 0) return null;
    total += entry.count;
    if (!Number.isSafeInteger(total) || total > Math.floor(v.seconds / CHOICE_INTERVAL)) return null;
    counts.set(entry.id, entry.count);
  }
  const upgrades: AcquiredUpgrade[] = UPGRADE_IDS.filter(id => counts.has(id)).map(id => ({ id, count: counts.get(id)! }));
  return { playerId: v.playerId, score: v.score, squashes: v.squashes, seconds: v.seconds, touch: v.touch, upgrades };
}

export function plausible(finish: Finish, startedAt: number, now: number): boolean {
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  return finish.seconds <= Math.floor(elapsed) &&
    finish.seconds <= MAX_RUN_SECONDS &&
    finish.squashes <= Math.floor(MAX_SQUASHES_PER_SECOND * finish.seconds) &&
    finish.score === POINTS_PER_SQUASH * finish.squashes + POINTS_PER_SECOND * finish.seconds;
}
