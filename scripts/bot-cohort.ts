import { STEP_MS } from "../src/shared/arena/constants";
import type { Hello, InputMessage, Snapshot } from "../src/shared/arena/protocol";
import { ServerDecoder } from "../src/shared/arena/snapshot-codec";
import { createPolicy, policyInput } from "../src/shared/arena/policies";
import { TEAMS } from "../src/shared/teams";
import type { BotOptions } from "./bots";
import { validateName } from "../src/server/rules";
export function botName(index: number): string {
  const candidate = "bot-" + String(index + 1).padStart(2, "0");
  if (!validateName(candidate).error) return candidate;
  const fallback = "bot-" + index.toString(16);
  if (validateName(fallback).error) throw new Error("No valid bot name for " + index);
  return fallback;
}
export function createCohort(options: BotOptions, indexOffset: number, fail: (error: Error) => void) {
  const sockets: WebSocket[] = [], workloads: (() => void)[] = [], arenas = new Set<string>(), playerIds: string[] = [];
  const joining = { sent: 0, received: 0, bytesReceived: 0 };
  const client = { sent: 0, received: 0, bytesReceived: 0, schedulerSkips: 0, minInputSendGapMs: Infinity };
  const lifecycle = { prematureDisconnects: 0, normalTeardownConnections: 0 };
  let start = Infinity, end = Infinity, joins = 0, disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
  const now = () => performance.timeOrigin + performance.now();
  const measured = () => { const at = now(); return at >= start && at < end; };
  const send = (socket: WebSocket, value: unknown) => { socket.send(JSON.stringify(value)); if (measured()) client.sent++; else if (start === Infinity) joining.sent++; };
  const url = new URL("/ws", options.url); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ready = Promise.all(Array.from({ length: options.count }, (_, localIndex) => new Promise<void>(resolve => {
    const index = indexOffset + localIndex, playerId = crypto.randomUUID(), name = botName(index), socket = new WebSocket(url); sockets.push(socket);
    playerIds.push(playerId);
    const decoder = new ServerDecoder(); socket.binaryType = "arraybuffer";
    let seq = 0, welcomed = false, snapshot: Snapshot | undefined, respawned = 0, lastInputAt = -Infinity;
    const policy = createPolicy(index + 1);
    socket.onopen = () => send(socket, { v: 1, type: "hello", playerId, name, team: TEAMS[index % TEAMS.length]!, touch: false, buildId: "bots", ...(process.env.BOT_SNAPSHOT_ENCODING === "json" ? {} : { snapshotEncoding: "delta-v1" as const }) } satisfies Hello);
    socket.onmessage = event => {
      const bytes = typeof event.data === "string" ? Buffer.byteLength(event.data) : event.data.byteLength;
      if (measured()) { client.received++; client.bytesReceived += bytes; }
      else if (start === Infinity) { joining.received++; joining.bytesReceived += bytes; }
      let message;
      try { message = decoder.read(event.data); } catch (error) { fail(new Error(name + ": invalid server message: " + error)); return; }
      if (!message) { fail(new Error(name + ": missing snapshot base")); return; }
      if (message.type === "error") { fail(new Error(name + ": " + message.code + ": " + message.message)); return; }
      if (message.type === "life_over" && message.save === "failed") fail(new Error(name + ": score save failed"));
      if (message.type === "snapshot") snapshot = message;
      if (message.type === "welcome" && !welcomed) {
        welcomed = true; joins++; arenas.add(message.arenaId); resolve();
        workloads.push(() => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (socket.bufferedAmount) { if (measured()) client.schedulerSkips++; return; }
          const p = snapshot?.players.find(p => p.id === playerId); if (!p || !snapshot) return;
          if (p.status === "out") { if (respawned !== p.life) { send(socket, { v: 1, type: "respawn", life: p.life, touch: false }); respawned = p.life; } return; }
          const at = performance.now(); client.minInputSendGapMs = Math.min(client.minInputSendGapMs, at - lastInputAt); lastInputAt = at;
          send(socket, { v: 1, type: "input", seq: ++seq, life: p.life, touch: false, ...policyInput(options.policy ?? "aimer", snapshot, p, policy) } satisfies InputMessage);
        });
      }
    };
    socket.onerror = () => fail(new Error(name + ": transport error"));
    socket.onclose = () => { if (!disposed) { lifecycle.prematureDisconnects++; fail(new Error(name + ": premature disconnect")); } };
  }))).then(() => {});
  let next = performance.now() + STEP_MS;
  const pump = () => {
    const at = performance.now();
    if (at >= next) {
      // Admission and clock calibration must not queue inputs behind pending
      // hellos. Start every cohort at the same measured boundary, then keep a
      // full step between sends even after a delayed callback.
      if (start !== Infinity && now() >= start) for (const work of workloads) work();
      next = performance.now() + STEP_MS;
    }
    if (!disposed) timer = setTimeout(pump, Math.max(1, next - performance.now()));
  }; timer = setTimeout(pump, STEP_MS);
  return {
    ready,
    stats: () => ({ joins, arenas: [...arenas], playerIds, joining, client, lifecycle }),
    window(startEpoch: number, endEpoch: number) { start = startEpoch; end = endEpoch; },
    async close() {
      disposed = true; clearTimeout(timer);
      await Promise.all(sockets.map(socket => new Promise<void>(resolve => {
        if (socket.readyState === WebSocket.CLOSED) { resolve(); return; }
        const timeout = setTimeout(() => { (socket as WebSocket & { terminate(): void }).terminate(); resolve(); }, 1000);
        socket.onclose = () => { lifecycle.normalTeardownConnections++; clearTimeout(timeout); resolve(); }; socket.close();
      })));
    },
  };
}
export type CohortStats = ReturnType<ReturnType<typeof createCohort>["stats"]>;
