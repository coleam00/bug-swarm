// Injected only by the load evidence harness; never shipped to players.
import { ServerDecoder } from "../src/shared/arena/snapshot-codec";
const evidence: any = (window as any).loadEvidence = { snapshot: null, welcome: null, errors: [] as string[], warnings: [] as string[], gaps: [] as number[], cadence: [] as number[] };
const Native = WebSocket;
(window as any).WebSocket = class extends Native {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols); const decoder = new ServerDecoder(); let last = 0;
    this.addEventListener("message", event => {
      try {
        const message = decoder.read(event.data);
        if (!message) { evidence.errors.push("missing snapshot base"); return; }
        if (message.type === "welcome") evidence.welcome = message;
        if (message.type === "snapshot") { const now = performance.now(); if (last) evidence.cadence.push(now - last); last = now; evidence.snapshot = message; }
      } catch (error) { evidence.errors.push(String(error)); }
    });
  }
};
window.addEventListener("error", e => evidence.errors.push(String(e.message)));
window.addEventListener("unhandledrejection", e => evidence.errors.push(String(e.reason)));
const error = console.error, warn = console.warn;
console.error = (...args) => { evidence.errors.push(args.map(String).join(" ")); error(...args); };
console.warn = (...args) => { evidence.warnings.push(args.map(String).join(" ")); warn(...args); };
let last = 0;
function frame(now: number) { if (last) { evidence.gaps.push(now - last); if (evidence.gaps.length > 14400) evidence.gaps.shift(); } last = now; requestAnimationFrame(frame); }
requestAnimationFrame(frame);
