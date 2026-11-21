import { PLAYER_RADIUS, WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/arena/constants";
import { TEAM_COLOURS, TEAMS } from "../../shared/teams";
import type { Player } from "../../shared/arena/types";
import type { ArenaInput } from "./input";
export class ArenaRenderer {
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
  draw(width: number, height: number, camera: { x: number; y: number }, players: Player[], local: Player | null, input: ArenaInput) {
    const c = this.ctx;
    c.fillStyle = "#060b12"; c.fillRect(0, 0, width, height);
    c.save(); c.translate(-camera.x, -camera.y); c.fillStyle = this.floor!; c.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    c.strokeStyle = "#38546b"; c.lineWidth = 4; c.strokeRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    const active = new Set(players.map(p => p.id));
    for (const id of this.labels.keys()) if (!active.has(id)) this.labels.delete(id);
    for (const p of players) if (p.id !== local?.id) this.robot(p, false, camera, width, height);
    if (local) this.robot(local, true, camera, width, height);
    c.restore();
    const s = input.stick;
    if (s) {
      const length = Math.hypot(s.dx, s.dy), scale = Math.min(1, 60 / (length || 1));
      c.strokeStyle = "#ffffff55"; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, 60, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#ffffff66"; c.beginPath(); c.arc(s.x + s.dx * scale, s.y + s.dy * scale, 22, 0, Math.PI * 2); c.fill();
    }
  }
  private robot(p: Player, local: boolean, camera: { x: number; y: number }, width: number, height: number) {
    if (p.x < camera.x - 70 || p.x > camera.x + width + 70 || p.y < camera.y - 70 || p.y > camera.y + height + 70) return;
    const c = this.ctx, colour = TEAM_COLOURS[p.team], r = PLAYER_RADIUS;
    c.drawImage(this.glows.get(p.team)!, p.x - 50, p.y - 50);
    if (local) { c.strokeStyle = "#fff0bd"; c.lineWidth = 2.5; c.beginPath(); c.arc(p.x, p.y, r + 8, 0, Math.PI * 2); c.stroke(); }
    c.save(); c.translate(p.x, p.y); c.rotate(p.facing);
    c.fillStyle = colour; c.fillRect(8, -4, 17, 8);
    c.fillStyle = "#142536"; c.strokeStyle = colour; c.lineWidth = 2;
    c.beginPath(); c.roundRect(-r, -r, r * 2, r * 2, 7); c.fill(); c.stroke();
    c.fillStyle = colour; c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff5d8"; c.beginPath(); c.arc(1, -1, 2.5, 0, Math.PI * 2); c.fill(); c.restore();
    let label = this.labels.get(p.id);
    if (!label) {
      label = document.createElement("canvas"); label.width = 180; label.height = 30;
      const l = label.getContext("2d")!; l.font = "bold 14px system-ui"; l.textAlign = "center";
      l.strokeStyle = "#060b12"; l.lineWidth = 4; l.strokeText(p.name, 90, 20); l.fillStyle = colour; l.fillText(p.name, 90, 20);
      this.labels.set(p.id, label);
    }
    c.drawImage(label, p.x - 90, p.y - 54);
  }
}
