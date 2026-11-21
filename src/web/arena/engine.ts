import type { Identity } from "../../shared/api";
import { SNAPSHOT_TIMEOUT_MS, STEP_MS } from "../../shared/arena/constants";
import type { InputMessage, LifeOver, Snapshot } from "../../shared/arena/protocol";
import { connectArena } from "./connection";
import { ArenaInput, bindInput } from "./input";
import { Prediction } from "./prediction";
import { Interpolation } from "./interpolation";
import { cameraFor } from "./camera";
import { ArenaRenderer } from "./draw";
export function mountArena(canvas: HTMLCanvasElement, identity: Identity, touch: boolean,
  status: (message: string) => void, refused: (message: string, team?: Identity["team"], code?: string) => void, accepted: () => void = () => {},
  lifeView: (result: LifeOver | null, respawn: (touch: boolean) => void) => void = () => {}) {
  const ctx = canvas.getContext("2d")!, renderer = new ArenaRenderer(ctx), input = new ArenaInput();
  const prediction = new Prediction(), interpolation = new Interpolation();
  let seq = 0, ready = false, lastSnapshot = 0, lastSend = performance.now(), previous = lastSend;
  let width = 0, height = 0, dpr = 1, camera = { x: 0, y: 0 }, frames = 0, sampleAt = previous, cost = 0;
  let showStats = false, readout = "", raf = 0, disposed = false;
  let latest: Snapshot | null = null, deadLife = 0, shownLife = 0, shownSave = "";
  const respawn = (usedTouch: boolean) => { if (ready && deadLife) { input.clear(); connection.send({ v: 1, type: "respawn", life: deadLife, touch: usedTouch }); } };
  const showLife = (result: LifeOver) => {
    if (result.life !== prediction.player?.life || prediction.player.hits || shownLife === result.life && shownSave === result.save) return;
    shownLife = result.life; shownSave = result.save; lifeView(result, respawn);
  };
  const reset = () => { lastSend = performance.now(); };
  const clear = () => { ready = false; seq = 0; input.clear(); prediction.reset(); interpolation.clear(); renderer.reset(); latest = null; deadLife = shownLife = 0; shownSave = ""; lifeView(null, respawn); reset(); };
  const connection = connectArena(identity, touch, message => {
    if (message.type === "error") { refused(message.message, message.team, message.code); return; }
    if (message.type === "welcome") { clear(); ready = true; lastSnapshot = performance.now(); accepted(); return; }
    if (!ready) return;
    if (message.type === "life_over") { showLife(message); return; }
    const own = message.players.find(p => p.id === identity.playerId.toLowerCase());
    if (!own) return;
    if (message.tick < lastTick) return;
    lastTick = message.tick; lastSnapshot = performance.now();
    prediction.reconcile(own); interpolation.push(message, lastSnapshot);
    latest = message;
    if (!own.hits) {
      if (deadLife !== own.life) { input.blockHeld(); input.clear(); deadLife = own.life; }
      if (own.result) showLife(own.result);
    } else if (deadLife) { deadLife = 0; input.clear(); lifeView(null, respawn); }
  }, status, () => { clear(); lastTick = -1; });
  let lastTick = -1;
  const unbind = bindInput(canvas, input, (x, y) => {
    const p = prediction.player; return p ? Math.atan2(y + camera.y - p.y, x + camera.x - p.x) : 0;
  }, () => { showStats = !showStats; }, reset, usedTouch => { if (!deadLife) return false; respawn(usedTouch); return true; });
  const resize = () => {
    width = canvas.clientWidth; height = canvas.clientHeight; dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    input.clear(); reset();
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const sendTimer = setInterval(() => {
    const now = performance.now();
    if (!ready) return;
    if (now - lastSnapshot > SNAPSHOT_TIMEOUT_MS) { clear(); connection.reconnect(); return; }
    if (!prediction.player?.hits) return;
    const message: InputMessage = { v: 1, type: "input", seq: ++seq, life: prediction.player.life, touch: input.touch, ...input.sample() };
    if (connection.send(message)) { lastSend = now; if (!prediction.advance(message)) { clear(); connection.reconnect(); } }
  }, STEP_MS);
  function frame(now: number) {
    if (disposed) return;
    const start = performance.now(), elapsed = Math.min(100, now - previous); previous = now;
    const local = prediction.visual(input.sample(), (now - lastSend) / STEP_MS, elapsed);
    if (local) camera = cameraFor(local.x, local.y, width, height);
    const combat = interpolation.combat(now);
    renderer.events(combat.events, now);
    renderer.draw(width, height, camera, interpolation.players(now), local, input, combat.bugs, combat.shots, latest?.wave ?? 0, latest?.tick ?? 0, now);
    cost += performance.now() - start; frames++;
    if (now - sampleAt >= 1000) {
      const fps = frames * 1000 / (now - sampleAt), ms = cost / frames;
      readout = `${fps.toFixed(1)} FPS · ${ms.toFixed(2)} ms/frame`;
      canvas.dataset.fps = fps.toFixed(1); canvas.dataset.frameMs = ms.toFixed(3);
      canvas.dataset.players = String(interpolation.players(now).length);
      if (local) { canvas.dataset.x = local.x.toFixed(2); canvas.dataset.y = local.y.toFixed(2); }
      frames = 0; cost = 0; sampleAt = now;
    }
    if (showStats) { ctx.fillStyle = "#060b12dd"; ctx.fillRect(10, height - 40, 290, 30); ctx.font = "14px monospace"; ctx.fillStyle = "#e3eee8"; ctx.fillText(readout, 20, height - 20); }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  return () => { disposed = true; clearInterval(sendTimer); cancelAnimationFrame(raf); observer.disconnect(); unbind(); connection.dispose(); clear(); };
}
