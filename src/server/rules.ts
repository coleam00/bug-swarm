import { BLOCKED_WORDS } from "./blocked-words";
import type { Finish } from "../shared/api";

export const POINTS_PER_SQUASH = 10;
export const POINTS_PER_SECOND = 1;
export const SCORE_SLACK_SECONDS = 2;
export const MAX_SQUASHES_PER_SECOND = 6;
export const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const nameKey = (name: string) => name.trim().toLowerCase();

export function validateName(value: unknown): { name: string; error?: never } | { error: string; name?: never } {
  if (typeof value !== "string") return { error: "Enter a name." };
  const name = value.trim();
  if (!/^[A-Za-z0-9 _-]{2,16}$/.test(name)) return { error: "Use 2–16 letters, numbers, spaces, hyphens or underscores." };
  const swaps: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s" };
  const normalized = name.toLowerCase().replace(/[01345]/g, (c) => swaps[c]!);
  if (BLOCKED_WORDS.some((word) => normalized.includes(word))) return { error: "That name isn't allowed. Pick another." };
  return { name };
}

export function validFinish(value: unknown): value is Finish {
  if (!value || typeof value !== "object") return false;
  const v = value as Finish;
  return isId(v.playerId) && typeof v.touch === "boolean" &&
    [v.score, v.squashes, v.seconds].every((n) => Number.isSafeInteger(n) && n >= 0);
}

export function plausible(finish: Finish, startedAt: number, now: number): boolean {
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  return finish.squashes <= Math.floor(MAX_SQUASHES_PER_SECOND * elapsed) &&
    finish.seconds <= Math.floor(elapsed + SCORE_SLACK_SECONDS) &&
    finish.score === POINTS_PER_SQUASH * finish.squashes + POINTS_PER_SECOND * finish.seconds;
}
