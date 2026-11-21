import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
test("connection backoff, team retry, build reload, refused identities and disposal", () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-connection-")), home = join(scratch, "home"); mkdirSync(home);
  const probe = `
import assert from "node:assert/strict";
const sockets = [], timers = new Map(); let id = 0, reloads = 0, disconnects = 0;
globalThis.setTimeout = (fn, delay) => { const key = ++id; timers.set(key, {fn, delay}); return key; };
globalThis.clearTimeout = key => timers.delete(key);
globalThis.location = { href: "https://arena.test/arena", protocol: "https:", reload: () => reloads++ };
globalThis.WebSocket = class {
  static OPEN = 1; readyState = 1; bufferedAmount = 0; sent = [];
  constructor(url) { assert.equal(String(url), "wss://arena.test/ws"); sockets.push(this); }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.(); }
};
const { connectArena } = await import(${JSON.stringify(pathToFileURL(join(import.meta.dir, "connection.ts")).href)});
const identity = { playerId: crypto.randomUUID(), name: "Robot", team: "tabs" };
const messages = [], statuses = [];
const connect = () => connectArena(identity, true, m => messages.push(m), s => statuses.push(s), () => disconnects++);
const welcome = buildId => ({ v: 1, type: "welcome", playerId: identity.playerId, arenaId: "room", buildId, world: { width: 2400, height: 2400 }, constants: { stepMs: 50, playerSpeed: 180, playerRadius: 14, maxPlayers: 20 } });
const receive = m => sockets.at(-1).onmessage({ data: JSON.stringify(m) });
const retry = expected => { const [key, t] = timers.entries().next().value; assert.equal(t.delay, expected); timers.delete(key); t.fn(); sockets.at(-1).onopen(); };
let connection = connect(); sockets.at(-1).onopen(); assert.equal(sockets.at(-1).sent[0].buildId, "unknown");
for (const delay of [250,500,1000,2000,4000,5000,5000]) { sockets.at(-1).close(); retry(delay); }
receive(welcome("one")); sockets.at(-1).close(); retry(250); assert.equal(sockets.at(-1).sent[0].buildId, "one");
receive(welcome("two")); assert.equal(reloads, 1); connection.dispose(); assert.equal(timers.size, 0);
connection = connect(); sockets.at(-1).onopen(); receive({ v: 1, type: "error", code: "team-conflict", message: "Restored", team: "spaces" });
sockets.at(-1).close(); retry(250); assert.equal(sockets.at(-1).sent[0].team, "spaces");
receive({ v: 1, type: "error", code: "team-conflict", message: "Restored", team: "tabs" }); sockets.at(-1).close(); assert.equal(timers.size, 0); connection.dispose();
connection = connect(); sockets.at(-1).onopen(); receive({ v: 1, type: "error", code: "name-hidden", message: "Unavailable" }); sockets.at(-1).close(); assert.equal(timers.size, 0); connection.dispose();
connection = connect(); sockets.at(-1).onopen(); sockets.at(-1).close(); assert.equal(timers.size, 1); connection.dispose(); assert.equal(timers.size, 0);
assert.ok(disconnects > 0);
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], { cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, stdout: "pipe", stderr: "pipe", timeout: 10000 });
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
