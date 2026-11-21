import { join } from "node:path";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { scratchEnv } from "./options";
import type { ServerObservation, LifeObservation } from "./types";
import { bounded } from "./browser";
export class OwnedServer {
  private child?: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private serial = 0;
  private pending = new Map<number, { resolve: (v: ServerObservation) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  origin = ""; generation = 0;
  shutdownLives: LifeObservation[] = [];
  private reader?: Promise<void>;
  private errorReader?: Promise<number>;
  constructor(readonly root: string, readonly assets: string, readonly seed: number) { mkdirSync(root, { recursive: true }); }
  async start(warmup = 0, bots = 0) {
    const port = this.origin ? new URL(this.origin).port : "0";
    this.generation++;
    const env = { ...scratchEnv(this.root), NODE_ENV: "production", ARENA_PLAYTEST: "1", PLAYTEST_ROOT: this.root, PLAYTEST_PORT: port, PLAYTEST_DATA: join(this.root, "data"), PLAYTEST_ASSETS: this.assets, PLAYTEST_SEED: String(this.seed), PLAYTEST_GENERATION: String(this.generation), PLAYTEST_WARMUP: String(warmup), PLAYTEST_BOTS: String(bots) };
    const child = this.child = Bun.spawn([process.execPath, join(import.meta.dir, "server-child.ts")], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.errorReader = Bun.write(join(this.root, `server-${this.generation}.log`), child.stderr);
    let ready!: () => void, failed!: (e: Error) => void;
    const startup = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
    this.reader = (async () => {
      const decoder = new TextDecoder(); let buffer = "";
      const reader = child.stdout.getReader();
      try { while (true) {
        const { done, value: chunk } = await reader.read(); if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        for (let end; (end = buffer.indexOf("\n")) >= 0;) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          const m = JSON.parse(line);
          if (m.ready) { this.origin = m.origin; ready(); }
          else { const p = this.pending.get(m.id); if (p) { clearTimeout(p.timer); this.pending.delete(m.id); p.resolve(m.value); } }
        }
      } } finally { reader.releaseLock(); }
    })();
    void this.reader.catch(failed);
    void child.exited.then(code => { failed(Error(`Owned server exited ${code}`)); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error(`Owned server exited ${code}`)); } this.pending.clear(); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([startup, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Owned server startup timed out")), 30000); })]); }
    finally { clearTimeout(timer); }
  }
  observe(): Promise<ServerObservation> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error("Server observation timed out")); }, 5000); this.pending.set(id, { resolve, reject, timer }); this.child!.stdin.write(JSON.stringify({ id, method: "observe" }) + "\n"); });
  }
  async stop() {
    const child = this.child; if (!child) return;
    if (child.exitCode === null) {
      child.stdin.write('{"method":"stop"}\n');
      await bounded(child.exited, 6000, "Owned server exit").catch(() => {});
      if (child.exitCode === null) { child.kill(); await child.exited; throw Error("Owned server failed graceful shutdown deadline"); }
    }
    await this.reader; await this.errorReader;
    const final = join(this.root, `shutdown-${this.generation}.json`);
    if (existsSync(final)) this.shutdownLives = JSON.parse(readFileSync(final, "utf8"));
    this.child = undefined;
    if (child.exitCode !== 0) throw Error(`Owned server exited ${child.exitCode}`);
  }
}
