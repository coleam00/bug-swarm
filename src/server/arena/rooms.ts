import type { Database } from "bun:sqlite";
import { registerArenaPlayer } from "../db";
import { nameKey, validateName } from "../rules";
import { HELLO_TIMEOUT_MS, INPUT_LIMIT, INPUT_STALE_MS, INPUT_WINDOW_MS, MAX_PLAYERS, PLAYER_RADIUS, PLAYER_SPEED, STALL_TIMEOUT_MS, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/arena/constants";
import { HIDDEN_IDENTITY_MESSAGE, parseClient, serializeSnapshot, type ArenaError, type InputMessage, type Snapshot, type Welcome, type LifeOver, type EndReason, type ServerRestart } from "../../shared/arena/protocol";
import { createArena, joinPlayer, leavePlayer, stepArena, endLife, respawnPlayer } from "../../shared/arena/simulation";
import { neutralInput, type ArenaState, type Input, type LifeResult } from "../../shared/arena/types";
import { TickMetrics, TrafficMetrics, HISTORY_MS, TRAFFIC_KEYS, emptyTraffic, byteDistribution } from "./metrics";
import { LifeWriter, type LifeRecord } from "./lives";
import { SnapshotEncoder } from "../../shared/arena/snapshot-codec";
export interface Transport { send(data: string | Uint8Array): unknown; close(code?: number, reason?: string): void; getBufferedAmount(): number }
export interface Connection {
  compact?: boolean; snapshotTick?: number;
  traffic: TrafficMetrics;
  storedId?: string; record?: LifeRecord; result?: LifeOver;
  socket: Transport; id?: string; room?: Room; joinedAt: number; attempts: number[];
  lastSeq: number; ackSeq: number; freshAt: number; pending?: InputMessage; held: Input; stalledAt?: number;
  helloTimer?: ReturnType<typeof setTimeout>; closed: boolean;
}
type Sizes = Record<"all" | "keyframe" | "delta" | "json", TickMetrics>;
export interface Room { id: string; state: ArenaState; members: Set<Connection>; timer: ReturnType<typeof setInterval>; metrics: TickMetrics; lateness: TickMetrics; nextTickAt: number; codec: SnapshotEncoder; sizes: Sizes }
interface Options {
  wallNow?: () => number; invalidate?: () => void;
  now?: () => number; seed?: () => number; id?: () => string;
  schedule?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  cancel?: (timer: ReturnType<typeof setInterval>) => void;
}
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  readonly connections = new Set<Connection>();
  readonly active = new Map<string, Connection>();
  private drops = new TrafficMetrics();
  readonly dropped = new Proxy({ malformed: 0, unknown: 0, oversized: 0, rateLimited: 0, sequence: 0, handshake: 0, backpressure: 0 }, {
    set: (target, property, value: number) => { const key = property as keyof typeof target; this.drops.add(this.now(), key, value - target[key]); target[key] = value; return true; },
  });
  private history = new Map<string, { playerId: string; arenaId: string; joinedAt: number; leftAt?: number; traffic: TrafficMetrics }>();
  private startedAt = 0;
  private rateLimitExamples: { at: number; playerId?: string; first: number; last: number; seq: number }[] = [];
  private now; private schedule; private cancel; private seed; private id;
  private moderation: ReturnType<typeof setInterval>;
  private stopped = false;
  private stopping?: Promise<boolean>;
  get accepting() { return !this.stopped; }
  private wallNow; readonly writer: LifeWriter;
  // Retain closed-room samples until their window expires, without retaining players/sockets.
  private metrics = new Map<string, { tick: TickMetrics; lateness: TickMetrics; sizes: Sizes }>();
  constructor(private db: Database, readonly buildId: string, options: Options = {}) {
    this.wallNow = options.wallNow ?? Date.now; this.writer = new LifeWriter(db, options.invalidate);
    this.now = options.now ?? (() => performance.now()); this.schedule = options.schedule ?? ((fn: () => void, ms: number) => setInterval(fn, ms)); this.cancel = options.cancel ?? clearInterval;
    this.startedAt = this.now();
    this.seed = options.seed ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]!); this.id = options.id ?? (() => crypto.randomUUID());
    this.moderation = setInterval(() => this.refreshHidden(), 1000); this.moderation.unref();
  }
  open(socket: Transport): Connection {
    const c: Connection = { traffic: new TrafficMetrics(), socket, joinedAt: this.now(), attempts: [], lastSeq: 0, ackSeq: 0, freshAt: 0, held: neutralInput(), closed: false };
    this.connections.add(c);
    c.helloTimer = setTimeout(() => { this.dropped.handshake++; this.refuse(c, "hello-timeout", "Join timed out. Try again."); }, HELLO_TIMEOUT_MS);
    c.helloTimer.unref();
    if (this.stopped) this.refuse(c, "restarting", "Server restarting.");
    return c;
  }
  private refuse(c: Connection, code: string, message: string, team?: ArenaError["team"]) {
    if (c.closed) return;
    this.send(c, JSON.stringify({ v: 1, type: "error", code, message, ...(team ? { team } : {}) } satisfies ArenaError));
    this.leave(c); c.socket.close(1008, code);
  }
  message(c: Connection, raw: unknown) {
    if (c.closed) return;
    if (this.stopped) return;
    c.traffic.add(this.now(), "in"); c.traffic.add(this.now(), "bytesIn", typeof raw === "string" ? Buffer.byteLength(raw) : (raw as Uint8Array)?.byteLength ?? 0);
    // Decode only after the UTF-8 size check. Input-shaped schema failures also consume budget.
    const message = parseClient(raw, reason => this.dropped[reason]++, () => {
      const now = this.now(); c.attempts = c.attempts.filter(at => at > now - INPUT_WINDOW_MS);
      if (c.attempts.length >= INPUT_LIMIT) {
        this.dropped.rateLimited++; c.traffic.add(now, "rateLimited");
        if (this.rateLimitExamples.length >= 20) this.rateLimitExamples.shift();
        this.rateLimitExamples.push({ at: now, playerId: c.id, first: c.attempts[0]!, last: c.attempts.at(-1)!, seq: c.lastSeq });
        return false;
      }
      c.attempts.push(now); return true;
    });
    if (!message) return;
    if (message.type === "respawn") {
      if (!c.room || !c.id) return;
      const p = respawnPlayer(c.room.state, c.id, message.life); if (!p) return;
      p.touch = message.touch; c.pending = undefined; c.held = neutralInput(); c.result = undefined;
      this.startLife(c); return;
    }
    if (message.type === "input") {
      if (!c.room) { this.dropped.handshake++; return; }
      const p = c.room.state.players.get(c.id!)!;
      if (p.status !== "active" || message.life !== p.life) return;
      if (message.seq <= c.lastSeq) { this.dropped.sequence++; return; }
      p.touch ||= message.touch;
      c.lastSeq = message.seq; c.pending = message; c.freshAt = this.now(); return;
    }
    if (c.room) { this.dropped.handshake++; return; }
    const name = validateName(message.name);
    if (name.error) { this.refuse(c, "name-refused", name.error); return; }
    const id = message.playerId.toLowerCase();
    if (this.active.has(id)) { this.refuse(c, "already-connected", "This player is already in an arena."); return; }
    if (this.hidden().has(nameKey(name.name!))) { this.refuse(c, "name-hidden", HIDDEN_IDENTITY_MESSAGE); return; }
    const result = registerArenaPlayer(this.db, id, name.name!, message.team);
    if ("error" in result) {
      this.refuse(c, result.error, result.error === "name-conflict" ? "This player's name is fixed. Use your saved name." : "Your saved team has been restored.", "team" in result ? result.team : undefined); return;
    }
    let room: Room | undefined;
    for (const candidate of this.rooms.values()) if (candidate.members.size < MAX_PLAYERS && (!room || candidate.members.size > room.members.size)) room = candidate;
    if (!room) {
      const id = this.id();
      const sizes = Object.fromEntries(["all", "keyframe", "delta", "json"].map(key => [key, new TickMetrics(this.now, Math.ceil(HISTORY_MS / STEP_MS) * MAX_PLAYERS + MAX_PLAYERS * MAX_PLAYERS)])) as Sizes;
      room = { id, state: createArena(this.seed()), members: new Set(), metrics: new TickMetrics(this.now), lateness: new TickMetrics(this.now), nextTickAt: this.now() + STEP_MS, timer: undefined!, codec: new SnapshotEncoder(), sizes };
      this.metrics.set(id, { tick: room.metrics, lateness: room.lateness, sizes });
      const created = room;
      room.timer = this.schedule(() => this.tick(created), STEP_MS); room.timer.unref?.(); this.rooms.set(id, room);
    }
    c.id = id; c.storedId = result.playerId; c.room = room; clearTimeout(c.helloTimer); room.members.add(c); this.active.set(id, c);
    c.compact = message.snapshotEncoding === "delta-v1";
    c.joinedAt = this.now(); this.history.set(c.record?.runId ?? crypto.randomUUID(), { playerId: id, arenaId: room.id, joinedAt: c.joinedAt, traffic: c.traffic });
    joinPlayer(room.state, { id, name: name.name!, team: message.team })!.touch = message.touch;
    this.startLife(c);
    this.send(c, JSON.stringify({ v: 1, type: "welcome", playerId: id, arenaId: room.id, buildId: this.buildId, ...(c.compact ? { snapshotEncoding: "delta-v1" as const } : {}),
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }, constants: { stepMs: STEP_MS, playerSpeed: PLAYER_SPEED, playerRadius: PLAYER_RADIUS, maxPlayers: MAX_PLAYERS } } satisfies Welcome));
    this.broadcast(room);
  }
  snapshot(room: Room): Snapshot {
    return { v: 1, type: "snapshot", arenaId: room.id, tick: room.state.tick,
      wave: room.state.wave, bugs: room.state.bugs, shots: room.state.shots, events: room.state.events,
      players: Array.from(room.members, c => ({ ...room.state.players.get(c.id!)!, ackSeq: c.ackSeq, ...(c.result ? { result: c.result } : {}) })) };
  }
  private broadcast(room: Room) {
    const snapshot = this.snapshot(room), hasCompact = [...room.members].some(c => c.compact);
    const encoded = hasCompact ? room.codec.encode(snapshot) : undefined;
    const payload = [...room.members].some(c => !c.compact) ? serializeSnapshot(snapshot) : undefined; const now = this.now();
    for (const c of room.members) {
      if (c.socket.getBufferedAmount() > 0) {
        this.dropped.backpressure++; c.traffic.add(now, "skipped"); c.snapshotTick = undefined; c.stalledAt ??= now;
        if (now - c.stalledAt >= STALL_TIMEOUT_MS) { this.leave(c); c.socket.close(1013, "slow-client"); }
      } else {
        c.stalledAt = undefined;
        const delta = c.compact && !encoded!.periodic && c.snapshotTick === encoded!.baseTick;
        const frame = c.compact ? delta ? encoded!.delta : encoded!.keyframe : payload!;
        const bytes = typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
        if (this.send(c, frame)) { c.snapshotTick = snapshot.tick; room.sizes.all.add(bytes); room.sizes[c.compact ? delta ? "delta" : "keyframe" : "json"].add(bytes); }
        else c.snapshotTick = undefined;
      }
    }
  }
  tick(room: Room) {
    if (this.stopped) return;
    const start = this.now(); const inputs = new Map<string, Input>();
    room.lateness.add(Math.max(0, start - room.nextTickAt)); room.nextTickAt = start + STEP_MS;
    for (const c of room.members) {
      if (c.pending) { c.held = c.pending; c.ackSeq = c.pending.seq; c.pending = undefined; }
      if (start - c.freshAt >= INPUT_STALE_MS) c.held = { ...neutralInput(), aim: c.held.aim };
      inputs.set(c.id!, c.held);
    }
    stepArena(room.state, inputs);
    for (const c of room.members) if (room.state.players.get(c.id!)!.status !== "active") {
      c.pending = undefined; c.held = neutralInput();
    }
    for (const result of room.state.ended) { const c = this.active.get(result.playerId); if (c) this.finishLife(c, result); }
    this.broadcast(room); room.metrics.add(this.now() - start);
  }
  private startLife(c: Connection) {
    const p = c.room!.state.players.get(c.id!)!;
    c.record = { runId: crypto.randomUUID(), playerId: c.storedId!, team: p.team, started: this.wallNow() };
    this.writer.enqueue({ ...c.record }, saved => { if (!saved) this.drops.add(this.now(), "saveErrors"); });
  }
  private finishLife(c: Connection, result: LifeResult, reason: EndReason = "death") {
    if (!c.record || c.record.result) return;
    c.record = { ...c.record, result: { ...result }, ended: this.wallNow(), reason };
    c.result = { v: 1, type: "life_over", ...result, save: "pending", reason };
    // Terminal messages are independent of cosmetic snapshot backpressure.
    if (!c.closed) this.sendTerminal(c, c.result);
    const terminal = c.result;
    this.writer.enqueue(c.record, saved => {
      terminal.save = saved ? "saved" : "failed";
      if (!saved) this.drops.add(this.now(), "saveErrors");
      if (!c.closed && c.result === terminal) this.sendTerminal(c, terminal);
    });
    c.pending = undefined; c.held = neutralInput();
  }
  private sendTerminal(c: Connection, message: LifeOver | ServerRestart) {
    this.send(c, JSON.stringify(message));
  }
  private send(c: Connection, payload: string | Uint8Array) {
    const now = this.now(); c.traffic.add(now, "attempted");
    try {
      const result = c.socket.send(payload);
      if (result === 0) { c.traffic.add(now, "rejected"); return false; }
      c.traffic.add(now, "accepted"); c.traffic.add(now, "bytesOut", typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength);
      if (result === -1) c.traffic.add(now, "queued");
      return true;
    } catch (error) { c.traffic.add(now, "transportErrors"); console.error("Arena send failed", error); return false; }
  }
  leave(c: Connection) {
    if (c.closed) return;
    if (c.room && c.id) { const result = endLife(c.room.state, c.id); if (result) this.finishLife(c, result, this.stopped ? "restart" : "disconnect"); }
    c.closed = true; clearTimeout(c.helloTimer); this.connections.delete(c);
    for (const record of this.history.values()) if (record.traffic === c.traffic) record.leftAt = this.now();
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
    for (const [id, metric] of this.metrics) if (!this.rooms.has(id) && metric.tick.samples(this.now() - HISTORY_MS).length === 0) this.metrics.delete(id);
    for (const [id, record] of this.history) if (record.leftAt !== undefined && record.leftAt < this.now() - HISTORY_MS) this.history.delete(id);
    this.rateLimitExamples = this.rateLimitExamples.filter(e => e.at >= this.now() - HISTORY_MS);
  }
  private snapshotSizes(key: keyof Sizes, since: number, until: number) {
    const counts = new Map<number, number>();
    for (const metric of this.metrics.values()) for (const bytes of metric.sizes[key].samples(since, until)) counts.set(bytes, (counts.get(bytes) ?? 0) + 1);
    return byteDistribution(counts);
  }
  stats(query?: { sinceMs: number; untilMs: number; raw?: boolean }) {
    // Merge raw samples across rooms so a quiet room cannot distort percentiles.
    this.expireMetrics();
    const rooms = [...this.rooms.values()];
    const now = this.now();
    const window = query ? (() => {
      const { sinceMs: since, untilMs: until, raw = false } = query;
      const participants = [...this.history.values()].filter(p => p.joinedAt < until && (p.leftAt ?? Infinity) >= since);
      const perPlayer = participants.map(p => { const totals = p.traffic.totals(since, until); return { playerId: p.playerId, arenaId: p.arenaId, joinedAt: p.joinedAt, leftAt: p.leftAt,
        ...totals, bytesPerSecondOut: totals.bytesOut * 1000 / (until - since) }; });
      const traffic = emptyTraffic(); for (const player of perPlayer) for (const k of TRAFFIC_KEYS) traffic[k] += player[k];
      const population = (members: typeof participants) => {
        let current = members.filter(p => p.joinedAt <= since && (p.leftAt ?? Infinity) > since).length, min = current, max = current;
        const changes = members.flatMap(p => [ ...(p.joinedAt > since && p.joinedAt < until ? [{ at: p.joinedAt, n: 1 }] : []), ...(p.leftAt !== undefined && p.leftAt > since && p.leftAt < until ? [{ at: p.leftAt, n: -1 }] : []) ]).sort((a,b) => a.at-b.at);
        for (const change of changes) { current += change.n; min = Math.min(min, current); max = Math.max(max, current); }
        return { min, max };
      };
      return { sinceMs: since, untilMs: until, complete: since >= this.startedAt && since >= now - HISTORY_MS && until <= Math.floor(now / STEP_MS) * STEP_MS,
        traffic, perPlayer, population: population(participants), dropped: this.drops.totals(since, until), rateLimitExamples: this.rateLimitExamples.filter(e => e.at >= since && e.at < until),
        snapshotBytes: Object.fromEntries(["all", "keyframe", "delta", "json"].map(key => [key, this.snapshotSizes(key as keyof Sizes, since, until)])) as Record<keyof Sizes, ReturnType<typeof byteDistribution>>,
        tick: TickMetrics.combine([...this.metrics.values()].map(m => m.tick), since, until, raw),
        schedulerLateness: TickMetrics.combine([...this.metrics.values()].map(m => m.lateness), since, until, raw),
        arenas: [...this.metrics].map(([id, m]) => ({ id, population: population(participants.filter(p => p.arenaId === id)), tick: m.tick.stats(since, until, raw), schedulerLateness: m.lateness.stats(since, until, raw) })) };
    })() : undefined;
    return { serverNowMs: now, retainedSinceMs: Math.max(this.startedAt, now - HISTORY_MS), window,
      buildId: this.buildId, arenas: rooms.map(r => ({ id: r.id, players: r.members.size })), totalPlayers: this.active.size,
      tick: TickMetrics.combine([...this.metrics.values()].map(m => m.tick)),
      schedulerLateness: TickMetrics.combine([...this.metrics.values()].map(m => m.lateness)), dropped: { ...this.dropped } };
  }
  stop(deadline = performance.now() + 4000): Promise<boolean> {
    if (this.stopping) return this.stopping;
    this.stopped = true; clearInterval(this.moderation);
    for (const room of this.rooms.values()) this.cancel(room.timer);
    const clients = [...this.connections];
    for (const c of clients) {
      clearTimeout(c.helloTimer); c.pending = undefined; c.held = neutralInput();
      if (c.room && c.id) { const result = endLife(c.room.state, c.id); if (result) this.finishLife(c, result, "restart"); }
    }
    return this.stopping = (async () => {
      let saved = false;
      try { saved = await this.writer.drain(deadline); }
      catch (error) { console.error("Arena shutdown drain failed", error); }
      finally { for (const c of clients) {
        if (c.result?.reason === "restart" && c.result.save === "pending") c.result.save = "failed";
        if (!c.closed) {
          this.sendTerminal(c, { v: 1, type: "server_restart", ...(c.result?.reason === "restart" ? { result: c.result } : {}) });
          try { c.socket.close(1012, "server-restarting"); } catch (error) { console.error("Arena restart close failed", error); }
        }
        this.leave(c);
      } }
      return saved;
    })();
  }
}
