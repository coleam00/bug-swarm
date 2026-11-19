import { Particles } from "./particles";
import { Trails } from "./trails";
import { FloatingText } from "./floating-text";
import { Shake } from "./shake";

export class Effects {
  readonly particles = new Particles();
  readonly trails = new Trails();
  readonly labels = new FloatingText();
  readonly shake = new Shake();
  flash = 0;
  readonly ring = { life: 0, x: 0, y: 0, radius: 0 };
  time = 0;
  // Keep the clock numeric across resets; NaN marks the first visual frame.
  private previous = NaN;
  squash(x: number, y: number): void { this.particles.burst(x, y); this.labels.pop(x, y); }
  hit(): void { this.flash = 0.1; this.shake.hit(); }
  bomb(x: number, y: number, radius: number): void {
    this.ring.life = 0.5; this.ring.x = x; this.ring.y = y; this.ring.radius = radius;
  }
  // Called BEFORE fixed steps: newly emitted effects survive their first draw.
  advance(timestamp: number): void {
    const dt = Number.isNaN(this.previous) ? 0 : Math.max(0, Math.min((timestamp - this.previous) / 1000, 1 / 12));
    this.previous = timestamp; this.time += dt;
    this.particles.update(dt); this.trails.update(dt); this.labels.update(dt);
    this.shake.update(dt); this.flash = Math.max(0, this.flash - dt);
    this.ring.life = Math.max(0, this.ring.life - dt);
  }
  resetClock(): void { this.previous = NaN; }
  reset(): void {
    this.particles.reset(); this.trails.reset(); this.labels.reset(); this.shake.reset();
    this.flash = 0; this.ring.life = 0; this.time = 0; this.resetClock();
  }
}
