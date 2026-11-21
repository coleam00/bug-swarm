import type { Identity } from "../../shared/api";
import { parseServer, type InputMessage, type Respawn, type ServerMessage } from "../../shared/arena/protocol";
import { clearResume, resumeStore, type ResumeStore } from "./resume";
declare const __ARENA_BUILD_ID__: string;
type State = "connecting" | "connected" | "reconnecting" | "reloading" | "refused" | "disposed";
interface Dependencies {
  href?: string;
  socket: (url: URL) => WebSocket;
  schedule: typeof setTimeout;
  cancel: typeof clearTimeout;
  reload: () => void;
  store: ResumeStore;
  pageBuild: string;
}
export function connectArena(identity: Identity, touch: boolean, receive: (message: ServerMessage) => void, status: (message: string) => void, disconnected: () => void, dependencies: Partial<Dependencies> = {}) {
  const deps: Dependencies = { socket: url => new WebSocket(url), schedule: setTimeout.bind(globalThis), cancel: clearTimeout.bind(globalThis), reload: () => location.reload(), store: resumeStore,
    pageBuild: typeof __ARENA_BUILD_ID__ === "undefined" ? "development" : __ARENA_BUILD_ID__, ...dependencies };
  let socket: WebSocket | undefined, state: State = "connecting", retryTeam = false;
  let timer: ReturnType<typeof setTimeout> | undefined, backoff = 500, buildId = deps.pageBuild, restartStatus = "";
  const active = () => state !== "disposed" && state !== "refused" && state !== "reloading";
  function retry() {
    if (!active() || timer !== undefined) return;
    state = "reconnecting"; disconnected(); status(restartStatus || "Reconnecting...");
    timer = deps.schedule(() => { timer = undefined; connect(); }, backoff);
    backoff = Math.min(5000, backoff * 2);
  }
  function connect() {
    if (!active()) return;
    if (state === "connecting") status("Connecting...");
    const url = new URL("/ws", deps.href ?? location.href); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    let ws: WebSocket;
    try { ws = deps.socket(url); socket = ws; } catch (error) { console.error("Arena socket creation failed", error); retry(); return; }
    const current = () => socket === ws && active();
    ws.onopen = () => { if (current()) ws.send(JSON.stringify({ v: 1, type: "hello", ...identity, touch, buildId })); };
    ws.onmessage = event => {
      if (!current()) return;
      const message = parseServer(event.data);
      if (!message) { console.error("Invalid arena server message"); return; }
      if (message.type === "welcome") {
        const changed = message.buildId !== deps.pageBuild;
        const previous = deps.store.read();
        if (changed && !previous?.attempted.includes(message.buildId)) {
          const envelope = { identity: { ...identity }, touch, target: message.buildId, attempted: [...(previous?.attempted ?? []), message.buildId], resume: true };
          if (deps.store.write(envelope)) {
            state = "reloading"; disconnected(); deps.cancel(timer); timer = undefined; deps.reload(); return;
          }
        }
        buildId = message.buildId; backoff = 500; state = "connected";
        if (!restartStatus) status("");
      }
      if (message.type === "snapshot" && state === "connected" && message.players.some(p => p.id === identity.playerId.toLowerCase() && p.hits > 0)) {
        restartStatus = ""; status("");
      }
      if (message.type === "server_restart") {
        restartStatus = message.result ? message.result.save === "saved" ? `Score saved: ${message.result.score}. Rejoining...` : "Score save failed. Rejoining..." : "Reconnecting...";
        state = "reconnecting"; status(restartStatus);
      }
      if (message.type === "error") {
        if (message.code === "restarting" || message.code === "hello-timeout") return;
        if (message.code === "team-conflict" && message.team && !retryTeam) { retryTeam = true; identity.team = message.team; return; }
        state = "refused"; clearResume(deps.store);
      }
      receive(message);
    };
    ws.onerror = () => { if (current()) ws.close(); };
    ws.onclose = () => { if (socket !== ws) return; socket = undefined; retry(); };
  }
  connect();
  return {
    get state() { return state; },
    send(input: InputMessage | Respawn): boolean {
      touch ||= input.touch;
      if (state !== "connected" || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount) return false;
      socket.send(JSON.stringify(input)); return true;
    },
    reconnect() { socket?.close(); },
    dispose() {
      const reloading = state === "reloading";
      state = "disposed"; deps.cancel(timer); timer = undefined;
      if (!reloading) clearResume(deps.store);
      if (socket) { socket.onclose = null; socket.onmessage = null; socket.onerror = null; socket.onopen = null; socket.close(); socket = undefined; }
    },
  };
}
