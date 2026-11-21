import type { Database } from "bun:sqlite";
import { registerArenaPlayer } from "../db";
import { nameKey, validateName } from "../rules";
import { HELLO_TIMEOUT_MS, INPUT_LIMIT, INPUT_STALE_MS, INPUT_WINDOW_MS, MAX_PLAYERS, PLAYER_RADIUS, PLAYER_SPEED, STALL_TIMEOUT_MS, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/arena/constants";
import { HIDDEN_IDENTITY_MESSAGE, parseClient, type ArenaError, type InputMessage, type Snapshot, type Welcome } from "../../shared/arena/protocol";
import { createArena, joinPlayer, leavePlayer, stepArena } from "../../shared/arena/simulation";
import { neutralInput, type ArenaState, type Input } from "../../shared/arena/types";
import { TickMetrics } from "./metrics";
export interface Transport { send(data: string): unknown; close(code?: number, reason?: string): void; getBufferedAmount(): number }
export interface Connection {
  socket: Transport; id?: string; room?: Room; joinedAt: number; attempts: number[];
  lastSeq: number; ackSeq: number; freshAt: number; pending?: InputMessage; held: Input; stalledAt?: number;
  helloTimer?: ReturnType<typeof setTimeout>; closed: boolean;
}
export interface Room { id: string; state: ArenaState; members: Set<Connection>; timer: ReturnType<typeof setInterval>; metrics: TickMetrics; lateness: TickMetrics; nextTickAt: number }
interface Options {
  now?: () => number; seed?: () => number; id?: () => string;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  cancel?: (timer: ReturnType<typeof setInterval>) => void;
}
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly connections = new Set<Connection>();
  readonly active = new Map<string, Connection>();
  readonly dropped = { malformed: 0, unknown: 0, oversized: 0, rateLimited: 0, sequence: 0, handshake: 0, backpressure: 0 };
  private now; private schedule; private cancel; private seed; private id;
  private moderation: ReturnType<typeof setInterval>;
  private stopped = false;
  // Retain closed-room samples until their window expires, without retaining players/sockets.
  private metrics = new Map<string, { tick: TickMetrics; lateness: TickMetrics }>();
  constructor(private db: Database, readonly buildId: string, options: Options = {}) {
    this.now = options.now ?? (() => performance.now()); this.schedule = options.schedule ?? ((fn: () => void, ms: number) => setInterval(fn, ms)); this.cancel = options.cancel ?? clearInterval;
    this.seed = options.seed ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]!); this.id = options.id ?? (() => crypto.randomUUID());
    this.moderation = setInterval(() => this.refreshHidden(), 1000); this.moderation.unref();
  }
  open(socket: Transport): Connection {
    const c: Connection = { socket, joinedAt: this.now(), attempts: [], lastSeq: 0, ackSeq: 0, freshAt: 0, held: neutralInput(), closed: false };
    this.connections.add(c);
    c.helloTimer = setTimeout(() => { this.dropped.handshake++; this.refuse(c, "hello-timeout", "Join timed out. Try again."); }, HELLO_TIMEOUT_MS);
    c.helloTimer.unref();
    if (this.stopped) this.refuse(c, "restarting", "Server restarting.");
    return c;
  }
  private refuse(c: Connection, code: string, message: string, team?: ArenaError["team"]) {
    if (c.closed) return;
    c.socket.send(JSON.stringify({ v: 1, type: "error", code, message, ...(team ? { team } : {}) } satisfies ArenaError));
    this.leave(c); c.socket.close(1008, code);
  }
  message(c: Connection, raw: unknown) {
    if (c.closed) return;
    // Decode only after the UTF-8 size check. Input-shaped schema failures also consume budget.
    const message = parseClient(raw, reason => this.dropped[reason]++, () => {
      const now = this.now(); c.attempts = c.attempts.filter(at => at > now - INPUT_WINDOW_MS);
      if (c.attempts.length >= INPUT_LIMIT) { this.dropped.rateLimited++; return false; }
      c.attempts.push(now); return true;
    });
    if (!message) return;
    if (message.type === "input") {
      if (!c.room) { this.dropped.handshake++; return; }
      if (message.seq <= c.lastSeq) { this.dropped.sequence++; return; }
      c.lastSeq = message.seq; c.pending = message; c.freshAt = this.now(); return;
    }
    if (c.room) { this.dropped.handshake++; return; }
    const name = validateName(message.name);
    if (name.error) { this.refuse(c, "name-refused", name.error); return; }
    const id = message.playerId.toLowerCase();
    if (this.active.has(id)) { this.refuse(c, "already-connected", "This player is already in an arena."); return; }
    if (this.hidden().has(nameKey(name.name!))) { this.refuse(c, "name-hidden", "That name is unavailable. Pick another."); return; }
    const result = registerArenaPlayer(this.db, id, name.name!, message.team);
    if ("error" in result) {
      this.refuse(c, result.error, result.error === "name-conflict" ? "This player's name is fixed. Use your saved name." : "Your saved team has been restored.", "team" in result ? result.team : undefined); return;
    }
    let room: Room | undefined;
    for (const candidate of this.rooms.values()) if (candidate.members.size < MAX_PLAYERS && (!room || candidate.members.size > room.members.size)) room = candidate;
    if (!room) {
      const id = this.id();
      room = { id, state: createArena(this.seed()), members: new Set(), metrics: new TickMetrics(this.now), lateness: new TickMetrics(this.now), nextTickAt: this.now() + STEP_MS, timer: undefined! };
      this.metrics.set(id, { tick: room.metrics, lateness: room.lateness });
      const created = room;
      room.timer = this.schedule(() => this.tick(created), STEP_MS); room.timer.unref?.(); this.rooms.set(id, room);
    }
    c.id = id; c.room = room; clearTimeout(c.helloTimer); room.members.add(c); this.active.set(id, c);
    joinPlayer(room.state, { id, name: name.name!, team: message.team });
    c.socket.send(JSON.stringify({ v: 1, type: "welcome", playerId: id, arenaId: room.id, buildId: this.buildId,
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }, constants: { stepMs: STEP_MS, playerSpeed: PLAYER_SPEED, playerRadius: PLAYER_RADIUS, maxPlayers: MAX_PLAYERS } } satisfies Welcome));
    this.broadcast(room);
  }
  snapshot(room: Room): Snapshot {
    return { v: 1, type: "snapshot", arenaId: room.id, tick: room.state.tick,
      players: Array.from(room.members, c => ({ ...room.state.players.get(c.id!)!, ackSeq: c.ackSeq })) };
  }
  private broadcast(room: Room) {
    const payload = JSON.stringify(this.snapshot(room)); const now = this.now();
    for (const c of room.members) {
      if (c.socket.getBufferedAmount() > 0) {
        this.dropped.backpressure++; c.stalledAt ??= now;
        if (now - c.stalledAt >= STALL_TIMEOUT_MS) { this.leave(c); c.socket.close(1013, "slow-client"); }
      } else { c.stalledAt = undefined; c.socket.send(payload); }
    }
  }
  tick(room: Room) {
    const start = this.now(); const inputs = new Map<string, Input>();
    room.lateness.add(Math.max(0, start - room.nextTickAt)); room.nextTickAt = start + STEP_MS;
    for (const c of room.members) {
      if (c.pending) { c.held = c.pending; c.ackSeq = c.pending.seq; c.pending = undefined; }
      if (start - c.freshAt >= INPUT_STALE_MS) c.held = { ...neutralInput(), aim: c.held.aim };
      inputs.set(c.id!, c.held);
    }
    stepArena(room.state, inputs); this.broadcast(room); room.metrics.add(this.now() - start);
  }
  leave(c: Connection) {
    if (c.closed) return;
    c.closed = true; clearTimeout(c.helloTimer); this.connections.delete(c);
    if (c.id && this.active.get(c.id) === c) this.active.delete(c.id);
    const room = c.room;
    if (room) { room.members.delete(c); leavePlayer(room.state, c.id!); if (!room.members.size) { this.cancel(room.timer); this.rooms.delete(room.id); } }
    c.pending = undefined; c.held = neutralInput(); c.room = undefined;
  }
  private hidden(): Set<string> { return new Set((this.db.query("SELECT name_key FROM hidden_names").all() as { name_key: string }[]).map(r => r.name_key)); }
  refreshHidden() {
    this.expireMetrics();
    const hidden = this.hidden();
    for (const c of this.active.values()) if (hidden.has(nameKey(c.room!.state.players.get(c.id!)!.name))) this.refuse(c, "name-hidden", HIDDEN_IDENTITY_MESSAGE);
  }
  private expireMetrics() {
    for (const [id, metric] of this.metrics) if (!this.rooms.has(id) && metric.tick.stats().samples === 0) this.metrics.delete(id);
  }
  stats() {
    // Merge raw samples across rooms so a quiet room cannot distort percentiles.
    this.expireMetrics();
    const rooms = [...this.rooms.values()];
    return { arenas: rooms.map(r => ({ id: r.id, players: r.members.size })), totalPlayers: this.active.size,
      tick: TickMetrics.combine([...this.metrics.values()].map(m => m.tick)),
      schedulerLateness: TickMetrics.combine([...this.metrics.values()].map(m => m.lateness)), dropped: { ...this.dropped } };
  }
  stop() { if (this.stopped) return; this.stopped = true; clearInterval(this.moderation); for (const c of [...this.connections]) { this.leave(c); c.socket.close(1012, "server-restarting"); } }
}
