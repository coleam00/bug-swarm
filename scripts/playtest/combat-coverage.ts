import type { AppliedInput } from "./player";
import { requireAgreement } from "./agreement";

export interface CombatSample {
  name: string; life: number; status: "active" | "downed" | "out";
  fire: boolean; shot: boolean; command?: AppliedInput;
}
/** Credit only jointly active play, with repeated aim, held fire and emitted
 * shots in EVERY five seconds. Downtime and validation/respawn waits earn zero. */
export class CombatCoverage {
  readonly windows: { activeMs: number; actors: { name: string; aims: number; fireSamples: number; shotSamples: number }[] }[] = [];
  private previous?: { at: number; eligible: boolean };
  private serials = new Map<string, number>();
  private windowMs = 0;
  private evidence = new Map<string, { name: string; aims: number; fireSamples: number; shotSamples: number }>();
  constructor(readonly names: string[], readonly requiredMs = 60000) {}
  get creditedMs() { return this.windows.length * 5000; }
  get complete() { return this.creditedMs >= this.requiredMs; }
  observe(at: number, samples: CombatSample[]) {
    requireAgreement(samples.length === this.names.length && this.names.every(name => samples.some(s => s.name === name)), "Missing combat participant");
    const eligible = samples.every(s => s.status === "active" && s.command && s.command.life === s.life && at - s.command.at >= 0 && at - s.command.at <= 500);
    // Screenshot/result/respawn work can pause the controller while a key stays
    // held. Exclude that gap rather than inventing activity or failing a valid
    // UI transition. All evidence below comes from jointly eligible samples.
    if (eligible) for (const s of samples) {
      const e = this.evidence.get(s.name) ?? { name: s.name, aims: 0, fireSamples: 0, shotSamples: 0 };
      if (this.serials.get(s.name) !== s.command!.serial) e.aims++;
      this.serials.set(s.name, s.command!.serial);
      if (s.fire && s.command!.input.fire) e.fireSamples++;
      if (s.shot) e.shotSamples++;
      this.evidence.set(s.name, e);
    }
    if (eligible && this.previous?.eligible) {
      const delta = at - this.previous.at;
      if (delta > 0 && delta <= 500) this.windowMs += delta;
    }
    this.previous = { at, eligible };
    if (this.windowMs >= 5000) {
      const actors = this.names.map(name => this.evidence.get(name)!);
      for (const e of actors) requireAgreement(e.aims >= 5 && e.fireSamples > 0 && e.shotSamples > 0, `${e.name}: five seconds of combat lacks repeated aim, held fire or emitted shots`);
      this.windows.push({ activeMs: this.windowMs, actors }); this.windowMs = 0; this.evidence.clear();
    }
  }
  requireComplete() { requireAgreement(this.complete, `Only ${this.creditedMs} ms of sustained joint combat; 60000 ms required`); }
}
