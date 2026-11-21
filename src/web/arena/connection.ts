import type { Identity } from "../../shared/api";
import { parseServer, type InputMessage, type ServerMessage } from "../../shared/arena/protocol";
export function connectArena(identity: Identity, touch: boolean, receive: (message: ServerMessage) => void, status: (message: string) => void, disconnected: () => void) {
  let socket: WebSocket | undefined, disposed = false, refused = false, retryTeam = false;
  let timer: ReturnType<typeof setTimeout> | undefined, backoff = 250, buildId = "unknown";
  function connect() {
    if (disposed) return;
    status("Connecting…");
    const url = new URL("/ws", location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url); socket = ws;
    ws.onopen = () => ws.send(JSON.stringify({ v: 1, type: "hello", ...identity, touch, buildId }));
    ws.onmessage = event => {
      const message = parseServer(event.data);
      if (!message) { console.error("Invalid arena server message"); return; }
      if (message.type === "welcome") {
        if (buildId !== "unknown" && buildId !== message.buildId) { location.reload(); return; }
        buildId = message.buildId; backoff = 250; status("");
      }
      if (message.type === "error") {
        if (message.code === "team-conflict" && message.team && !retryTeam) { retryTeam = true; identity.team = message.team; }
        else { refused = true; }
      }
      receive(message);
    };
    ws.onerror = () => { status("Connection lost. Reconnecting…"); };
    ws.onclose = () => {
      disconnected(); if (disposed || refused) return;
      status("Reconnecting…"); timer = setTimeout(connect, backoff); backoff = Math.min(5000, backoff * 2);
    };
  }
  connect();
  return {
    send(input: InputMessage): boolean { if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount) return false; socket.send(JSON.stringify(input)); return true; },
    reconnect() { socket?.close(); },
    dispose() { disposed = true; clearTimeout(timer); if (socket) { socket.onclose = null; socket.onmessage = null; socket.onerror = null; socket.onopen = null; socket.close(); } },
  };
}
