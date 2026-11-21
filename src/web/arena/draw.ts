import { PLAYER_RADIUS, WORLD_HEIGHT, WORLD_WIDTH, HEAT_CAPACITY, HEAT_WARNING, STEP_MS, MAX_EVENTS } from "../../shared/arena/constants";
import { TEAM_COLOURS, TEAMS } from "../../shared/teams";
import type { Player, CombatPlayer, Bug, Shot, KillEvent } from "../../shared/arena/types";
import type { ArenaInput } from "./input";
import type { Snapshot } from "../../shared/arena/protocol";
import { drawMinimap, minimapBounds } from "./minimap";
export class ArenaRenderer {
  private hudKey = ""; private hudText = ""; private hudFont = 20;
  private bursts = Array.from({ length: MAX_EVENTS }, () => ({ x: 0, y: 0, points: 0, at: -Infinity }));
  private burstIndex = 0; private lastEvent = 0; private time = 0;
  reset() { this.lastEvent = 0; this.burstIndex = 0; for (const e of this.bursts) e.at = -Infinity; }
  events(events: KillEvent[], now: number) { for (const e of events) if (e.id > this.lastEvent) { Object.assign(this.bursts[this.burstIndex++ % this.bursts.length]!, e, { at: now }); } for (const e of events) this.lastEvent = Math.max(this.lastEvent, e.id); }
  private floor: CanvasPattern | null;
  private glows = new Map<string, HTMLCanvasElement>();
  private labels = new Map<string, HTMLCanvasElement>();
  constructor(private ctx: CanvasRenderingContext2D) {
    const tile = document.createElement("canvas"); tile.width = tile.height = 48;
    const c = tile.getContext("2d")!; c.fillStyle = "#0c1420"; c.fillRect(0, 0, 48, 48);
    c.strokeStyle = "#1a2b3c"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 48); c.lineTo(0, 0); c.lineTo(48, 0); c.stroke();
    this.floor = ctx.createPattern(tile, "repeat");
    for (const team of TEAMS) {
      const glow = document.createElement("canvas"); glow.width = glow.height = 100;
      const g = glow.getContext("2d")!, gradient = g.createRadialGradient(50, 50, 2, 50, 50, 50);
      gradient.addColorStop(0, TEAM_COLOURS[team] + "66"); gradient.addColorStop(1, TEAM_COLOURS[team] + "00");
      g.fillStyle = gradient; g.fillRect(0, 0, 100, 100); this.glows.set(team, glow);
    }
  }
  draw(width: number, height: number, camera: { x: number; y: number }, players: Player[], local: Player | null, input: ArenaInput, bugs: Bug[] = [], shots: Shot[] = [], wave = 0, tick = 0, now = 0, scale = 1, snapshot?: Snapshot | null) {
    this.time = tick * STEP_MS;
    const c = this.ctx, worldWidth = width / scale, worldHeight = height / scale;
    c.fillStyle = "#060b12"; c.fillRect(0, 0, width, height);
    c.save(); c.scale(scale, scale); c.translate(-camera.x, -camera.y); c.fillStyle = this.floor!; c.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    c.strokeStyle = "#38546b"; c.lineWidth = 4; c.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    for (const id of this.labels.keys()) if (!players.some(p => p.id === id)) this.labels.delete(id);
    for (const b of bugs) {
      if (b.x < camera.x - 30 || b.x > camera.x + worldWidth + 30 || b.y < camera.y - 30 || b.y > camera.y + worldHeight + 30) continue;
      c.save(); c.translate(b.x, b.y); c.rotate(Math.atan2(b.vy, b.vx));
      c.strokeStyle = "#e39281"; c.lineWidth = 2; c.beginPath();
      for (let i = -1; i <= 1; i++) { const leg = Math.sin(now / 80 + b.id + i) * 4; c.moveTo(i * 7, -6); c.lineTo(i * 9 + leg, -19); c.moveTo(i * 7, 6); c.lineTo(i * 9 - leg, 19); } c.stroke();
      c.fillStyle = "#a74951"; c.beginPath(); c.ellipse(0, 0, 13, 10, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#f5af88"; c.beginPath(); c.moveTo(-10, 0); c.lineTo(10, 0); c.stroke(); c.fillStyle = "#ffe1a6"; c.fillRect(6, -6, 3, 3); c.fillRect(6, 3, 3, 3); c.restore();
    }
    c.lineCap = "round";
    for (const s of shots) {
      if (s.x < camera.x - 40 || s.x > camera.x + worldWidth + 40 || s.y < camera.y - 40 || s.y > camera.y + worldHeight + 40) continue;
      const length = Math.hypot(s.vx, s.vy), dx = s.vx / length * 22, dy = s.vy / length * 22;
      c.strokeStyle = "#ffc26055"; c.lineWidth = 9; c.beginPath(); c.moveTo(s.x - dx, s.y - dy); c.lineTo(s.x, s.y); c.stroke();
      c.strokeStyle = "#fff6c8"; c.lineWidth = 3; c.stroke();
    }
    for (const p of players) if (p.id !== local?.id) this.robot(p, false, camera, worldWidth, worldHeight);
    if (local) this.robot(local, true, camera, worldWidth, worldHeight);
    for (const e of this.bursts) {
      const age = now - e.at; if (age < 0 || age > 700) continue;
      c.globalAlpha = 1 - age / 700; c.strokeStyle = "#ffce79"; c.lineWidth = 2;
      c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = 8 + age / 22; c.moveTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r); c.lineTo(e.x + Math.cos(a) * (r + 7), e.y + Math.sin(a) * (r + 7)); } c.stroke();
      c.fillStyle = "#fff1bd"; c.font = "bold 18px system-ui"; c.textAlign = "center"; c.fillText(`+${e.points}`, e.x, e.y - 18 - age / 30); c.globalAlpha = 1;
    }
    c.restore();
    if (local && "life" in local) {
      const p = snapshot?.players.find(p => p.id === local.id) ?? local as CombatPlayer;
      const population = snapshot?.players.length ?? players.length;
      const key = `${p.score}/${p.streak}/${p.hits}/${wave}/${population}/${width}/${height}`;
      if (key !== this.hudKey) {
        this.hudKey = key; this.hudFont = Math.min(width, height) < 600 ? 16 : 20;
        const text = (score: string) => `${score} pts  ×${Math.min(3, 1 + p.streak / 10).toFixed(1)}  ${p.hits} hits  W${wave}  ${population} in this arena`;
        this.hudText = text(p.score.toLocaleString()); c.font = `bold ${this.hudFont}px system-ui`;
        if (c.measureText(this.hudText).width > width - 32) this.hudText = text(Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(p.score));
        while (c.measureText(this.hudText).width > width - 32 && this.hudFont > 12) c.font = `bold ${--this.hudFont}px system-ui`;
      }
      c.fillStyle = "#060b12cc"; c.fillRect(8, 8, width - 16, 34);
      c.textAlign = "left"; c.fillStyle = "#eff4db"; c.font = `bold ${this.hudFont}px system-ui`; c.fillText(this.hudText, 16, 32);
    }
    drawMinimap(c, minimapBounds(width, height, WORLD_WIDTH, WORLD_HEIGHT), WORLD_WIDTH, WORLD_HEIGHT, players, local, bugs);
    for (const s of [input.stick, input.right]) if (s) {
      const length = Math.hypot(s.dx, s.dy), scale = Math.min(1, 60 / (length || 1));
      c.strokeStyle = "#ffffff55"; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, 60, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#ffffff66"; c.beginPath(); c.arc(s.x + s.dx * scale, s.y + s.dy * scale, 22, 0, Math.PI * 2); c.fill();
    }

  }

  private robot(p: Player, local: boolean, camera: { x: number; y: number }, width: number, height: number) {
    const combat = p as CombatPlayer; if (combat.hits === 0) return;
    if (p.x < camera.x - 70 || p.x > camera.x + width + 70 || p.y < camera.y - 70 || p.y > camera.y + height + 70) return;
    const c = this.ctx, colour = TEAM_COLOURS[p.team], r = PLAYER_RADIUS;
    if (combat.immuneUntil > this.time && Math.floor(this.time / 100) % 2) c.globalAlpha = 0.4;
    c.drawImage(this.glows.get(p.team)!, p.x - 50, p.y - 50);
    if (combat.spawnProtectedUntil > this.time) {
      c.strokeStyle = "#b8efff"; c.lineWidth = 2; c.beginPath();
      const angle = this.time / 160;
      c.arc(p.x, p.y, r + 15 + Math.sin(this.time / 100) * 2, angle, angle + Math.PI * 1.4); c.stroke();
      c.strokeStyle = "#7fdcff66"; c.lineWidth = 5; c.beginPath();
      c.arc(p.x, p.y, r + 18, -angle, -angle + Math.PI); c.stroke();
    }
    if (local) { c.strokeStyle = "#fff0bd"; c.lineWidth = 2.5; c.beginPath(); c.arc(p.x, p.y, r + 8, 0, Math.PI * 2); c.stroke(); }
    c.save(); c.translate(p.x, p.y); c.rotate(p.facing);
    c.fillStyle = colour; c.fillRect(8, -4, 17, 8);
    c.fillStyle = "#142536"; c.strokeStyle = colour; c.lineWidth = 2;
    c.beginPath(); c.roundRect(-r, -r, r * 2, r * 2, 7); c.fill(); c.stroke();
    c.fillStyle = colour; c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff5d8"; c.beginPath(); c.arc(1, -1, 2.5, 0, Math.PI * 2); c.fill(); c.restore();
    let label = this.labels.get(p.id);
    if (!label) {
      label = document.createElement("canvas");
      const l = label.getContext("2d")!; l.font = "bold 14px system-ui"; l.textAlign = "center";
      const measured = l.measureText(p.name);
      const halfWidth = Math.max(measured.width / 2, measured.actualBoundingBoxLeft, measured.actualBoundingBoxRight);
      label.width = Math.ceil(halfWidth * 2) + 8; label.height = 30;
      // Resizing clears canvas state. Include stroke padding around the measured glyph bounds.
      l.font = "bold 14px system-ui"; l.textAlign = "center";
      l.strokeStyle = "#060b12"; l.lineWidth = 4; l.strokeText(p.name, label.width / 2, 20); l.fillStyle = colour; l.fillText(p.name, label.width / 2, 20);
      this.labels.set(p.id, label);
    }
    c.drawImage(label, p.x - label.width / 2, p.y - 54);
    c.globalAlpha = 1;
    if (combat.heat !== undefined) {
      const lock = combat.overheatUntil > this.time, warning = combat.heat / HEAT_CAPACITY >= HEAT_WARNING;
      c.fillStyle = "#030810"; c.fillRect(p.x - 20, p.y + 25, 40, 6);
      c.fillStyle = lock ? "#ff6767" : warning && Math.floor(this.time / 100) % 2 ? "#ffffff" : "#ffbc62";
      c.fillRect(p.x - 19, p.y + 26, 38 * combat.heat / HEAT_CAPACITY, 4);
      if (lock) { c.font = "bold 10px system-ui"; c.textAlign = "center"; c.fillStyle = "#ff8f86"; c.fillText("HOT", p.x, p.y + 44); }
    }
  }
}
