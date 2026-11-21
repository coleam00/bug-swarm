import { Browser, until } from "./browser";
import type { PageObservation } from "./types";
import type { Input } from "../../src/shared/arena/types";
import { createPolicy, policyInput, intercept } from "../../src/shared/arena/policies";
import { SHOT_LIFETIME_MS } from "../../src/shared/arena/constants";
import { TEAMS, type Team } from "../../src/shared/teams";
import type { ArenaFrame } from "../../src/web/arena/observation";

export type PlayerPlan = "wait" | "fight" | "combat" | "boss" | "still" | "follow" | "hunt" | { x: number; y: number; radius?: number; fire?: boolean; guard?: boolean };
export interface AppliedInput { at: number; serial: number; life: number; input: Input }
export function guardInput(f: ArenaFrame, target: { x: number; y: number }, state: ReturnType<typeof createPolicy>): Input {
  const waiting = f.players.find(p => p.name === "PilotA")!;
  // Defend against incoming bugs that favour this guard, without clearing the
  // victim's attackers. Fire at normal range, rather than waiting for contact.
  const bugs = f.paint.bugs.filter(b => waiting.status === "downed" ||
    Math.hypot(b.x - f.local.x, b.y - f.local.y) < Math.hypot(b.x - waiting.x, b.y - waiting.y));
  const input = policyInput("aimer", { players: [], bugs, globs: f.snapshot.globs, pickups: f.snapshot.pickups, tick: f.snapshot.tick }, f.local, state);
  const dx = target.x - f.local.x, dy = target.y - f.local.y, distance = Math.hypot(dx, dy);
  const danger = bugs.some(b => Math.hypot(b.x - f.local.x, b.y - f.local.y) < 200);
  // Defend a nearby patch instead of letting the aimer wander out of the
  // casualty's camera. Both helpers must actually see the downed body/meter.
  if (!danger || distance > 80) input.move = distance > 18 ? { x: dx / distance, y: dy / distance } : { x: 0, y: 0 };
  const ax = f.local.x - waiting.x, ay = f.local.y - waiting.y, gap = Math.hypot(ax, ay);
  // Stay outside rescue range until the explicit approach plan, even while
  // dodging. This guard never supplies accidental revive contact.
  if (gap < 150) input.move = { x: ax / (gap || 1), y: ay / (gap || 1) };
  else if (Math.hypot(ax + input.move.x * 20, ay + input.move.y * 20) < 150) input.move = { x: -ay / gap, y: ax / gap };
  return input;
}
/** Decisions read only this page. Actions use CDP input, including entry/respawn. */
export class Player {
  plan: PlayerPlan = "wait";
  observation?: PageObservation;
  readonly policy = createPolicy(86);
  readonly keys = new Set<string>();
  private touches: { id: number; x: number; y: number }[] = [];
  private lastTouchLife = "";
  actions: object[] = [];
  lastInput?: AppliedInput;
  private inputSerial = 0;
  constructor(readonly browser: Browser, readonly page: Awaited<ReturnType<Browser["page"]>>, readonly name: string, readonly team: Team) {}
  async join() {
    await until(() => this.browser.evaluate(this.page.session, "!!document.querySelector('#name')"));
    await this.click("#name");
    await this.browser.call("Input.insertText", { text: this.name }, this.page.session);
    await this.click(`.entry-teams button:nth-child(${TEAMS.indexOf(this.team) + 1})`);
    await until(() => this.read(), v => !!v.frame, 10000, `${this.name} join`);
  }
  async click(selector: string) {
    const box = await this.browser.evaluate<{ x: number; y: number }>(this.page.session, `(()=>{const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();if(!r)throw Error('Missing input target');return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (this.page.touch) { await this.touch([{ id: 9, ...box }]); await this.touch([]); }
    else { await this.browser.call("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...box }, this.page.session); await this.browser.call("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...box }, this.page.session); }
    this.log({ click: selector });
  }
  async read() {
    const value = await this.browser.evaluate<PageObservation>(this.page.session, `(()=>{const f=window.__arenaDebug, c=document.querySelector('canvas'),r=document.querySelector('.arena-life'),number=s=>Number(s?.replaceAll(/[^0-9]/g,''));return {now:performance.now(),frame:f,text:document.body.innerText,fps:Number(c?.dataset.fps),frameMs:Number(c?.dataset.frameMs),result:r?{score:number(r.querySelector('.life-score')?.textContent),best:number(Array.from(r.querySelectorAll('p')).find(p=>p.textContent.startsWith('Best:'))?.textContent),standing:Array.from(r.querySelectorAll('.personal-standing p')).map(p=>p.textContent).join('\\n'),save:r.innerText}:null}})()`);
    this.observation = value; return value;
  }
  private log(action: object) { this.actions.push({ at: performance.now(), ...action }); if (this.actions.length > 3000) this.actions.shift(); }
  async key(code: string, down: boolean) {
    if (this.keys.has(code) === down) return;
    await this.browser.call("Input.dispatchKeyEvent", { type: down ? "keyDown" : "keyUp", code, key: code === "Space" ? " " : code.slice(-1).toLowerCase(), windowsVirtualKeyCode: code === "Space" ? 32 : code.slice(-1).charCodeAt(0) }, this.page.session);
    if (down) this.keys.add(code); else this.keys.delete(code); this.log({ code, down });
  }
  private async touch(points: { id: number; x: number; y: number }[]) {
    const old = this.touches.length;
    await this.browser.call("Input.dispatchTouchEvent", { type: !points.length ? "touchEnd" : points.length > old ? "touchStart" : points.length < old ? "touchEnd" : "touchMove", touchPoints: points.map(p => ({ ...p, radiusX: 8, radiusY: 8, force: 1 })) }, this.page.session);
    this.touches = points; this.log({ touch: points });
  }
  async clear() {
    this.lastInput = undefined;
    for (const key of [...this.keys]) await this.key(key, false);
    if (this.touches.length) await this.touch([]);
  }
  async respawn() { await this.clear(); if (this.page.touch) await this.click(".arena-life button"); else { await this.key("Space", true); await this.key("Space", false); } }
  async drive() {
    const f = this.observation?.frame; if (!f) return;
    const life = `${f.generation}/${f.local.life}/${f.local.status}`;
    if (life !== this.lastTouchLife) { await this.clear(); this.lastTouchLife = life; }
    if (f.local.status !== "active" || this.plan === "wait" || this.plan === "still") { await this.clear(); return; }
    const players = typeof this.plan === "object" && this.plan.fire ? [] : f.players;
    let input = policyInput("aimer", { players, bugs: f.paint.bugs, globs: f.snapshot.globs, pickups: f.snapshot.pickups, tick: f.snapshot.tick }, f.local, this.policy);
    if (this.plan === "boss") {
      const hive = f.snapshot.bugs.find(b => b.kind === "hive");
      // The hive's HUD/edge arrow exposes its direction on this player's own
      // screen. Approach and shoot it while keeping the normal glob dodges.
      const threatened = f.paint.bugs.some(b => b.kind !== "hive" && Math.hypot(b.x - f.local.x, b.y - f.local.y) < 250);
      if (hive) {
        input = policyInput("aimer", { players: [], bugs: threatened ? f.paint.bugs : [hive], globs: f.snapshot.globs, pickups: f.snapshot.pickups, tick: f.snapshot.tick }, f.local, this.policy);
        const imminent = f.paint.bugs.some(b => b.kind !== "hive" && Math.hypot(b.x - f.local.x, b.y - f.local.y) < 90);
        const time = intercept(hive.x - f.local.x, hive.y - f.local.y, hive.vx, hive.vy);
        // Keep dodging the crowd, but focus the boss rather than spending the
        // entire encounter clearing its endlessly replenished brood.
        if (!imminent && time !== null && time <= SHOT_LIFETIME_MS / 1000) {
          input.aim = Math.atan2(hive.y + hive.vy * time - f.local.y, hive.x + hive.vx * time - f.local.x);
          input.fire = !this.policy.pause;
        }
      }
    }
    if (this.plan === "combat") {
      // Exercise real aim/fire throughout the encounter, including scanning an
      // empty viewport after respawn. Cool between ordinary 750 ms bursts.
      input.fire = Math.floor(f.at / 750) % 2 === 0 && f.local.heat < 12;
      if (!f.paint.bugs.length) input.aim = f.at / 1000;
    }
    let target: { x: number; y: number; radius?: number; fire?: boolean; guard?: boolean } | undefined;
    if (typeof this.plan === "object") target = this.plan;
    if (this.plan === "follow") { const p = f.players.find(p => p.id !== f.playerId && p.name.startsWith("PilotA")); if (p) target = { ...p, radius: 50 }; }
    if (this.plan === "hunt") { const b = f.paint.bugs.slice().sort((a,b) => Math.hypot(a.x-f.local.x,a.y-f.local.y)-Math.hypot(b.x-f.local.x,b.y-f.local.y))[0]; if (b) target = { ...b, radius: 0 }; else input.fire = false; }
    if (target) { const dx = target.x - f.local.x, dy = target.y - f.local.y, d = Math.hypot(dx, dy); input = target.guard ? guardInput(f, target, this.policy) : { ...input, move: d > (target.radius ?? 18) ? { x: dx / d, y: dy / d } : { x: 0, y: 0 }, fire: !!target.fire && input.fire }; }
    await this.input(input);
  }
  async input(input: Input) {
    const f = this.observation!.frame!;
    if (this.page.touch) {
      const { width: w, height: h } = this.page, left = { id: 1, x: w * .22, y: h * .73 }, right = { id: 2, x: w * .78, y: h * .73 };
      if (!this.touches.length) await this.touch([left]);
      if (input.fire && !this.touches.some(p => p.id === 2)) await this.touch([this.touches[0]!, right]);
      await this.touch([{ ...left, x: left.x + input.move.x * 55, y: left.y + input.move.y * 55 }, ...(input.fire ? [{ ...right, x: right.x + Math.cos(input.aim) * 55, y: right.y + Math.sin(input.aim) * 55 }] : [])]);
    } else {
      for (const [code, down] of [["KeyW", input.move.y < -.25], ["KeyS", input.move.y > .25], ["KeyA", input.move.x < -.25], ["KeyD", input.move.x > .25]] as const) await this.key(code, down);
      const x = (f.local.x - f.camera.x) * f.scale + Math.cos(input.aim) * 120, y = (f.local.y - f.camera.y) * f.scale + Math.sin(input.aim) * 120;
      await this.browser.call("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 }, this.page.session);
      // Space is the game's desktop fire control. Unlike mouse capture it is
      // independent for each target when several pages aim concurrently.
      await this.key("Space", input.fire);
    }
    this.lastInput = { at: performance.now(), serial: ++this.inputSerial, life: f.local.life, input: structuredClone(input) };
    this.log({ ...this.lastInput });
  }
}
