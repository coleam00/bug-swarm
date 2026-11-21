import { isId, validateName } from "../../server/rules";
import { isTeam, type Team } from "../teams";
import { CLIENT_MESSAGE_BYTES, MAX_PLAYERS, SERVER_MESSAGE_BYTES, WORLD_HEIGHT, WORLD_WIDTH, PLAYER_RADIUS } from "./constants";
import type { Input, Player } from "./types";
export const VERSION = 1;
export interface Hello { v: 1; type: "hello"; playerId: string; name: string; team: Team; touch: boolean; buildId: string }
export interface InputMessage extends Input { v: 1; type: "input"; seq: number }
export interface Welcome { v: 1; type: "welcome"; playerId: string; arenaId: string; buildId: string;
  world: { width: number; height: number }; constants: { stepMs: number; playerSpeed: number; playerRadius: number; maxPlayers: number } }
export interface Snapshot { v: 1; type: "snapshot"; arenaId: string; tick: number; players: (Player & { ackSeq: number })[] }
export interface ArenaError { v: 1; type: "error"; code: string; message: string; team?: Team }
export type ClientMessage = Hello | InputMessage;
export type ServerMessage = Welcome | Snapshot | ArenaError;
export type DropReason = "malformed" | "unknown" | "oversized";
type RecordValue = Record<string, any>;
const object = (v: unknown): v is RecordValue => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
function decode(raw: unknown, cap: number, drop: (reason: DropReason) => void): RecordValue | null {
  if (typeof raw !== "string") { drop("malformed"); return null; }
  if (new TextEncoder().encode(raw).byteLength > cap) { drop("oversized"); return null; }
  try { const v = JSON.parse(raw); if (object(v)) return v; } catch { /* counted below */ }
  drop("malformed"); return null;
}
export function parseClient(raw: unknown, drop: (reason: DropReason) => void = () => {}, inputAttempt: () => boolean = () => true): ClientMessage | null {
  const v = decode(raw, CLIENT_MESSAGE_BYTES, drop); if (!v) return null;
  if (v.type === "input" && !inputAttempt()) return null;
  if (v.v !== VERSION || !["hello", "input"].includes(v.type)) { drop("unknown"); return null; }
  // Name policy is semantic: valid hello envelopes with refused names get an error and close.
  if (v.type === "hello" && isId(v.playerId) && typeof v.name === "string" && isTeam(v.team) && typeof v.touch === "boolean" && text(v.buildId)) return v as Hello;
  if (v.type === "input" && integer(v.seq) && v.seq > 0 && object(v.move) && finite(v.move.x) && finite(v.move.y) && finite(v.aim) && typeof v.fire === "boolean") return v as InputMessage;
  drop("malformed"); return null;
}
export function parseServer(raw: unknown): ServerMessage | null {
  const v = decode(raw, SERVER_MESSAGE_BYTES, () => {}); if (!v || v.v !== VERSION) return null;
  if (v.type === "error" && text(v.code) && text(v.message) && (v.team === undefined || isTeam(v.team))) return v as ArenaError;
  if (v.type === "welcome" && isId(v.playerId) && text(v.arenaId) && text(v.buildId) && object(v.world) && object(v.constants) &&
    [v.world.width, v.world.height, v.constants.stepMs, v.constants.playerSpeed, v.constants.playerRadius, v.constants.maxPlayers].every(n => finite(n) && n > 0)) return v as Welcome;
  if (v.type !== "snapshot" || !text(v.arenaId) || !integer(v.tick) || !Array.isArray(v.players) || v.players.length > MAX_PLAYERS) return null;
  const ids = new Set<string>();
  for (const p of v.players) {
    if (!object(p) || !isId(p.id) || ids.has(p.id) || validateName(p.name).error || !isTeam(p.team) || !integer(p.ackSeq) ||
      ![p.x, p.y, p.vx, p.vy, p.facing].every(finite) || p.x < PLAYER_RADIUS || p.x > WORLD_WIDTH - PLAYER_RADIUS || p.y < PLAYER_RADIUS || p.y > WORLD_HEIGHT - PLAYER_RADIUS) return null;
    ids.add(p.id);
  }
  return v as Snapshot;
}
