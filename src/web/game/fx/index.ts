import { Particles } from "./particles";
import { Trails } from "./trails";
import { FloatingText } from "./floating-text";
import { Shake } from "./shake";

export const BOMB_DURATION = 0.65;
export const SHIELD_FLASH_DURATION = 0.22;

export class Effects {
  readonly particles = new Particles();
  readonly trails = new Trails();
  readonly labels = new FloatingText();
  readonly shake = new Shake();
  flash = 0;
  shieldFlash = 0;
  readonly ring = { life: 0, x: 0, y: 0, radius: 0 };
  get liveCount(): number {
    return this.particles.count + this.trails.count + this.labels.count
      + Number(this.ring.life > 0) + Number(this.flash > 0) + Number(this.shake.remaining > 0) + Number(this.shieldFlash > 0);
  }
  time = 0;
  // Keep the clock numeric across resets; NaN marks the first visual frame.
  private previous = NaN;
  squash(x: number, y: number): void { this.particles.burst(x, y); this.labels.pop(x, y); }
  hit(): void { this.flash = 0.1; this.shake.hit(); }
  block(): void { this.shieldFlash = SHIELD_FLASH_DURATION; }
  bomb(x: number, y: number, radius: number): void {
    this.ring.life = BOMB_DURATION; this.ring.x = x; this.ring.y = y; this.ring.radius = radius;
  }
  // Called BEFORE fixed steps: newly emitted effects survive their first draw.
  advance(timestamp: number): void {
    const dt = Number.isNaN(this.previous) ? 0 : Math.max(0, Math.min((timestamp - this.previous) / 1000, 1 / 12));
    this.previous = timestamp; this.time += dt;
    this.particles.update(dt); this.trails.update(dt); this.labels.update(dt);
    this.shake.update(dt); this.flash = Math.max(0, this.flash - dt);
    this.ring.life = Math.max(0, this.ring.life - dt);
    this.shieldFlash = Math.max(0, this.shieldFlash - dt);
  }
  resetClock(): void { this.previous = NaN; }
  reset(): void {
    this.particles.reset(); this.trails.reset(); this.labels.reset(); this.shake.reset();
    this.flash = 0; this.shieldFlash = 0; this.ring.life = 0; this.time = 0; this.resetClock();
  }
}
