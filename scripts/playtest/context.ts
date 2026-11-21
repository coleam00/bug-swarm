import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Browser, until } from "./browser";
import { Player } from "./player";
import { OwnedServer } from "./server";
import { comparePage, compareBoard, compareResult, requireAgreement, same } from "./agreement";
import { runBots } from "../bots";
import type { ArenaFrame } from "../../src/web/arena/observation";
import type { ServerObservation, ScenarioReport } from "./types";
import type { Leader, Standing, Best } from "../../src/shared/api";
import { requireMeasurements } from "./report";
import { TEAMS } from "../../src/shared/teams";

export class Context {
  readonly players: Player[] = [];
  readonly server: OwnedServer;
  readonly report: ScenarioReport;
  latest?: ServerObservation;
  readonly validatedRuns = new Set<string>();
  private previous = new Map<Player, ArenaFrame>();
  private botAbort?: AbortController;
  private botTask?: Promise<unknown>;
  private botError?: unknown;
  private samples: object[] = [];
  private start = performance.now();
  private lastSample = -Infinity;
  private deadline: number;
  constructor(readonly name: string, readonly root: string, assets: string, readonly browser: Browser, readonly bots: number, suiteDeadline: number, private signal?: AbortSignal) {
    mkdirSync(root, { recursive: true });
    this.server = new OwnedServer(root, assets, 86);
    this.report = { name, status: "running", seed: 86, elapsedMs: 0, checks: [], screenshots: [], pages: {}, cleanupErrors: [] };
    this.deadline = Math.min(suiteDeadline, this.start + (name === "combat" ? 180000 : 85000));
  }
  check(name: string, condition: unknown, detail?: unknown) {
    this.report.checks.push({ name, pass: !!condition, ...(detail !== undefined ? { detail } : {}) });
    requireAgreement(condition, name + (detail !== undefined ? ": " + JSON.stringify(detail) : ""));
  }
  async startServer(warmup = 0) { await this.server.start(warmup, this.bots); }
  async join(count = 3, phones = false) {
    for (let i = 0; i < count; i++) {
      const touch = phones && i >= 2, portrait = i === 3;
      const page = await this.browser.page(this.server.origin, touch ? portrait ? 390 : 844 : 1280, touch ? portrait ? 844 : 390 : 720, touch);
      const p = new Player(this.browser, page, `Pilot${String.fromCharCode(65 + i)}`, TEAMS[i % TEAMS.length]!);
      this.players.push(p); this.report.pages[p.name] = { samples: 0, fps: [], frameMs: [] };
    }
    // Browser/page startup must not leave the first human taking damage while
    // the rest of the cohort still boots. No arena socket opens at this stage.
    for (const p of this.players) await until(() => this.browser.evaluate(p.page.session, "!!document.querySelector('#name')"));
    for (const p of this.players) {
      await p.join();
      await p.key("KeyF", true); await p.key("KeyF", false);
      const start = performance.now();
      const admitted = this.players.slice(0, this.players.indexOf(p) + 1);
      await this.wait("admission observed on every page", () => admitted.every(v => admitted.every(q => (this.name === "together" ? v.observation?.frame?.paint.players : v.observation?.frame?.snapshot.players)?.some(p => p.name === q.name))), 1000, false);
      this.check(`${p.name} admitted on every page within one second`, performance.now() - start <= 1000);
    }
    await this.run(600);
    const ids = this.players.map(p => p.observation!.frame!.playerId);
    this.check("Separate accepted identities", new Set(ids).size === count);
  }
  startBots() {
    if (!this.bots) return;
    this.botAbort = new AbortController();
    this.botTask = runBots({ url: this.server.origin, count: this.bots, seconds: 200, policy: "aimer" }, this.botAbort.signal).catch(error => { if (!this.botAbort?.signal.aborted) this.botError = error; });
  }
  async stopBots() { this.botAbort?.abort(); await this.botTask; this.botTask = undefined; this.botAbort = undefined; }
  async sample(agreement = true) {
    this.signal?.throwIfAborted();
    await Bun.sleep(Math.max(0, 100 - (performance.now() - this.lastSample)));
    this.lastSample = performance.now();
    if (performance.now() >= this.deadline) throw Error("Scenario/suite deadline exceeded");
    if (this.botError) throw this.botError;
    const pages = await Promise.all(this.players.map(p => p.read()));
    const server = this.latest = await this.server.observe();
    this.report.tick = server.stats.tick; this.report.warmup = server.warmup;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]!, player = this.players[i]!, stats = this.report.pages[player.name]!;
      if (agreement) {
        const f = comparePage(page, server, this.previous.get(player)); this.previous.set(player, f);
        stats.samples++;
        if (Number.isFinite(page.fps) && page.fps > 0 && Number.isFinite(page.frameMs) && page.frameMs >= 0) { stats.fps.push(page.fps); stats.frameMs.push(page.frameMs); }
      }
    }
    this.samples.push({ at: performance.now() - this.start, generation: server.generation, pages: pages.map(p => ({ now: p.now, frame: p.frame })), server: { snapshots: server.snapshots.slice(-5), lives: server.lives.slice(-12) } });
    if (this.samples.length > 120) this.samples.shift();
    return pages;
  }
  async run(ms: number, after?: () => void | Promise<void>, agreement = true) {
    const end = performance.now() + ms;
    do {
      const start = performance.now(); await this.sample(agreement); await after?.();
      await Promise.all(this.players.map(p => p.drive()));
      await Bun.sleep(Math.max(1, Math.min(end - performance.now(), 100 - (performance.now() - start))));
    } while (performance.now() < end);
  }
  async wait(label: string, condition: () => boolean, timeout = 10000, agreement = true) {
    const end = Math.min(this.deadline, performance.now() + timeout);
    do { await this.run(1, undefined, agreement); if (condition()) return; await Bun.sleep(75); } while (performance.now() < end);
    throw Error("Timed out: " + label);
  }
  async capture(label: string) {
    await Promise.all(this.players.map(async p => {
      const file = `${label}-${p.name}.png`, f = p.observation?.frame;
      await this.browser.screenshot(p.page.session, join(this.root, file));
      this.report.screenshots.push({ player: p.name, file, frame: f?.frame, tick: f?.snapshot.tick });
    }));
  }
  async release() { for (const p of this.players) { p.plan = "wait"; await p.clear(); } }
  async stoppedCheckpoint() {
    await this.release(); await this.run(600);
    for (const p of this.players) comparePage(p.observation!, this.latest!, undefined, true);
    this.check("Stopped players converge within two world units", true);
  }
  async results(p: Player) {
    await this.wait(`${p.name} saved life-over`, () => !!p.observation?.result?.save.includes("Score saved"), 20000);
    const f = p.observation!.frame!, life = this.latest!.lives.slice().reverse().find(v => v.player.id === f.playerId && v.player.life === f.local.life && !!v.record.result);
    this.check("Terminal life maps to server run", life);
    const db = new Database(join(this.root, "data", "app.db"), { readonly: true });
    try {
      const row = db.query("SELECT score, squashes, touch, (SELECT COUNT(*) FROM events WHERE run_id=runs.id AND type='run_ended') AS finishes FROM runs WHERE id=?").get(life!.record.runId) as { score: number; squashes: number; touch: number; finishes: number };
      same(row.score, life!.record.result!.score, "Independent SQLite score"); same(row.finishes, 1, "Exactly one finish");
      same(row.squashes, life!.record.result!.kills, "Independent SQLite kills"); same(row.touch, Number(life!.record.result!.touch), "Independent SQLite touch attribution");
    } finally { db.close(); }
    await this.wait("best/standing converge", () => !p.observation!.result!.save.includes("Loading"), 5000);
    const end = performance.now() + 5000; let mismatch: unknown;
    do {
      const [best, standing] = await Promise.all([this.api<Best>(`/api/players/${f.playerId}/best`), this.api<Standing>(`/api/players/${f.playerId}/standing`)]);
      const text = standing.rank === null ? "" : [`Your best is #${standing.rank.toLocaleString("en-US")} of ${standing.total.toLocaleString("en-US")}`, ...(standing.rank <= 10 ? ["You're in the top 10!"] : []), ...(standing.next ? [`${standing.next.pointsToBeat.toLocaleString("en-US")} ${standing.next.pointsToBeat === 1 ? "point" : "points"} to beat #${standing.next.rank}`] : [])].join("\n");
      try {
        compareResult(p.observation!.result!, { score: life!.record.result!.score, best: best.best!, standing: text });
        if (standing.rank === null) requireAgreement(p.observation!.result!.save.includes("Not ranked"), "Missing unranked standing");
        mismatch = undefined; break;
      } catch (error) { mismatch = error; await this.run(200); }
    } while (performance.now() < end);
    if (mismatch) throw mismatch;
    this.check(`${p.name} score/best/standing agree with saved server run`, true, { run: life!.record.runId });
    this.validatedRuns.add(life!.record.runId);
  }
  async api<T>(path: string): Promise<T> { const r = await fetch(this.server.origin + path, { signal: AbortSignal.timeout(5000) }); if (!r.ok) throw Error(`HTTP ${r.status}: ${path}`); return r.json() as Promise<T>; }
  async board() {
    const boards = await Promise.all([0, 1].map(() => this.browser.page(this.server.origin + "/board")));
    try {
      let expected: Leader[] = [], actual: { rank: number; name: string; score: number }[][] = [];
      const end = performance.now() + 5000;
      let matched = false;
      do {
        expected = await this.api<Leader[]>("/api/leaderboard");
        actual = await Promise.all(boards.map(p => this.browser.evaluate<{ rank: number; name: string; score: number }[]>(p.session, `Array.from(document.querySelectorAll('.board-leaders li')).map(r=>({rank:Number(r.querySelector('.board-rank').textContent),name:r.querySelector('.board-name span:last-child').textContent,score:Number(r.querySelector('.board-score').title.replaceAll(',',''))}))`)));
        const ready = await Promise.all(boards.map(p => this.browser.evaluate<boolean>(p.session, "!!document.querySelector('.board-leaders li') || document.querySelector('.board-empty')?.textContent.includes('First score takes the lead.')")));
        try { requireAgreement(ready.every(Boolean), "Board still loading"); for (const rows of actual) compareBoard(rows, expected); matched = true; break; } catch { await Bun.sleep(100); }
      } while (performance.now() < end);
      this.check("Both /board pages agree with ordered server top 10", matched, { expected, actual });
      for (let i = 0; i < boards.length; i++) { const file = `board-${i}.png`; await this.browser.screenshot(boards[i]!.session, join(this.root, file)); this.report.screenshots.push({ player: `board-${i}`, file }); }
    } finally { for (const p of boards) await this.browser.call("Target.disposeBrowserContext", { browserContextId: p.context }); }
  }
  async finish(error?: unknown) {
    if (error) { this.report.status = "fail"; this.report.error = String(error instanceof Error ? error.stack : error); this.report.checks.push({ name: "scenario completed", pass: false, detail: String(error) }); await this.capture("failure").catch(e => this.report.cleanupErrors.push(String(e))); }
    for (const p of this.players) await p.clear().catch(e => this.report.cleanupErrors.push(String(e)));
    await this.stopBots().catch(e => this.report.cleanupErrors.push(String(e)));
    for (const p of this.players) await this.browser.call("Target.disposeBrowserContext", { browserContextId: p.page.context }).catch(e => this.report.cleanupErrors.push(String(e)));
    await this.server.stop().catch(e => this.report.cleanupErrors.push(String(e)));
    const browserErrors = this.browser.errors.filter(e => this.players.some(p => p.page.session === e.session));
    if (browserErrors.length) this.report.checks.push({ name: "No browser errors", pass: false, detail: browserErrors });
    if (this.report.cleanupErrors.length || browserErrors.length) this.report.status = "fail";
    if (this.report.status === "running") {
      try { requireMeasurements(this.report); this.report.checks.push({ name: "Continuously advancing rendered state and complete performance evidence", pass: true }); this.report.status = "pass"; }
      catch (error) { this.report.status = "fail"; this.report.error = String(error); this.report.checks.push({ name: "Complete performance evidence", pass: false, detail: String(error) }); }
    }
    this.report.elapsedMs = performance.now() - this.start;
    writeFileSync(join(this.root, "samples.json"), JSON.stringify(this.samples));
    writeFileSync(join(this.root, "inputs.json"), JSON.stringify(this.players.map(p => ({ name: p.name, viewport: p.page, actions: p.actions }))));
    writeFileSync(join(this.root, "report.json"), JSON.stringify(this.report, null, 2));
    return this.report;
  }
}
