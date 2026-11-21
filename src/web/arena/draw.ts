import { PLAYER_RADIUS, WORLD_HEIGHT, WORLD_WIDTH, HEAT_CAPACITY, HEAT_WARNING, STEP_MS, MAX_EVENTS, DOWNED_MS, REVIVE_MS } from "../../shared/arena/constants";
import { TEAM_COLOURS, TEAMS } from "../../shared/teams";
import type { Player, CombatPlayer, Bug, Shot, Glob, CombatEvent, BugKind, Pickup, PickupKind } from "../../shared/arena/types";
import { createGlobDraw, GLOB_EXTENT } from "./globs";
import { BUG_DRAW, createBugDraws, type BugDraw } from "./bugs/registry";
import type { ArenaInput } from "./input";
import { EdgeMarkers, type MarkerObstacle } from "./edge-markers";
import { hiveWarning } from "./hive-warning";
import type { Snapshot } from "../../shared/arena/protocol";
import { drawMinimap, minimapBounds } from "./minimap";
import { createPickupDraws, pickupAlpha, effectRemaining, type PickupDraw } from "./pickups/registry";
import { PICKUPS, PICKUP_KINDS } from "../../shared/arena/pickups/registry";
import type { PaintTrace } from "./observation";
import { HiveHud } from "./hive-hud";
import { personalLevel } from "./level";
declare const __ARENA_PLAYTEST__: boolean;
const observing = typeof __ARENA_PLAYTEST__ === "undefined" || __ARENA_PLAYTEST__;
export class ArenaRenderer {
  private hudKey = ""; private hudText = ""; private hudFont = 20;
  private pickupDraw: Record<PickupKind, PickupDraw>;
  private bugDraw: Record<BugKind, BugDraw>;
  private globDraw = createGlobDraw();
  private hiveHud = new HiveHud();
  private edgeMarkers: EdgeMarkers;
  private pickupHud: MarkerObstacle = { x: 10, y: 0, width: 0, height: 44 };
  private downedPanel: MarkerObstacle = { x: 8, y: 0, width: 0, height: 0 };
  private bursts = Array.from({ length: MAX_EVENTS }, () => ({ id: 0, tick: 0, x: 0, y: 0, points: 0, type: "kill", at: -Infinity }));
  private burstIndex = 0; private lastEvent = 0; private time = 0; private animationTime = 0;
  reset() { this.edgeMarkers.reset(); this.hiveHud.reset(); this.lastEvent = 0; this.burstIndex = 0; for (const e of this.bursts) e.at = -Infinity; }
  events(events: CombatEvent[], now: number) { for (const e of events) if (e.id > this.lastEvent) { this.hiveHud.event(e, now); Object.assign(this.bursts[this.burstIndex++ % this.bursts.length]!, e, { at: now }); } for (const e of events) this.lastEvent = Math.max(this.lastEvent, e.id); }
  private floor: CanvasPattern | null;
  private glows = new Map<string, HTMLCanvasElement>();
  private labels = new Map<string, HTMLCanvasElement>();
  constructor(private ctx: CanvasRenderingContext2D, private trace?: PaintTrace) {
    this.bugDraw = createBugDraws(); this.pickupDraw = createPickupDraws();
    this.edgeMarkers = new EdgeMarkers(ctx);
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
  draw(width: number, height: number, camera: { x: number; y: number }, players: Player[], local: Player | null, input: ArenaInput, bugs: Bug[] = [], shots: Shot[] = [], wave = 0, tick = 0, now = 0, scale = 1, snapshot?: Snapshot | null, combatTime = tick * STEP_MS, globs: Glob[] = [], pickups: readonly Pickup[] = []) {
    if (observing && this.trace) { this.trace.players = []; this.trace.bugs = []; this.trace.effects = []; this.trace.shots = []; this.trace.minimap = []; this.trace.hud = undefined; this.trace.hive = undefined; this.trace.hiveRewards = []; }
    this.time = tick * STEP_MS;
    this.animationTime = now;
    const c = this.ctx, worldWidth = width / scale, worldHeight = height / scale;
    const boss = (snapshot?.bugs ?? bugs).find(b => b.kind === "hive"), visibleBoss = bugs.find(b => b.kind === "hive");
    const warning = hiveWarning(snapshot);
    const map = minimapBounds(width, height, WORLD_WIDTH, WORLD_HEIGHT, !!boss || !!visibleBoss || warning !== null);
    c.fillStyle = "#060b12"; c.fillRect(0, 0, width, height);
    c.save(); c.scale(scale, scale); c.translate(-camera.x, -camera.y); c.fillStyle = this.floor!; c.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    c.strokeStyle = "#38546b"; c.lineWidth = 4; c.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    for (const id of this.labels.keys()) if (!players.some(p => p.id === id)) this.labels.delete(id);
    for (const p of pickups) {
      const draw = this.pickupDraw[p.kind], extent = draw.extent;
      if (p.x < camera.x - extent || p.x > camera.x + worldWidth + extent || p.y < camera.y - extent || p.y > camera.y + worldHeight + extent) continue;
      c.save(); c.globalAlpha = pickupAlpha(p.expiresAt - combatTime); draw.floor(c, p.x, p.y); c.restore();
    }
    for (const b of bugs) {
      const extent = BUG_DRAW[b.kind].extent(b);
      if (b.x < camera.x - extent || b.x > camera.x + worldWidth + extent || b.y < camera.y - extent || b.y > camera.y + worldHeight + extent) continue;
      this.bugDraw[b.kind](c, b, combatTime);
      if (observing) this.trace?.bugs.push({ ...b });
    }
    c.lineCap = "round";
    for (const g of globs) {
      if (g.x < camera.x - GLOB_EXTENT || g.x > camera.x + worldWidth + GLOB_EXTENT || g.y < camera.y - GLOB_EXTENT || g.y > camera.y + worldHeight + GLOB_EXTENT) continue;
      this.globDraw(c, g);
    }
    for (const s of shots) {
      if (s.x < camera.x - 40 || s.x > camera.x + worldWidth + 40 || s.y < camera.y - 40 || s.y > camera.y + worldHeight + 40) continue;
      const length = Math.hypot(s.vx, s.vy), dx = s.vx / length * 22, dy = s.vy / length * 22;
      c.strokeStyle = "#ffc26055"; c.lineWidth = 9; c.beginPath(); c.moveTo(s.x - dx, s.y - dy); c.lineTo(s.x, s.y); c.stroke();
      c.strokeStyle = "#fff6c8"; c.lineWidth = 3; c.stroke();
      if (observing) this.trace?.shots.push({ id: s.id, owner: s.owner });
    }
    // Robots and their names remain readable where the corner map overlaps
    // world feedback at a boundary; the map still overlays the swarm/floor.
    c.restore(); drawMinimap(c, map, WORLD_WIDTH, WORLD_HEIGHT, players, local, bugs, observing ? this.trace?.minimap : undefined);
    c.save(); c.scale(scale, scale); c.translate(-camera.x, -camera.y);
    for (const p of players) if (p.id !== local?.id) this.robot(p, false, camera, worldWidth, worldHeight);
    if (local) this.robot(local, true, camera, worldWidth, worldHeight);
    for (const e of this.bursts) {
      const age = now - e.at, duration = e.type === "kill" || e.type === "glob-pop" ? 700 : 180; if (age < 0 || age > duration) continue;
      if (observing && e.x >= camera.x && e.x <= camera.x + worldWidth && e.y >= camera.y && e.y <= camera.y + worldHeight)
        this.trace?.effects.push({ ...e } as CombatEvent & { at: number });
      c.globalAlpha = 1 - age / duration; c.strokeStyle = e.type === "bounce" ? "#e9f8ff" : e.type === "glob-pop" ? "#aaff38" : "#ffce79"; c.lineWidth = e.type === "bounce" ? 3 : 2;
      c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = 8 + age / 22; c.moveTo(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r); c.lineTo(e.x + Math.cos(a) * (r + 7), e.y + Math.sin(a) * (r + 7)); } c.stroke();
      if (e.type !== "hit" && e.points > 0) { c.fillStyle = e.type === "glob-pop" ? "#d8ff80" : "#fff1bd"; c.font = "bold 18px system-ui"; c.textAlign = "center"; c.fillText(`+${e.points}`, e.x, e.y - 18 - age / 30); } c.globalAlpha = 1;
    }
    this.hiveHud.world(c, now, observing && this.trace ? reward => {
      const x = (reward.x - camera.x) * scale, y = (reward.y - camera.y - 65 - (now - reward.at) / 35) * scale;
      if (x >= 0 && x <= width && y >= 0 && y <= height) this.trace!.hiveRewards!.push({ ...reward });
    } : undefined);
    c.restore();
    const downed = local && (local as CombatPlayer).status === "downed";
    const message = "Downed. A teammate can revive you.";
    let wide = false;
    if (downed) {
      c.save(); c.font = "bold 16px system-ui";
      const messageWidth = c.measureText(message).width; wide = messageWidth <= width - 32;
      const panelWidth = height < 360 ? Math.min(width - 16, (wide ? messageWidth : c.measureText("Downed. A teammate").width) + 32) : width - 16;
      c.restore();
      const panelHeight = wide ? 52 : 74, robotY = (local.y - camera.y) * scale, preferredY = map.y + map.height + 8;
      const panelY = robotY - 54 * scale >= preferredY + panelHeight + 8 ? preferredY : Math.ceil(robotY + 72 * scale);
      Object.assign(this.downedPanel, { x: (width - panelWidth) / 2, y: panelY, width: panelWidth, height: panelHeight });
    }
    const effectsPlayer = local && "effects" in local ? snapshot?.players.find(p => p.id === local.id) ?? local as CombatPlayer : null;
    const pickupHudY = boss || visibleBoss || warning !== null ? 112 : 70;
    let effectCount = 0;
    if (effectsPlayer) for (const kind of PICKUP_KINDS) if (effectRemaining(effectsPlayer.effects[kind] ?? 0, this.time, PICKUPS[kind].duration) > 0) effectCount++;
    this.pickupHud.y = pickupHudY - 22; this.pickupHud.width = (effectCount - 1) * 48 + 44;
    const celebration = this.hiveHud.celebrationBounds(c, width, height, camera, scale, now, boss || warning !== null ? 94 : 46);
    this.edgeMarkers.begin(width, height, boss || visibleBoss || warning !== null ? 94 : 50, map, downed ? this.downedPanel : undefined, celebration, effectCount ? this.pickupHud : undefined);
    for (const p of players) if (p.id !== local?.id && (p as CombatPlayer).status === "downed") {
      this.edgeMarkers.add(p.id, false, (p.x - camera.x) * scale, (p.y - camera.y) * scale);
    }
    if (visibleBoss) this.edgeMarkers.add(`hive:${visibleBoss.id}`, true, (visibleBoss.x - camera.x) * scale, (visibleBoss.y - camera.y) * scale);
    this.edgeMarkers.place(); this.edgeMarkers.draw(c, now);
    if (local && "life" in local) {
      const authoritative = snapshot?.players.find(p => p.id === local.id);
      const p = authoritative ?? local as CombatPlayer;
      const population = snapshot?.players.length ?? players.length;
      const result = authoritative?.result;
      const age = result ? result.seconds : Math.max(0, ((snapshot?.tick ?? tick) - p.startedTick) * STEP_MS / 1000);
      const level = personalLevel(age);
      const key = `${p.score}/${p.streak}/${p.hits}/${level}/${population}/${width}/${height}`;
      if (key !== this.hudKey) {
        this.hudKey = key; this.hudFont = Math.min(width, height) < 600 ? 16 : 20;
        const text = (score: string) => `${score} pts  ×${Math.min(3, 1 + p.streak / 10).toFixed(1)}  ${p.hits} hits  Lv ${level}  ${population} in this arena`;
        this.hudText = text(p.score.toLocaleString()); c.font = `bold ${this.hudFont}px system-ui`;
        if (c.measureText(this.hudText).width > width - 32) this.hudText = text(Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(p.score));
        while (c.measureText(this.hudText).width > width - 32 && this.hudFont > 12) c.font = `bold ${--this.hudFont}px system-ui`;
      }
      c.fillStyle = "#060b12cc"; c.fillRect(8, 8, width - 16, 34);
      c.textAlign = "left"; c.fillStyle = "#eff4db"; c.font = `bold ${this.hudFont}px system-ui`; c.fillText(this.hudText, 16, 32);
      if (observing && this.trace) this.trace.hud = { score: p.score, hits: p.hits, population, level };
    }
    if (effectsPlayer) {
      const p = effectsPlayer;
      let index = 0;
      for (const kind of PICKUP_KINDS) {
        const remaining = effectRemaining(p.effects[kind] ?? 0, this.time, PICKUPS[kind].duration);
        if (remaining > 0) this.pickupDraw[kind].hud(c, 32 + index++ * 48, pickupHudY, remaining);
      }
    }
    this.hiveHud.draw(c, width, height, camera, scale, boss, now, warning, celebration);
    if (observing && this.trace && boss) {
      let arrow = false;
      for (let i = 0; i < this.edgeMarkers.count; i++) if (this.edgeMarkers.markers[i]!.hive) arrow = true;
      this.trace.hive = { id: boss.id, hp: boss.hp, maxHp: boss.maxHp!, arrow };
    }
    for (const s of [input.stick, input.right]) if (s) {
      const length = Math.hypot(s.dx, s.dy), scale = Math.min(1, 60 / (length || 1));
      c.strokeStyle = "#ffffff55"; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, 60, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#ffffff66"; c.beginPath(); c.arc(s.x + s.dx * scale, s.y + s.dy * scale, 22, 0, Math.PI * 2); c.fill();
    }
    if (local && "life" in local) {
      const p = local as CombatPlayer;
      if (p.status === "downed") {
        c.font = "bold 16px system-ui";
        const panelY = this.downedPanel.y;
        c.fillStyle = "#060b12ee"; c.fillRect(this.downedPanel.x, panelY, this.downedPanel.width, this.downedPanel.height);
        c.textAlign = "center"; c.fillStyle = "#ffe09a";
        if (wide) c.fillText(message, width / 2, panelY + 20);
        else { c.fillText("Downed. A teammate", width / 2, panelY + 20); c.fillText("can revive you.", width / 2, panelY + 42); }
        c.fillText(`${Math.ceil(Math.max(0, p.downedUntil - this.time) / 1000)}s`, width / 2, panelY + (wide ? 42 : 64));
      }
    }
  }

  private robot(p: Player, local: boolean, camera: { x: number; y: number }, width: number, height: number) {
    const combat = p as CombatPlayer; if (combat.status === "out") return;
    if (p.x < camera.x - 70 || p.x > camera.x + width + 70 || p.y < camera.y - 70 || p.y > camera.y + height + 70) return;
    const c = this.ctx, colour = TEAM_COLOURS[p.team], r = PLAYER_RADIUS;
    const downed = combat.status === "downed";
    if (observing) this.trace?.players.push({ ...combat, colour, reviveRing: downed && combat.reviveMs > 0 });
    if (downed || combat.immuneUntil > this.time && Math.floor(this.time / 100) % 2) c.globalAlpha = 0.4;
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
    if (downed) { c.rotate(Math.PI / 3); c.scale(1, 0.45); }
    c.fillStyle = colour; c.fillRect(8, -4, 17, 8);
    c.fillStyle = "#142536"; c.strokeStyle = colour; c.lineWidth = 2;
    c.beginPath(); c.roundRect(-r, -r, r * 2, r * 2, 7); c.fill(); c.stroke();
    c.fillStyle = colour; c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff5d8"; c.beginPath(); c.arc(1, -1, 2.5, 0, Math.PI * 2); c.fill(); c.restore();
    if (!downed) for (const kind of PICKUP_KINDS) if ((combat.effects?.[kind] ?? 0) > this.time) this.pickupDraw[kind].robot(c, p);
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
    c.globalAlpha = 1;
    c.drawImage(label, p.x - label.width / 2, p.y - 54);
    if (downed) {
      c.strokeStyle = "#ffe09a"; c.lineWidth = 3; c.beginPath();
      c.arc(p.x, p.y, r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, combat.downedUntil - this.time) / DOWNED_MS); c.stroke();
      c.strokeStyle = combat.reviving ? "#7be7ca" : "#7be7ca88"; c.lineWidth = combat.reviving ? 5 : 3; c.beginPath();
      c.arc(p.x, p.y, r + 19, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * combat.reviveMs / REVIVE_MS); c.stroke();
      c.globalAlpha = 0.75 + Math.sin(this.animationTime / 180) * 0.25;
      c.textAlign = "center"; c.font = "bold 18px system-ui"; c.fillStyle = "#ffe09a"; c.fillText("Help", p.x, p.y + 60); c.globalAlpha = 1;
      return;
    }
    if (combat.heat !== undefined) {
      const lock = combat.overheatUntil > this.time, warning = combat.heat / HEAT_CAPACITY >= HEAT_WARNING;
      c.fillStyle = "#030810"; c.fillRect(p.x - 20, p.y + 25, 40, 6);
      c.fillStyle = lock ? "#ff6767" : warning && Math.floor(this.time / 100) % 2 ? "#ffffff" : "#ffbc62";
      c.fillRect(p.x - 19, p.y + 26, 38 * combat.heat / HEAT_CAPACITY, 4);
      if (lock) { c.font = "bold 10px system-ui"; c.textAlign = "center"; c.fillStyle = "#ff8f86"; c.fillText("HOT", p.x, p.y + 44); }
    }
  }
}
