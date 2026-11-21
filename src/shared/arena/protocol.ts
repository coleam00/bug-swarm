import { MAX_GLOBS, MAX_SPITTERS, GLOB_SPEED, GLOB_LIFETIME_MS } from "./constants";
import { isId, validateName } from "../../server/rules";
import { isTeam, type Team } from "../teams";
import { CLIENT_MESSAGE_BYTES, MAX_PLAYERS, SERVER_MESSAGE_BYTES, WORLD_HEIGHT, WORLD_WIDTH, PLAYER_RADIUS, MAX_BUGS, MAX_SHOTS, MAX_EVENTS, SHOT_SPEED, HEAT_CAPACITY, PLAYER_SPEED, DOWNED_MS, REVIVE_MS, STEP_MS, MAX_PICKUPS, PICKUP_LIFETIME_MS } from "./constants";
import type { Input, CombatPlayer, Bug, Shot, Glob, CombatEvent, LifeResult, Pickup } from "./types";
import { BUGS, isBugKind } from "./bugs/registry";
import { PICKUPS, isPickupKind } from "./pickups/registry";
export const VERSION = 1;
export const HIDDEN_IDENTITY_MESSAGE = "That name isn't allowed.";
export interface Hello { v: 1; type: "hello"; playerId: string; name: string; team: Team; touch: boolean; buildId: string; snapshotEncoding?: "delta-v1" }
export interface InputMessage extends Input { v: 1; type: "input"; seq: number; life: number; touch: boolean }
export interface Respawn { v: 1; type: "respawn"; life: number; touch: boolean }
export type SaveStatus = "pending" | "saved" | "failed";
export type EndReason = "death" | "disconnect" | "restart";
export interface LifeOver extends LifeResult { v: 1; type: "life_over"; save: SaveStatus; reason?: EndReason }
export interface ServerRestart { v: 1; type: "server_restart"; result?: LifeOver }
export interface Welcome { v: 1; type: "welcome"; playerId: string; arenaId: string; buildId: string; snapshotEncoding?: "delta-v1";
  world: { width: number; height: number }; constants: { stepMs: number; playerSpeed: number; playerRadius: number; maxPlayers: number } }
export interface Snapshot { v: 1; type: "snapshot"; arenaId: string; tick: number; wave: number; pickups: Pickup[]; bugs: Bug[]; shots: Shot[]; globs: Glob[]; events: CombatEvent[];
  players: (CombatPlayer & { ackSeq: number; result?: LifeOver })[] }
export interface ArenaError { v: 1; type: "error"; code: string; message: string; team?: Team }
export type ClientMessage = Hello | InputMessage | Respawn;
export type ServerMessage = Welcome | Snapshot | ArenaError | LifeOver | ServerRestart;
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
  if (v.type === "hello" && isId(v.playerId) && typeof v.name === "string" && isTeam(v.team) && typeof v.touch === "boolean" && text(v.buildId) && (v.snapshotEncoding === undefined || v.snapshotEncoding === "delta-v1")) return v as Hello;
  if (integer(v.life) && v.life > 0 && typeof v.touch === "boolean") {
    if (v.type === "respawn") return v as Respawn;
    if (v.type === "input" && integer(v.seq) && v.seq > 0 && object(v.move) && finite(v.move.x) && Math.abs(v.move.x) <= 1e6 && finite(v.move.y) && Math.abs(v.move.y) <= 1e6 && finite(v.aim) && Math.abs(v.aim) <= 1e6 && typeof v.fire === "boolean") return v as InputMessage;
  }
  drop("malformed"); return null;
}
export function parseServer(raw: unknown): ServerMessage | null {
  return validateServer(decode(raw, SERVER_MESSAGE_BYTES, () => {}));
}
export function validateServer(value: unknown, knownNames?: ReadonlySet<string>): ServerMessage | null {
  const v = value; if (!object(v) || v.v !== VERSION) return null;
  if (v.type === "error" && text(v.code) && text(v.message) && (v.team === undefined || isTeam(v.team))) return v as ArenaError;
  if (v.type === "life_over") return validResult(v) ? v as LifeOver : null;
  if (v.type === "server_restart") return v.result === undefined || validResult(v.result) && v.result.reason === "restart" && v.result.save !== "pending" ? v as ServerRestart : null;
  if (v.type === "welcome" && isId(v.playerId) && text(v.arenaId) && text(v.buildId) && (v.snapshotEncoding === undefined || v.snapshotEncoding === "delta-v1") && object(v.world) && object(v.constants) &&
    [v.world.width, v.world.height, v.constants.stepMs, v.constants.playerSpeed, v.constants.playerRadius, v.constants.maxPlayers].every(n => finite(n) && n > 0)) return v as Welcome;
  if (v.type !== "snapshot" || !text(v.arenaId) || !integer(v.tick) || !integer(v.wave) || !Array.isArray(v.players) || v.players.length > MAX_PLAYERS) return null;
  const ids = new Set<string>();
  for (const p of v.players) {
    if (!object(p) || !isId(p.id) || ids.has(p.id) || (!knownNames?.has(p.name) && validateName(p.name).error) || !isTeam(p.team) || !integer(p.ackSeq) ||
      ![p.x, p.y, p.vx, p.vy, p.facing].every(finite) || p.x < PLAYER_RADIUS || p.x > WORLD_WIDTH - PLAYER_RADIUS || p.y < PLAYER_RADIUS || p.y > WORLD_HEIGHT - PLAYER_RADIUS) return null;
    if (!integer(p.life) || p.life < 1 || !integer(p.hits) || p.hits > 3 || !finite(p.heat) || p.heat < 0 || p.heat > HEAT_CAPACITY ||
      ![p.streak, p.points, p.score, p.kills, p.startedTick].every(integer) ||
      ![p.overheatUntil, p.nextShotAt, p.immuneUntil, p.spawnProtectedUntil, p.streak, p.points, p.score, p.kills, p.startedTick].every(n => finite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER) || typeof p.touch !== "boolean" ||
      Math.hypot(p.vx, p.vy) > PLAYER_SPEED + 0.1 || Math.abs(p.facing) > Math.PI + 0.001 ||
      (p.result !== undefined && (!validResult(p.result) || p.result.life !== p.life || p.result.playerId !== p.id || p.status !== "out"))) return null;
    if (!["active", "downed", "out"].includes(p.status) || typeof p.reviving !== "boolean" ||
      !finite(p.downedUntil) || p.downedUntil < 0 || p.downedUntil > Number.MAX_SAFE_INTEGER ||
      !finite(p.reviveMs) || p.reviveMs < 0 || p.reviveMs >= REVIVE_MS ||
      (p.status === "active" ? p.hits < 1 : p.hits !== 0) ||
      (p.status === "downed" ? p.downedUntil <= v.tick * STEP_MS || p.downedUntil > v.tick * STEP_MS + DOWNED_MS :
        p.downedUntil !== 0 || p.reviveMs !== 0 || p.reviving) ||
      (p.status !== "active" && (p.vx !== 0 || p.vy !== 0))) return null;
    if (!object(p.effects) || Object.getPrototypeOf(p.effects) !== Object.prototype) return null;
    for (const [kind, until] of Object.entries(p.effects)) if (!isPickupKind(kind) || p.status !== "active" || !finite(until) || until <= v.tick * STEP_MS || until > v.tick * STEP_MS + PICKUPS[kind].duration + 0.001) return null;
    ids.add(p.id);
  }
  if (!expandCombat(v)) return null;
  const entityIds = new Set<number>();
  for (const [entities, cap, speed] of [[v.bugs, MAX_BUGS, Infinity], [v.shots, MAX_SHOTS, SHOT_SPEED], [v.globs, MAX_GLOBS, GLOB_SPEED]] as const) {
    if (!Array.isArray(entities) || entities.length > cap) return null;
    for (const e of entities) {
      if (!object(e) || !integer(e.id) || entityIds.has(e.id) || ![e.x, e.y, e.vx, e.vy].every(finite) || e.x < 0 || e.x > WORLD_WIDTH || e.y < 0 || e.y > WORLD_HEIGHT || Math.hypot(e.vx, e.vy) > speed + 0.1) return null;
      if (entities === v.bugs) {
        if (!isBugKind(e.kind) || !integer(e.hp) || e.hp < 1 || e.hp > BUGS[e.kind].health || !finite(e.facing) || Math.abs(e.facing) > Math.PI + 0.001 || !BUGS[e.kind].valid(e as Bug, v.tick * STEP_MS)) return null;
      } else {
        if (!finite(e.born) || e.born < 0 || e.born > v.tick * STEP_MS) return null;
        // The wire may reference the owner by its index in this full snapshot.
        // Expand before validating or exposing a Shot to any consumer.
        if (entities === v.shots && integer(e.owner)) {
          if (e.owner >= v.players.length) return null;
          e.owner = v.players[e.owner].id;
        }
        if (entities === v.globs ? e.born + GLOB_LIFETIME_MS <= v.tick * STEP_MS || Math.abs(Math.hypot(e.vx, e.vy) - GLOB_SPEED) > 0.1 : !ids.has(e.owner) || !integer(e.life) || e.life !== v.players.find((p: RecordValue) => p.id === e.owner)?.life) return null;
      }
      entityIds.add(e.id);
    }
  }
  if (!Array.isArray(v.pickups) || v.pickups.length > MAX_PICKUPS) return null;
  for (const p of v.pickups) {
    if (!object(p) || !integer(p.id) || entityIds.has(p.id) || !isPickupKind(p.kind) || ![p.x, p.y, p.expiresAt].every(finite) || p.x < 0 || p.x > WORLD_WIDTH || p.y < 0 || p.y > WORLD_HEIGHT || p.expiresAt <= v.tick * STEP_MS || p.expiresAt > v.tick * STEP_MS + PICKUP_LIFETIME_MS + 0.001) return null;
    entityIds.add(p.id);
  }
  if (v.bugs.filter((b: Bug) => b.kind === "spitter").length > MAX_SPITTERS) return null;
  if (!Array.isArray(v.events) || v.events.length > MAX_EVENTS) return null;
  const events = new Set<number>();
  for (const e of v.events) {
    if (!object(e) || !integer(e.id) || events.has(e.id) || entityIds.has(e.id) || !integer(e.tick) || e.tick > v.tick || ![e.x, e.y, e.points].every(finite) || e.x < 0 || e.x > WORLD_WIDTH || e.y < 0 || e.y > WORLD_HEIGHT) return null;
    if (e.type === "glob-pop" ? e.points !== 5 || e.kind !== undefined : !isBugKind(e.kind) || (e.type === "hit" ? e.points !== 0 : e.type !== "kill" || e.points < BUGS[e.kind].points * 11 / 10 || e.points > BUGS[e.kind].points * 3)) return null;
    events.add(e.id);
  }
  return v as Snapshot;
}
function validResult(v: unknown) { return object(v) && v.v === VERSION && v.type === "life_over" && isId(v.playerId) && integer(v.life) && v.life > 0 && integer(v.score) && integer(v.kills) && finite(v.seconds) && v.seconds >= 0 && typeof v.touch === "boolean" && ["pending", "saved", "failed"].includes(v.save) && (v.reason === undefined || ["death", "disconnect", "restart"].includes(v.reason)); }
/** Quantize the wire only. The authoritative simulation keeps full precision. */
export function serializeSnapshot(snapshot: Snapshot): string {
  const time = snapshot.tick * STEP_MS;
  const entities = [...snapshot.bugs, ...snapshot.shots, ...snapshot.globs, ...snapshot.events, ...snapshot.pickups];
  const largestId = entities.reduce((largest, e) => Math.max(largest, e.id), 0);
  const idBase = largestId > 999999 ? largestId : 0;
  const wire = { ...snapshot,
    ...(idBase ? { idBase } : {}),
    bugs: snapshot.bugs.map(b => b.phase === undefined && b.phaseUntil === undefined ?
      [b.id - idBase, b.kind, b.x, b.y, b.vx, b.vy, b.hp, b.facing] :
      [b.id - idBase, b.kind, b.x, b.y, b.vx, b.vy, b.hp, b.facing, b.phase, b.phaseUntil]),
    shots: snapshot.shots.map(s => [s.id - idBase, snapshot.players.findIndex(p => p.id === s.owner), s.life, s.x, s.y, s.vx, s.vy, time - s.born]),
    events: snapshot.events.map(e => [e.id - idBase, snapshot.tick - e.tick, e.x, e.y, e.kind, e.type, e.points]),
    globs: snapshot.globs.map(g => ({ ...g, id: g.id - idBase })),
    pickups: snapshot.pickups.map(p => ({ ...p, id: p.id - idBase })),
  };
  return JSON.stringify(wire, (_key, value) => typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1000) / 1000 : value);
}
/** Compact combat tuples keep combined spread/rapid volleys within 64 KiB.
 * Runtime state and consumers still use named fields. Existing object fixtures are also validated.
 * A projectile either survives or becomes an impact event, never both in one snapshot. */
function expandCombat(v: RecordValue): boolean {
  if (!Array.isArray(v.bugs) || v.bugs.length > MAX_BUGS || !Array.isArray(v.shots) || v.shots.length > MAX_SHOTS ||
    !Array.isArray(v.events) || v.events.length > MAX_EVENTS || v.shots.length + v.events.length > MAX_SHOTS) return false;
  for (let i = 0; i < v.bugs.length; i++) {
    const b = v.bugs[i]; if (!Array.isArray(b)) continue;
    if (b.length !== 8 && b.length !== 10) return false;
    v.bugs[i] = { id: b[0], kind: b[1], x: b[2], y: b[3], vx: b[4], vy: b[5], hp: b[6], facing: b[7],
      ...(b.length === 10 ? { phase: b[8], phaseUntil: b[9] } : {}) };
  }
  for (let i = 0; i < v.shots.length; i++) {
    const s = v.shots[i]; if (!Array.isArray(s)) continue;
    if (s.length !== 8 || !integer(s[1]) || s[1] >= v.players.length || !finite(s[7])) return false;
    v.shots[i] = { id: s[0], owner: v.players[s[1]].id, life: s[2], x: s[3], y: s[4], vx: s[5], vy: s[6], born: v.tick * STEP_MS - s[7] };
  }
  for (let i = 0; i < v.events.length; i++) {
    const e = v.events[i]; if (!Array.isArray(e)) continue;
    if (e.length !== 7 || !integer(e[1])) return false;
    v.events[i] = { id: e[0], tick: v.tick - e[1], x: e[2], y: e[3], ...(e[4] === null ? {} : { kind: e[4] }), type: e[5], points: e[6] };
  }
  if (v.idBase !== undefined) {
    if (!integer(v.idBase) || !Array.isArray(v.globs) || v.globs.length > MAX_GLOBS || !Array.isArray(v.pickups) || v.pickups.length > MAX_PICKUPS) return false;
    for (const group of [v.bugs, v.shots, v.events, v.globs, v.pickups]) for (const e of group) {
      if (!object(e) || typeof e.id !== "number" || !Number.isSafeInteger(e.id)) return false;
      e.id += v.idBase;
    }
    delete v.idBase;
  }
  return true;
}
