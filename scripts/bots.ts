import { STEP_MS } from "../src/shared/arena/constants";
import { parseServer, type Hello, type InputMessage, type Snapshot } from "../src/shared/arena/protocol";
import { createPolicy, policyInput, type Policy } from "../src/shared/arena/policies";
import { validateName } from "../src/server/rules";
import { TEAMS } from "../src/shared/teams";
export interface BotOptions { url: string; count: number; seconds: number; policy?: Policy }
export function parseBotArgs(args: string[]): BotOptions {
  const options: BotOptions = { url: "http://127.0.0.1:3000", count: 18, seconds: 60, policy: "aimer" };
  const seen = new Set<string>();
  if (args[0] === "--") args = args.slice(1);
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!, value = args[i + 1];
    if (!["--url", "--count", "--seconds", "--policy"].includes(flag) || seen.has(flag) || !value) throw new Error("Usage: bun run bots -- --url <origin> --count <n> --seconds <s> --policy mover|aimer");
    seen.add(flag);
    if (flag === "--policy") { if (value !== "mover" && value !== "aimer") throw new Error("--policy must be mover or aimer"); options.policy = value; }
    else if (flag === "--url") options.url = value;
    else {
      if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${flag} must be a positive safe integer`);
      if (flag === "--count") options.count = Number(value); else options.seconds = Number(value);
    }
  }
  const url = new URL(options.url);
  if (!/^https?:\/\/[^/?#\\\s]+\/?$/i.test(options.url) || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("--url must be an HTTP(S) origin");
  if (options.seconds * 1000 > 2147483647 || options.count > 10000) throw new Error("Requested workload is too large");
  options.url = url.origin;
  return options;
}
export function botName(index: number): string {
  const candidate = `bot-${String(index + 1).padStart(2, "0")}`;
  if (!validateName(candidate).error) return candidate;
  const fallback = `bot-${index.toString(16)}`;
  if (validateName(fallback).error) throw new Error(`No valid bot name for ${index}`);
  return fallback;
}
export async function runBots(options: BotOptions, signal?: AbortSignal) {
  const sockets: WebSocket[] = [], timers: ReturnType<typeof setInterval>[] = [], arenas = new Set<string>();
  let sent = 0, received = 0, joins = 0, finished = false, start = performance.now(), durationTimer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let fail!: (error: Error) => void;
  const failure = new Promise<never>((_, reject) => { fail = reject; });
  // Attach a handler immediately: transport errors can occur before the measured phase.
  void failure.catch(() => {});
  const abort = () => { fail(new Error("Bot run interrupted")); controller.abort(); }; signal?.addEventListener("abort", abort, { once: true });
  const url = new URL("/ws", options.url); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const joinTimer = setTimeout(() => fail(new Error(`Join timeout: ${joins}/${options.count}`)), 10000);
  try {
    if (signal?.aborted) throw new Error("Bot run interrupted");
    const joining = Array.from({ length: options.count }, (_, index) => new Promise<void>((resolve, reject) => {
      const playerId = crypto.randomUUID(), name = botName(index), socket = new WebSocket(url); sockets.push(socket);
      let seq = 0, welcomed = false, snapshot: Snapshot | undefined, respawned = 0;
      const policy = createPolicy(index + 1);
      socket.onopen = () => {
        socket.send(JSON.stringify({ v: 1, type: "hello", playerId, name, team: TEAMS[index % TEAMS.length]!, touch: false, buildId: "bots" } satisfies Hello)); sent++;
      };
      socket.onmessage = event => {
        received++; const message = parseServer(event.data);
        if (!message) { fail(new Error(`${name}: invalid server message`)); return; }
        if (message.type === "error") { fail(new Error(`${name}: ${message.code}: ${message.message}`)); return; }
        if (message.type === "snapshot") snapshot = message;
        if (message.type === "welcome" && !welcomed) {
          welcomed = true; joins++; arenas.add(message.arenaId); resolve();
          timers.push(setInterval(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            const p = snapshot?.players.find(p => p.id === playerId); if (!p || !snapshot) return;
            if (p.status === "out") { if (respawned !== p.life) { socket.send(JSON.stringify({ v: 1, type: "respawn", life: p.life, touch: false })); sent++; respawned = p.life; } return; }
            const message: InputMessage = { v: 1, type: "input", seq: ++seq, life: p.life, touch: false, ...policyInput(options.policy ?? "aimer", snapshot, p, policy) };
            socket.send(JSON.stringify(message)); sent++;
          }, STEP_MS));
        }
      };
      socket.onerror = () => { const error = new Error(`${name}: transport error`); reject(error); fail(error); };
      socket.onclose = () => { if (!finished) fail(new Error(`${name}: premature disconnect`)); };
    }));
    await Promise.race([Promise.all(joining), failure]); clearTimeout(joinTimer); start = performance.now();
    await Promise.race([new Promise<void>(resolve => { durationTimer = setTimeout(resolve, options.seconds * 1000); }), failure]);
    const response = await Promise.race([fetch(new URL("/api/arena/stats", options.url), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]), redirect: "error" }), failure]);
    const stats = await Promise.race([response.json(), failure]);
    if (!response.ok || !stats || !Array.isArray(stats.arenas) || stats.totalPlayers < options.count || !stats.tick ||
      !Number.isFinite(stats.tick.p50Ms) || !Number.isFinite(stats.tick.p95Ms)) throw new Error("Unavailable or invalid arena stats");
    const elapsed = (performance.now() - start) / 1000;
    return { requested: options.count, joins, arenas: [...arenas], arenaCount: arenas.size, sent, received,
      policy: options.policy ?? "aimer", messagesPerSecond: { sent: sent / elapsed, received: received / elapsed }, errors: 0, tick: stats.tick, schedulerLateness: stats.schedulerLateness };
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}; joins ${joins}/${options.count}, arenas ${arenas.size}, sent ${sent}, received ${received}, errors 1`, { cause: error });
  } finally {
    finished = true; clearTimeout(joinTimer); clearTimeout(durationTimer); for (const timer of timers) clearInterval(timer);
    controller.abort(); signal?.removeEventListener("abort", abort);
    await Promise.all(sockets.map(socket => new Promise<void>(resolve => {
      if (socket.readyState === WebSocket.CLOSED) { resolve(); return; }
      const timeout = setTimeout(() => { (socket as WebSocket & { terminate(): void }).terminate(); resolve(); }, 1000);
      socket.onclose = () => { clearTimeout(timeout); resolve(); }; socket.close();
    })));
  }
}
if (import.meta.main) {
  const controller = new AbortController(), abort = () => controller.abort();
  process.once("SIGINT", abort); process.once("SIGTERM", abort);
  try { console.log(JSON.stringify(await runBots(parseBotArgs(process.argv.slice(2)), controller.signal), null, 2)); }
  catch (error) { console.error("Bots failed:", error); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
}
