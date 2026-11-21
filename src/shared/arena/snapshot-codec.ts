import { MAX_PLAYERS, MAX_BUGS, MAX_SHOTS, MAX_EVENTS, MAX_GLOBS, SERVER_MESSAGE_BYTES } from "./constants";
import { validateServer, type Snapshot, type ServerMessage } from "./protocol";
// delta-v1: typed fields and baseline-index references; append-only extension cell
// retains future bug-kind payloads without encoding their behaviour here.
type Cell = number | string | boolean | null;
type Field = readonly [string, "n" | "s" | "b", number?];
const motion: Field[] = [["x","n",8],["y","n",8],["vx","n",16],["vy","n",16]];
const schemas: Field[][] = [
  [["id","s"],["name","s"],["team","s"],...motion,["facing","n",1024],["status","s"],["downedUntil","n",1000],["reviveMs","n",1000],["reviving","b"],["life","n"],["hits","n"],["heat","n",1000],["overheatUntil","n",1000],["nextShotAt","n",1000],["immuneUntil","n",1000],["spawnProtectedUntil","n",1000],["streak","n"],["points","n"],["score","n"],["kills","n"],["startedTick","n"],["touch","b"],["ackSeq","n"],["result","s"],["__extra","s"]],
  // Keep the frequently changing fields in the low mask bits. Facing uses
  // finer precision so quantized motion satisfies the existing kind validators.
  [["id","n"],...motion,["facing","n",2048],["hp","n"],["kind","s"],["phase","s"],["phaseUntil","n"],["__extra","s"]],
  [["id","n"],["owner","s"],["life","n"],...motion,["born","n",1000],["__extra","s"]],
  [["id","n"],["tick","n"],["x","n",8],["y","n",8],["points","n",1000],["kind","s"],["type","s"],["__extra","s"]],
  [["id","n"],...motion,["born","n",1000],["__extra","s"]],
];
const groups = ["players","bugs","shots","events","globs"] as const;
const caps = [MAX_PLAYERS, MAX_BUGS, MAX_SHOTS, MAX_EVENTS, MAX_GLOBS];
const knownFields = schemas.map(schema => new Set(schema.map(f => f[0])));
const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const MAX = Number.MAX_SAFE_INTEGER;
class Writer {
  private buffer = new Uint8Array(SERVER_MESSAGE_BYTES);
  private view = new DataView(this.buffer.buffer);
  length = 0;
  private strings = new Map<string, number>();
  reset() { this.length = 0; this.strings.clear(); }
  seedStrings(values: Cell[][]) { this.strings.clear(); for (const row of values) this.strings.set(row[0] as string, this.strings.size); }
  byte(value: number) { if (this.length >= this.buffer.length) throw Error("Snapshot exceeds wire limit"); this.buffer[this.length++] = value; }
  // Sign-magnitude varints: six low bits plus sign, then seven bits per byte.
  // Arithmetic (not bitwise shifts) preserves all 53 safe integer bits.
  signed(value: number) {
    if (!Number.isSafeInteger(value)) throw Error("Unsafe wire integer");
    const sign = value < 0 ? 64 : 0; let n = Math.abs(value);
    const low = n % 64; n = Math.floor(n / 64); this.byte(low + sign + (n ? 128 : 0));
    while (n) { const low = n % 128; n = Math.floor(n / 128); this.byte(low + (n ? 128 : 0)); }
  }
  text(value: string | null) {
    if (value === null) { this.signed(0); return; }
    const ref = this.strings.get(value); if (ref !== undefined) { this.signed(-ref - 1); return; }
    const bytes = encoder.encode(value); this.signed(bytes.length + 1); for (const b of bytes) this.byte(b);
    this.strings.set(value, this.strings.size);
  }
  number(value: Cell, previous: Cell, scale: number) {
    if (value === null) { this.signed(-MAX); return; }
    if (typeof value !== "number") throw Error("Invalid numeric cell");
    const difference = Math.round((value - (typeof previous === "number" ? previous : 0)) * scale);
    if (Number.isSafeInteger(difference) && Math.abs(difference) !== MAX && Math.abs((typeof previous === "number" ? previous : 0) + difference / scale - value) < 1e-7) this.signed(difference);
    else { this.signed(MAX); if (this.length + 8 > this.buffer.length) throw Error("Snapshot exceeds wire limit"); this.view.setFloat64(this.length, value, true); this.length += 8; }
  }
  finish() { return this.buffer.slice(0, this.length); } // transport owns an immutable copy
}
class Reader {
  private index = 0; private view: DataView;
  private strings: string[] = [];
  constructor(private bytes: Uint8Array) { if (!bytes.length || bytes.length > SERVER_MESSAGE_BYTES) throw Error("Invalid frame size"); this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  byte() { if (this.index >= this.bytes.length) throw Error("Truncated frame"); return this.bytes[this.index++]!; }
  signed() {
    const first = this.byte(); let value = first % 64, multiplier = 64, byte = first;
    while (byte >= 128) { byte = this.byte(); const digit = byte % 128; if (digit > (MAX - value) / multiplier) throw Error("Unsafe varint"); value += digit * multiplier; multiplier *= 128; if (multiplier > MAX * 128) throw Error("Long varint"); }
    return first % 128 >= 64 ? -value : value;
  }
  unsigned(cap = MAX) { const n = this.signed(); if (n < 0 || n > cap) throw Error("Invalid count/reference"); return n; }
  seedStrings(values: Cell[][]) { this.strings = values.map(row => { if (typeof row[0] !== "string") throw Error("Invalid player reference"); return row[0]; }); }
  text() {
    const size = this.signed();
    if (size < 0) { const value = this.strings[-size - 1]; if (value === undefined) throw Error("Invalid string reference"); return value; }
    if (!size) return null;
    if (size > SERVER_MESSAGE_BYTES + 1 || this.index + size - 1 > this.bytes.length) throw Error("Truncated text");
    const text = decoder.decode(this.bytes.subarray(this.index, this.index + size - 1)); this.index += size - 1;
    if (this.strings.length >= 2048) throw Error("Too many strings"); this.strings.push(text); return text;
  }
  number(previous: Cell, scale: number) {
    const difference = this.signed();
    if (difference === -MAX) return null;
    if (difference === MAX) { if (this.index + 8 > this.bytes.length) throw Error("Truncated number"); const n = this.view.getFloat64(this.index, true); this.index += 8; if (!Number.isFinite(n)) throw Error("Invalid number"); return n; }
    const value = (typeof previous === "number" ? previous : 0) + difference / scale;
    return Math.abs(value) <= MAX / scale ? Math.round(value * scale) / scale : value;
  }
  done() { if (this.index !== this.bytes.length) throw Error("Trailing frame bytes"); }
}
type State = { arenaId: string; tick: number; wave: number; groups: Cell[][][] };
function cells(snapshot: Snapshot): State {
  return { arenaId: snapshot.arenaId, tick: snapshot.tick, wave: snapshot.wave, groups: groups.map((group, g) => snapshot[group].map(entity => {
    const record = entity as unknown as Record<string, unknown>, schema = schemas[g]!;
    const known = knownFields[g]!, extra: Record<string, unknown> = {};
    for (const key of Object.keys(record)) if (!known.has(key)) extra[key] = record[key];
    return schema.map(([key, type, scale = 1]) => {
      if (key === "__extra") return Object.keys(extra).length ? JSON.stringify(extra, (_k, v) => typeof v === "number" && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v) : null;
      const value = record[key];
      if (value === undefined) return null;
      if (key === "result") return JSON.stringify(value);
      if (type === "n") return Math.abs(value as number) <= MAX / scale ? Math.round((value as number) * scale) / scale : value as number;
      return value as Cell;
    });
  })) };
}
function snapshot(state: State, knownNames: ReadonlySet<string>): Snapshot {
  const result: Record<string, unknown> = { v: 1, type: "snapshot", arenaId: state.arenaId, tick: state.tick, wave: state.wave };
  for (let g = 0; g < groups.length; g++) result[groups[g]!] = state.groups[g]!.map(row => {
    const record: Record<string, unknown> = {};
    schemas[g]!.forEach(([key], i) => { const cell = row[i]; if (cell === null) return; if (key === "__extra") { const extra = JSON.parse(cell as string); if (!extra || Array.isArray(extra) || typeof extra !== "object") throw Error("Invalid extension"); for (const k of Object.keys(extra)) { if (schemas[g]!.some(f => f[0] === k) || ["__proto__","constructor","prototype"].includes(k)) throw Error("Invalid extension key"); record[k] = extra[k]; } } else record[key] = key === "result" ? JSON.parse(cell as string) : cell; });
    return record;
  });
  const valid = validateServer(result, knownNames); if (valid?.type !== "snapshot") throw Error("Invalid reconstructed snapshot");
  return valid;
}
function writeFrame(writer: Writer, current: State, previous?: State) {
  writer.reset(); writer.byte(0xb5); writer.byte(1); writer.byte(previous ? 1 : 0);
  writer.text(current.arenaId); writer.signed(current.tick); if (previous) writer.signed(previous.tick); writer.signed(current.wave);
  for (let g = 0; g < groups.length; g++) {
    const old = previous?.groups[g] ?? [], rows = current.groups[g]!, schema = schemas[g]!;
    const indices = new Map(old.map((row, i) => [row[0], i]));
    const surviving = new Set(rows.map(row => row[0]));
    const removed = old.flatMap((row, i) => surviving.has(row[0]) ? [] : [i]);
    writer.signed(removed.length); for (const index of removed) writer.signed(index);
    const changes: { ref: number; row: Cell[]; base: Cell[]; mask: number }[] = [];
    rows.forEach(row => {
      const index = indices.get(row[0]), base = index === undefined ? [] : old[index]!;
      let mask = 0; for (let f = 0; f < schema.length; f++) if (row[f] !== (base[f] ?? null)) mask += 2 ** f;
      if (mask || index === undefined) changes.push({ ref: index === undefined ? 0 : index + 1, row, base, mask });
    });
    writer.signed(changes.length);
    for (const { ref, row, base, mask } of changes) {
      writer.signed(ref); writer.signed(mask);
      for (let f = 0; f < schema.length; f++) if (Math.floor(mask / 2 ** f) % 2) {
        const [, type, scale = 1] = schema[f]!, value = row[f]!;
        if (type === "n") writer.number(value, base[f] ?? null, scale);
        else if (type === "s") writer.text(value as string | null);
        else writer.byte(value ? 1 : 0);
      }
    }
    if (g === 0) writer.seedStrings(rows);
  }
  return writer.finish();
}
export class SnapshotEncoder {
  private previous?: State;
  private writer = new Writer();
  encode(value: Snapshot) {
    const current = cells(value), previous = this.previous;
    const keyframe = writeFrame(this.writer, current);
    const reordered = previous && current.groups.some((rows, g) => {
      const indices = new Map(previous.groups[g]!.map((row, i) => [row[0], i]));
      let last = -1, born = false;
      for (const row of rows) { const index = indices.get(row[0]); if (index === undefined) born = true; else { if (born || index < last) return true; last = index; } }
      return false;
    });
    const periodic = !previous || previous.arenaId !== current.arenaId || current.tick <= previous.tick || current.tick % 20 === 0 || !!reordered;
    const delta = periodic ? keyframe : writeFrame(this.writer, current, previous);
    this.previous = current;
    return { tick: current.tick, baseTick: periodic ? undefined : previous.tick, keyframe, delta, periodic };
  }
}
export class ServerDecoder {
  private state?: State;
  // Names are immutable between admission changes. Avoid running the entire
  // moderation vocabulary for the same 20 names on every snapshot.
  private names = new Set<string>();
  missingBases = 0;
  reset() { this.state = undefined; this.names.clear(); }
  read(raw: unknown): ServerMessage | null {
    if (typeof raw === "string") {
      if (encoder.encode(raw).length > SERVER_MESSAGE_BYTES) throw Error("Oversized server JSON");
      let value: unknown; try { value = JSON.parse(raw); } catch { throw Error("Invalid server JSON"); }
      const message = validateServer(value, this.names); if (!message) throw Error("Invalid server message");
      if (message.type === "welcome") this.reset();
      if (message.type === "snapshot") this.names = new Set(message.players.map(p => p.name));
      return message;
    }
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw instanceof Uint8Array ? raw : undefined;
    if (!bytes) throw Error("Unsupported snapshot frame");
    const r = new Reader(bytes);
    if (r.byte() !== 0xb5 || r.byte() !== 1) throw Error("Unsupported snapshot codec");
    const mode = r.byte(); if (mode > 1) throw Error("Invalid snapshot mode");
    const arenaId = r.text(), tick = r.unsigned(), baseTick = mode ? r.unsigned() : undefined, wave = r.unsigned();
    if (!arenaId) throw Error("Missing arena");
    const base = this.state;
    if (mode && (!base || base.arenaId !== arenaId || base.tick !== baseTick)) { this.missingBases++; return null; }
    if (base && base.arenaId === arenaId && tick < base.tick) throw Error("Snapshot tick regressed");
    const current: State = { arenaId, tick, wave, groups: [] };
    for (let g = 0; g < groups.length; g++) {
      const old = mode ? base!.groups[g]! : [], schema = schemas[g]!, cap = caps[g]!;
      const removed = new Set<number>(), count = r.unsigned(cap);
      for (let n = 0; n < count; n++) { const index = r.unsigned(old.length - 1); if (removed.has(index)) throw Error("Duplicate removal"); removed.add(index); }
      const updated = new Map<number, Cell[]>(), births: Cell[][] = [], changes = r.unsigned(cap);
      for (let n = 0; n < changes; n++) {
        const ref = r.unsigned(old.length), index = ref - 1;
        if (ref && (removed.has(index) || updated.has(index))) throw Error("Duplicate entity change");
        const row: Cell[] = ref ? [...old[index]!] : schema.map(() => null), mask = r.unsigned(2 ** schema.length - 1);
        for (let f = 0; f < schema.length; f++) if (Math.floor(mask / 2 ** f) % 2) {
          const [, type, scale = 1] = schema[f]!;
          if (type === "n") row[f] = r.number(row[f]!, scale);
          else if (type === "s") row[f] = r.text();
          else { const b = r.byte(); if (b > 1) throw Error("Invalid boolean"); row[f] = !!b; }
        }
        if (ref) updated.set(index, row); else births.push(row);
      }
      const rows = old.flatMap((row, i) => removed.has(i) ? [] : [updated.get(i) ?? row]).concat(births);
      if (rows.length > cap || new Set(rows.map(row => row[0])).size !== rows.length) throw Error("Invalid entity population");
      current.groups.push(rows);
      if (g === 0) r.seedStrings(rows);
    }
    r.done();
    const value = snapshot(current, this.names); this.state = current; this.names = new Set(value.players.map(p => p.name)); return value;
  }
}
