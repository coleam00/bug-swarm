import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { openDb } from "../db";
import { parseServer, type ServerMessage } from "../../shared/arena/protocol";

for (const scenario of ["SIGTERM", "SIGINT", "locked-deadline"] as const) test(`production entry shutdown ${scenario} (${process.platform === "win32" ? "registered-handler harness" : "OS signal"})`, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-process-")), home = join(scratch, "home"), data = join(scratch, "data");
  mkdirSync(home); mkdirSync(join(scratch, "dist"));
  writeFileSync(join(scratch, "dist/build.json"), JSON.stringify({ buildId: "packaged-test-commit" }));
  const entry = join(import.meta.dir, "../main.ts");
  const command = process.platform === "win32" ? [process.execPath, "--eval", `await import(${JSON.stringify(pathToFileURL(entry).href)}); process.stdin.on('data', raw => { for (const signal of raw.toString().trim().split(/\\s+/)) process.emit(signal); });`] : [process.execPath, entry];
  const child = Bun.spawn(command, { cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    DATA_DIR: data, PORT: "0", NODE_ENV: "development", RAILWAY_GIT_COMMIT_SHA: "runtime-must-not-win", BUILD_ID: "runtime-must-not-win" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let output = "", errors = "", lock: Database | undefined;
  const read = async (stream: ReadableStream<Uint8Array>, append: (text: string) => void) => {
    const reader = stream.getReader();
    try { while (true) { const { done, value } = await reader.read(); if (done) break; append(new TextDecoder().decode(value)); } } finally { reader.releaseLock(); }
  };
  const stdout = read(child.stdout, text => { output += text; }), stderr = read(child.stderr, text => { errors += text; });
  const clients: { socket: WebSocket; id: string; messages: ServerMessage[]; close: Promise<number> }[] = [];
  const until = async (predicate: () => boolean) => { const deadline = performance.now() + 3000; while (!predicate() && performance.now() < deadline) await Bun.sleep(5); expect(predicate(), output + errors).toBe(true); };
  try {
    await until(() => /App on http:\/\/127\.0\.0\.1:\d+/.test(output));
    const origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)![0];
    for (let i = 0; i < 2; i++) {
      const id = crypto.randomUUID(), socket = new WebSocket(origin.replace("http", "ws") + "/ws"), messages: ServerMessage[] = [];
      socket.onopen = () => socket.send(JSON.stringify({ v: 1, type: "hello", playerId: id, name: `Pilot-${i}`, team: "tabs", touch: true, buildId: "test" }));
      socket.onmessage = event => { const m = parseServer(event.data); if (m) messages.push(m); };
      const close = new Promise<number>(resolve => { socket.onclose = event => resolve(event.code); });
      clients.push({ socket, id, messages, close });
    }
    await until(() => clients.every(c => c.messages.some(m => m.type === "snapshot" && m.tick >= 3 && m.players.some(p => p.id === c.id && p.hits > 0))));
    expect((await (await fetch(origin + "/api/arena/stats")).json()).buildId).toBe("packaged-test-commit");
    for (const c of clients) expect(c.messages.find(m => m.type === "welcome")).toMatchObject({ buildId: "packaged-test-commit" });
    if (scenario !== "SIGINT") { lock = new Database(join(data, "app.db")); lock.exec("BEGIN IMMEDIATE"); }
    const start = performance.now();
    const signal = scenario === "SIGINT" ? "SIGINT" : "SIGTERM";
    const send = () => { if (process.platform === "win32") { child.stdin.write(signal + "\n"); child.stdin.flush(); } else child.kill(signal); };
    send(); send();
    if (scenario === "SIGTERM") { await Bun.sleep(80); lock!.exec("ROLLBACK"); }
    const exit = await child.exited;
    const elapsed = performance.now() - start; expect(elapsed).toBeLessThan(5000);
    await Promise.all([stdout, stderr]); expect(exit, errors).toBe(scenario === "locked-deadline" ? 1 : 0);
    for (const c of clients) {
      expect(await c.close).toBe(1012);
      expect(c.messages.find(m => m.type === "server_restart")).toMatchObject({ result: { reason: "restart", save: scenario === "locked-deadline" ? "failed" : "saved" } });
    }
    if (scenario === "locked-deadline") { expect(errors).toContain("shutdown save deadline"); lock!.exec("ROLLBACK"); }
    lock?.close(); lock = undefined;
    const db = openDb(join(data, "app.db"));
    try {
      const rows = db.query("SELECT * FROM runs WHERE ended_at_ms IS NOT NULL").all() as any[];
      expect(rows).toHaveLength(scenario === "locked-deadline" ? 0 : 2);
      for (const row of rows) {
        const packet = clients.find(c => c.id === row.player_id)!.messages.find(m => m.type === "server_restart");
        if (packet?.type !== "server_restart") throw Error("Missing restart");
        expect(row).toMatchObject({ end_reason: "restart", score: packet.result!.score, squashes: packet.result!.kills, seconds: Math.floor(packet.result!.seconds), touch: 1, held: 0, team: "tabs" });
        expect(db.query("SELECT count(*) AS n FROM events WHERE run_id = ? AND type = 'run_ended'").get(row.id)).toEqual({ n: 1 });
      }
    } finally { db.close(); }
  } finally {
    for (const c of clients) c.socket.close();
    if (child.exitCode === null) { child.kill(); await child.exited; }
    await Promise.all([stdout, stderr]); lock?.close(); rmSync(scratch, { recursive: true, force: true });
  }
}, 12000);
