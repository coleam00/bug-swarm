import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

for (const scenario of ["living", "respawn-before-snapshot"] as const) test(`real engine retains its socket through a delayed restart save (${scenario})`, () => {
  const scratch = mkdtempSync(join(tmpdir(), "arena-restart-client-")), home = join(scratch, "home"); mkdirSync(home);
  const moduleUrl = (file: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, file)).href);
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { createServer } from ${moduleUrl("../../server/server.ts")};
let draws = 0, clientCloses = 0, predictedLife;
mock.module(${moduleUrl("draw.ts")}, () => ({ ArenaRenderer: class { reset() {} events() {} draw(_width, _height, _camera, _players, local) { draws++; predictedLife = local?.life; } } }));
globalThis.window = Object.assign(new EventTarget(), { devicePixelRatio: 1 });
globalThis.document = new EventTarget();
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = fn => setTimeout(() => fn(performance.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
const NativeSocket = WebSocket;
globalThis.WebSocket = class extends NativeSocket { close(...args) { clientCloses++; return super.close(...args); } };
const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: "data", env: {} });
globalThis.location = { href: "http://127.0.0.1:" + app.server.port + "/arena", reload() { throw Error("Unexpected reload"); } };
const canvas = Object.assign(new EventTarget(), { clientWidth: 390, clientHeight: 844, dataset: {}, getContext: () => ({ setTransform() {} }), hasPointerCapture: () => false });
const { mountArena } = await import(${moduleUrl("engine.ts")});
const identity = { playerId: crypto.randomUUID(), name: "Pilot", team: "tabs" }, statuses = [], panels = [];
let cleanup, lock, release, requestRespawn, stopping, runId;
const until = async predicate => { const deadline = performance.now() + 2000; while (!predicate() && performance.now() < deadline) await Bun.sleep(5); assert.ok(predicate(), "Timed out: " + statuses.join(" | ")); };
try {
  cleanup = mountArena(canvas, identity, false, value => statuses.push(value), message => { throw Error(message); }, () => {}, (result, respawn) => { panels.push(result); requestRespawn = respawn; });
  await until(() => app.arenas.active.has(identity.playerId) && predictedLife === 1);
  const c = app.arenas.active.get(identity.playerId);
  const p = c.room.state.players.get(c.id);
  const stop = () => {
    p.score = 142; runId = c.record.runId;
    stopping = app.stop();
    release = setTimeout(() => lock.exec("ROLLBACK"), 3500);
  };
  if (${JSON.stringify(scenario)} === "respawn-before-snapshot") {
    // Produce an ordinary death and let the real client request its next life.
    p.hits = 1; p.immuneUntil = 0; p.spawnProtectedUntil = 0;
    c.room.state.bugs = [{ id: 999, kind: "crawler", hp: 1, facing: 0, x: p.x, y: p.y, vx: 0, vy: 0 }];
    app.arenas.tick(c.room);
    await until(() => panels.at(-1)?.life === 1);
    app.arenas.writer.flush();
    const message = app.arenas.message.bind(app.arenas);
    app.arenas.message = (connection, raw) => {
      message(connection, raw);
      if (connection === c && p.life === 2 && !stopping) {
        // Stop in the same callback that accepted respawn: no replacement
        // snapshot can reach prediction before the terminal result for life 2.
        assert.equal(predictedLife, 1); stop();
      }
    };
    lock = new Database("data/app.db"); lock.exec("BEGIN IMMEDIATE");
    requestRespawn(false);
    await until(() => !!stopping);
    assert.equal(p.life, 2);
  } else {
    app.arenas.writer.flush();
    lock = new Database("data/app.db"); lock.exec("BEGIN IMMEDIATE"); stop();
  }
  await Bun.sleep(80); // allow the pending result to arrive before sampling the frozen scene
  const frozen = draws;
  await Bun.sleep(3200);
  assert.equal(clientCloses, 0, "Client must wait for the final receipt beyond its normal snapshot timeout");
  assert.equal(draws, frozen, "Pending restart freezes prediction/rendering");
  if (${JSON.stringify(scenario)} === "respawn-before-snapshot") assert.equal(predictedLife, 1, "No respawn snapshot established the authoritative life number");
  assert.ok(statuses.some(value => /reconnect/i.test(value)), "Pending restart shows reconnect feedback");
  assert.ok(!statuses.some(value => /saved/i.test(value)), "Pending persistence cannot claim success");
  assert.equal(await stopping, true);
  await until(() => statuses.some(value => /saved/i.test(value) && value.includes("142")));
  assert.equal(panels.at(-1), null, "Restart clears any ordinary death dialog");
  assert.ok(panels.every(value => value === null || value.reason === "death"), "Restart never opens a death dialog");
  const saved = new Database("data/app.db", { readonly: true });
  try { assert.deepEqual(saved.query("SELECT score, end_reason FROM runs WHERE id = ?").get(runId), { score: 142, end_reason: "restart" }); }
  finally { saved.close(); }
} finally {
  clearTimeout(release); try { lock?.exec("ROLLBACK"); } catch {}
  cleanup?.(); await app.stop(); lock?.close();
}
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], { cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home }, stdout: "pipe", stderr: "pipe", timeout: 12000 });
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}, 15000);
