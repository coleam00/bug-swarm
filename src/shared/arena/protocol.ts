import { isId, validateName } from "../../server/rules";
import { isTeam, type Team } from "../teams";
import { CLIENT_MESSAGE_BYTES, MAX_PLAYERS, SERVER_MESSAGE_BYTES, WORLD_HEIGHT, WORLD_WIDTH, PLAYER_RADIUS, MAX_BUGS, MAX_SHOTS, MAX_EVENTS, SHOT_SPEED, CRAWLER_SPEED, HEAT_CAPACITY, PLAYER_SPEED } from "./constants";
import type { Input, CombatPlayer, Bug, Shot, KillEvent, LifeResult } from "./types";
export const VERSION = 1;
export const HIDDEN_IDENTITY_MESSAGE = "This identity cannot rejoin because its name is hidden. Saved names are permanent.";
export interface Hello { v: 1; type: "hello"; playerId: string; name: string; team: Team; touch: boolean; buildId: string }
export interface InputMessage extends Input { v: 1; type: "input"; seq: number; life: number; touch: boolean }
export interface Respawn { v: 1; type: "respawn"; life: number; touch: boolean }
export type SaveStatus = "pending" | "saved" | "failed";
export interface LifeOver extends LifeResult { v: 1; type: "life_over"; save: SaveStatus }
export interface Welcome { v: 1; type: "welcome"; playerId: string; arenaId: string; buildId: string;
  world: { width: number; height: number }; constants: { stepMs: number; playerSpeed: number; playerRadius: number; maxPlayers: number } }
export interface Snapshot { v: 1; type: "snapshot"; arenaId: string; tick: number; wave: number; bugs: Bug[]; shots: Shot[]; events: KillEvent[];
  players: (CombatPlayer & { ackSeq: number; result?: LifeOver })[] }
export interface ArenaError { v: 1; type: "error"; code: string; message: string; team?: Team }
export type ClientMessage = Hello | InputMessage | Respawn;
export type ServerMessage = Welcome | Snapshot | ArenaError | LifeOver;
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
  if ((v.type === "input" || v.type === "respawn") && !inputAttempt()) return null;
  if (v.v !== VERSION || !["hello", "input", "respawn"].includes(v.type)) { drop("unknown"); return null; }
  // Name policy is semantic: valid hello envelopes with refused names get an error and close.
  if (v.type === "hello" && isId(v.playerId) && typeof v.name === "string" && isTeam(v.team) && typeof v.touch === "boolean" && text(v.buildId)) return v as Hello;
  if (integer(v.life) && v.life > 0 && typeof v.touch === "boolean") {
    if (v.type === "respawn") return v as Respawn;
    if (v.type === "input" && integer(v.seq) && v.seq > 0 && object(v.move) && finite(v.move.x) && Math.abs(v.move.x) <= 1e6 && finite(v.move.y) && Math.abs(v.move.y) <= 1e6 && finite(v.aim) && Math.abs(v.aim) <= 1e6 && typeof v.fire === "boolean") return v as InputMessage;
  }
  drop("malformed"); return null;
}
export function parseServer(raw: unknown): ServerMessage | null {
  const v = decode(raw, SERVER_MESSAGE_BYTES, () => {}); if (!v || v.v !== VERSION) return null;
  if (v.type === "error" && text(v.code) && text(v.message) && (v.team === undefined || isTeam(v.team))) return v as ArenaError;
  if (v.type === "life_over") return validResult(v) ? v as LifeOver : null;
  if (v.type === "welcome" && isId(v.playerId) && text(v.arenaId) && text(v.buildId) && object(v.world) && object(v.constants) &&
    [v.world.width, v.world.height, v.constants.stepMs, v.constants.playerSpeed, v.constants.playerRadius, v.constants.maxPlayers].every(n => finite(n) && n > 0)) return v as Welcome;
  if (v.type !== "snapshot" || !text(v.arenaId) || !integer(v.tick) || !integer(v.wave) || !Array.isArray(v.players) || v.players.length > MAX_PLAYERS) return null;
  const ids = new Set<string>();
  for (const p of v.players) {
    if (!object(p) || !isId(p.id) || ids.has(p.id) || validateName(p.name).error || !isTeam(p.team) || !integer(p.ackSeq) ||
      ![p.x, p.y, p.vx, p.vy, p.facing].every(finite) || p.x < PLAYER_RADIUS || p.x > WORLD_WIDTH - PLAYER_RADIUS || p.y < PLAYER_RADIUS || p.y > WORLD_HEIGHT - PLAYER_RADIUS) return null;
    if (!integer(p.life) || p.life < 1 || !integer(p.hits) || p.hits > 3 || !finite(p.heat) || p.heat < 0 || p.heat > HEAT_CAPACITY ||
      ![p.streak, p.points, p.score, p.kills, p.startedTick].every(integer) ||
      ![p.overheatUntil, p.nextShotAt, p.immuneUntil, p.spawnProtectedUntil, p.streak, p.points, p.score, p.kills, p.startedTick].every(n => finite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER) || typeof p.touch !== "boolean" ||
      Math.hypot(p.vx, p.vy) > PLAYER_SPEED + 0.1 || Math.abs(p.facing) > Math.PI + 0.001 ||
      (p.result !== undefined && (!validResult(p.result) || p.result.life !== p.life || p.result.playerId !== p.id || p.hits !== 0))) return null;
    ids.add(p.id);
  }
  const entityIds = new Set<number>();
  for (const [entities, cap, speed] of [[v.bugs, MAX_BUGS, CRAWLER_SPEED], [v.shots, MAX_SHOTS, SHOT_SPEED]] as const) {
    if (!Array.isArray(entities) || entities.length > cap) return null;
    for (const e of entities) {
      if (!object(e) || !integer(e.id) || entityIds.has(e.id) || ![e.x, e.y, e.vx, e.vy].every(finite) || e.x < 0 || e.x > WORLD_WIDTH || e.y < 0 || e.y > WORLD_HEIGHT || Math.hypot(e.vx, e.vy) > speed + 0.1) return null;
      if (entities === v.bugs ? e.kind !== "crawler" : !ids.has(e.owner) || !integer(e.life) || e.life !== v.players.find((p: RecordValue) => p.id === e.owner)?.life || !finite(e.born) || e.born < 0 || e.born > v.tick * 50) return null;
      entityIds.add(e.id);
    }
  }
  if (!Array.isArray(v.events) || v.events.length > MAX_EVENTS) return null;
  const events = new Set<number>();
  for (const e of v.events) {
    if (!object(e) || !integer(e.id) || events.has(e.id) || !integer(e.tick) || e.tick > v.tick || ![e.x, e.y, e.points].every(finite) || e.x < 0 || e.x > WORLD_WIDTH || e.y < 0 || e.y > WORLD_HEIGHT || e.points < 10 || e.points > 30) return null;
    events.add(e.id);
  }
  return v as Snapshot;
}
function validResult(v: unknown) { return object(v) && v.v === VERSION && v.type === "life_over" && isId(v.playerId) && integer(v.life) && v.life > 0 && integer(v.score) && integer(v.kills) && finite(v.seconds) && v.seconds >= 0 && typeof v.touch === "boolean" && ["pending", "saved", "failed"].includes(v.save); }
/** Quantize the wire only. The authoritative simulation keeps full precision. */
export function serializeSnapshot(snapshot: Snapshot): string {
  return JSON.stringify(snapshot, (_key, value) => typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1000) / 1000 : value);
}
