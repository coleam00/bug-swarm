import { ROBOT_RADIUS } from "./config";
import { SQUARE_ARENA, type Arena } from "./arena";
import { viewport, type Viewport } from "./input";
import { Assets, type CanvasFactory } from "./assets";
import { BUG_STYLES } from "./styles";
import { dronePosition, type Simulation } from "./simulation";
import { BOMB_DURATION, SHIELD_FLASH_DURATION, type Effects } from "./fx";

export class Renderer {
  private assets: Assets | null = null;
  private readonly drone = { x: 0, y: 0 };
  private view: Viewport = viewport(1, 1);
  private width = 0;
  private height = 0;
  private ratio = 0;
  constructor(private readonly ctx: CanvasRenderingContext2D, private readonly factory?: CanvasFactory) {}
  resize(width: number, height: number, ratio: number, arena: Arena = SQUARE_ARENA): void {
    if (this.assets && width === this.width && height === this.height && ratio === this.ratio &&
      arena.width === this.view.arena.width && arena.height === this.view.arena.height) return;
    this.width = width; this.height = height; this.ratio = ratio;
    this.view = viewport(width, height, arena);
    this.assets?.dispose();
    this.assets = new Assets(Math.max(0.1, this.view.scale * ratio), Math.max(0.01, this.view.scale), arena, this.factory);
  }
  draw(state: Simulation, fx: Effects): void {
    // A restart may change world shape without changing the canvas's CSS size.
    if (this.view.arena.width !== state.arena.width || this.view.arena.height !== state.arena.height) {
      this.resize(this.width, this.height, this.ratio, state.arena);
    }
    const ctx = this.ctx, art = this.assets;
    if (!art) return;
    const view = this.view;
    const { width, height } = state.arena;
    ctx.fillStyle = "#080f19"; ctx.fillRect(0, 0, this.width, this.height);
    ctx.save(); ctx.translate(view.left, view.top); ctx.scale(view.scale, view.scale);
    ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    // Clip stays fixed while the world shakes. Overscan hides translated strips.
    ctx.fillStyle = "#101d2a"; ctx.fillRect(-8, -8, width + 16, height + 16);
    ctx.translate(fx.shake.x, fx.shake.y);
    ctx.drawImage(art.floor, 0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";
    const trails = fx.trails;
    for (let i = 0; i < trails.capacity; i++) {
      if (trails.life[i]! <= 0) continue;
      const fade = trails.life[i]! / trails.duration[i]!;
      ctx.globalAlpha = fade * 0.35;
      ctx.drawImage(art.core, trails.x[i]! - 18, trails.y[i]! - 18, 36, 36);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    for (const bug of state.bugs) {
      const style = BUG_STYLES[bug.kind], size = style.length / 12;
      const gait = Math.sin(fx.time * style.gait + bug.id * 2.4);
      ctx.save(); ctx.translate(bug.x, bug.y);
      ctx.rotate(Math.atan2(state.robot.y - bug.y, state.robot.x - bug.x));
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        for (let leg = -1; leg <= 1; leg++) {
          const stride = gait * (leg === 0 ? -3 : 3) * side * size;
          ctx.moveTo(leg * 6 * size, side * 5 * size);
          ctx.lineTo(leg * 8 * size + stride, side * 12 * size);
          ctx.lineTo((leg * 10 - 3) * size + stride, side * style.leg);
        }
      }
      ctx.strokeStyle = style.legs; ctx.lineWidth = 2 * size; ctx.stroke();
      ctx.fillStyle = "#502f43"; ctx.beginPath(); ctx.ellipse(9 * size, 0, 5 * size, 6 * size, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = style.body; ctx.beginPath(); ctx.ellipse(-1, 0, style.length, style.width, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-11 * size, 0); ctx.lineTo(7 * size, 0); ctx.strokeStyle = "#663b50"; ctx.lineWidth = 1.5 * size; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-2 * size, -3 * size, 6 * size, 2 * size, -0.15, 0, Math.PI * 2); ctx.fillStyle = style.highlight; ctx.fill();
      ctx.fillStyle = "#ffe6c5"; ctx.fillRect(10 * size, -4 * size, 2 * size, 2 * size); ctx.fillRect(10 * size, 2 * size, 2 * size, 2 * size);
      ctx.restore();
    }
    // Cached glows and bright centres; no per-object shadowBlur.
    ctx.globalCompositeOperation = "lighter";
    for (const shot of state.shots) {
      const length = Math.hypot(shot.vx, shot.vy) || 1, dx = shot.vx / length, dy = shot.vy / length;
      ctx.save(); ctx.translate(shot.x, shot.y); ctx.rotate(Math.atan2(dy, dx));
      const drone = shot.source === "drone";
      ctx.drawImage(drone ? art.drone : art.shot, shot.laser ? -65 : -27, -9, shot.laser ? 88 : 44, 18);
      ctx.beginPath(); ctx.moveTo(shot.laser ? -54 : -15, 0); ctx.lineTo(3, 0);
      ctx.lineWidth = shot.laser ? 8 : 5; ctx.strokeStyle = drone ? "#8e9fff" : "#ffbe54"; ctx.stroke();
      ctx.lineWidth = shot.laser ? 3 : 2; ctx.strokeStyle = drone ? "#e6edff" : "#fff2b8"; ctx.stroke(); ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
    const particles = fx.particles;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < particles.capacity; i++) {
      if (particles.life[i]! <= 0) continue;
      ctx.globalAlpha = particles.life[i]! / particles.duration[i]!;
      const x = particles.x[i]!, y = particles.y[i]!;
      ctx.drawImage(art.spark, x - 9, y - 9, 18, 18);
      ctx.fillStyle = "#ffe1a4"; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(art.vignette, 0, 0, width, height);
    if (fx.ring.life > 0) {
      ctx.globalAlpha = Math.min(1, fx.ring.life / 0.18);
      ctx.beginPath(); ctx.arc(fx.ring.x, fx.ring.y, (1 - fx.ring.life / BOMB_DURATION) * fx.ring.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "#a17bff"; ctx.lineWidth = 12; ctx.stroke();
      ctx.strokeStyle = "#f8eaff"; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1;
    }
    for (let i = 0; i < state.drones.length; i++) {
      dronePosition(state, i, this.drone);
      ctx.drawImage(art.drone, this.drone.x - 22, this.drone.y - 22, 44, 44);
      ctx.fillStyle = "#131e40"; ctx.strokeStyle = "#bdcaff"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(this.drone.x, this.drone.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#e6edff"; ctx.fillRect(this.drone.x - 4, this.drone.y - 2, 8, 4);
    }
    const labels = fx.labels, cell = art.glyphWidth, h = art.labelHeight;
    for (let i = 0; i < labels.capacity; i++) {
      if (labels.life[i]! <= 0) continue;
      const total = labels.total[i]!;
      let divisor = 1, digits = 1;
      while (divisor * 10 <= total) { divisor *= 10; digits++; }
      const w = cell * (digits + 1);
      ctx.globalAlpha = Math.min(1, labels.life[i]! / 0.2);
      const x = Math.max(w / 2 + 5, Math.min(width - w / 2 - 5, labels.x[i]!));
      const y = Math.max(h / 2 + 5, Math.min(height - h / 2 - 5, labels.y[i]! - 18));
      const sourceWidth = art.label.width / 11;
      let left = x - w / 2;
      ctx.drawImage(art.label, 0, 0, sourceWidth, art.label.height, left, y - h / 2, cell, h);
      for (; divisor >= 1; divisor /= 10) {
        left += cell;
        const glyph = Math.floor(total / divisor) % 10 + 1;
        ctx.drawImage(art.label, glyph * sourceWidth, 0, sourceWidth, art.label.height, left, y - h / 2, cell, h);
      }
    }
    // Protected foreground pass: no bug, projectile, particle or text covers "me".
    ctx.globalAlpha = 1;
    const robot = state.robot;
    ctx.save(); ctx.translate(robot.x, robot.y);
    ctx.drawImage(art.halo, -44, -44, 88, 88);
    if (state.shieldCharges > 0) {
      ctx.fillStyle = "#58bfff28"; ctx.strokeStyle = "#72cfff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (state.shieldCharges > 1) {
        ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.stroke();
      }
    }
    if (fx.shieldFlash > 0) {
      ctx.globalAlpha = Math.min(1, fx.shieldFlash / 0.08);
      ctx.beginPath(); ctx.arc(0, 0, 30 + (1 - fx.shieldFlash / SHIELD_FLASH_DURATION) * 16, 0, Math.PI * 2);
      ctx.strokeStyle = "#459dff"; ctx.lineWidth = 9; ctx.stroke();
      ctx.strokeStyle = "#e1f7ff"; ctx.lineWidth = 4; ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "#314757"; ctx.strokeStyle = "#84b6bd"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-ROBOT_RADIUS, -ROBOT_RADIUS, ROBOT_RADIUS * 2, ROBOT_RADIUS * 2, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#152532"; ctx.fillRect(-18, -8, 5, 16); ctx.fillRect(13, -8, 5, 16);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(art.core, -30, -30, 60, 60);
    ctx.fillStyle = "#b5fff0"; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    if (fx.flash > 0) {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.roundRect(-14, -14, 28, 28, 7); ctx.fill();
    } else if (state.time < state.invulnerableUntil) {
      ctx.globalAlpha = 0.3 + 0.25 * Math.sin(fx.time * 24);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(-16, -16, 32, 32, 9); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // Dark backing separates the identity ring even from bright swarms/effects.
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.strokeStyle = "#081923"; ctx.lineWidth = 7; ctx.stroke();
    ctx.strokeStyle = "#caffef"; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  dispose(): void { this.assets?.dispose(); this.assets = null; }
}
