import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
// Run the production server, workload and browser in independent processes.
const base = resolve(".evidence/77"); mkdirSync(base, { recursive: true });
const serverMode = process.argv[2] === "--server";
const concurrent = process.argv.includes("--browser");
const evidence = serverMode ? process.argv[3]! : mkdtempSync(join(base, process.argv.includes("--baseline") ? "baseline-" : concurrent ? "concurrent-" : "load-"));
for (const path of ["home", "tmp", "data"]) mkdirSync(join(evidence, path), { recursive: true });
const home = join(evidence, "home");
for (const key of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_CACHE_HOME"]) process.env[key] = home;
process.env.TMP = process.env.TEMP = join(evidence, "tmp");
process.env.APPDATA = join(home, "AppData/Roaming"); process.env.LOCALAPPDATA = join(home, "AppData/Local");
mkdirSync(process.env.APPDATA, { recursive: true }); mkdirSync(process.env.LOCALAPPDATA, { recursive: true });
if (serverMode) {
  const { createServer } = await import("../src/server/server");
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir: join(evidence, "data"), env: {} });
  await Bun.write(join(evidence, "ready.json"), JSON.stringify({ origin: app.server.url.origin, pid: process.pid }));
  await Bun.stdin.text(); if (!await app.stop()) process.exitCode = 1;
} else {
  console.log("Evidence:", evidence);
  const server = Bun.spawn([process.execPath, import.meta.path, "--server", evidence], { env: process.env, stdin: "pipe", stdout: Bun.file(join(evidence, "server.log")), stderr: Bun.file(join(evidence, "server-errors.log")) });
  let placeholder: WebSocket | undefined, bots: ReturnType<typeof Bun.spawn> | undefined, browser: ReturnType<typeof Bun.spawn> | undefined;
  try {
    let ready: { origin: string } | undefined;
    for (let i = 0; i < 200; i++) {
      if (await Bun.file(join(evidence, "ready.json")).exists()) { ready = await Bun.file(join(evidence, "ready.json")).json(); break; }
      if (server.exitCode !== null) throw Error("Owned server failed to start");
      await Bun.sleep(50);
    }
    if (!ready) throw Error("Owned server startup timeout");
    const origin = ready.origin;
    const stats = async () => await (await fetch(origin + "/api/arena/stats")).json();
    if (concurrent) {
      placeholder = new WebSocket(origin.replace("http", "ws") + "/ws");
      await new Promise<void>((resolve, reject) => {
        placeholder!.onopen = () => placeholder!.send(JSON.stringify({ v: 1, type: "hello", playerId: crypto.randomUUID(), name: "LoadAnchor", team: "tabs", touch: false, buildId: "load-placeholder" }));
        placeholder!.onmessage = e => { if (JSON.parse(String(e.data)).type === "welcome") resolve(); };
        placeholder!.onerror = () => reject(Error("Placeholder transport failed"));
      });
    }
    const command = ["run", "bots", "--", "--url", ready.origin, "--count", "200", "--seconds", "120", "--policy", "aimer"];
    console.log("bun", ...command);
    bots = Bun.spawn([process.execPath, ...command], { env: { ...process.env, BOT_SNAPSHOT_ENCODING: process.argv.includes("--baseline") ? "json" : "delta-v1" }, stdout: Bun.file(join(evidence, "bots.json")), stderr: Bun.file(join(evidence, "bots-errors.log")) });
    if (concurrent) {
      let populated: any;
      for (let i = 0; i < 200; i++) { populated = await stats(); if (populated.totalPlayers === 201) break; if (bots.exitCode !== null) throw Error("Bots failed during admission"); await Bun.sleep(50); }
      if (populated.totalPlayers !== 201 || populated.arenas.length !== 11) throw Error("Expected placeholder and 200 bots across eleven arenas");
      await new Promise<void>(resolve => { placeholder!.onclose = () => resolve(); placeholder!.close(); }); placeholder = undefined;
      await Bun.write(join(evidence, "admission.json"), JSON.stringify({ beforePlaceholderLeave: populated, afterPlaceholderLeave: await stats() }, null, 2));
      browser = Bun.spawn([process.execPath, join(import.meta.dir, "load-browser.ts"), origin, evidence], { env: process.env, stdin: "pipe", stdout: Bun.file(join(evidence, "browser.log")), stderr: Bun.file(join(evidence, "browser-errors.log")) });
    }
    const exit = await bots.exited;
    if (browser?.stdin && typeof browser.stdin !== "number") browser.stdin.end();
    const browserExit = browser ? await browser.exited : undefined;
    const assets = Object.fromEntries(await Promise.all(readdirSync("dist/assets").filter(name => name.endsWith(".js")).map(async name => [name, new Bun.CryptoHasher("sha256").update(await Bun.file(join("dist/assets", name)).arrayBuffer()).digest("hex")])));
    await Bun.write(join(evidence, "run.json"), JSON.stringify({ command, exit, browserExit, bun: Bun.version, build: await Bun.file("dist/build.json").json(), assets,
      machine: await import("node:os").then(os => ({ platform: os.platform(), release: os.release(), cpu: os.cpus()[0]!.model.trim(), logicalCpus: os.cpus().length, memory: os.totalmem() })) }, null, 2));
    console.log("Bots exit:", exit, "browser exit:", browserExit);
    process.exitCode = exit || browserExit || 0;
  } finally {
    placeholder?.close();
    if (bots && bots.exitCode === null) { bots.kill(); await bots.exited; }
    if (browser && browser.exitCode === null) { if (browser.stdin && typeof browser.stdin !== "number") browser.stdin.end(); await browser.exited; }
    server.stdin.end();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stopped = await Promise.race([server.exited, new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 6000); })]); clearTimeout(timeout);
    if (stopped === null) { server.kill(); await server.exited; }
    await Bun.write(join(evidence, "cleanup.json"), JSON.stringify({ serverExit: server.exitCode, botsExit: bots?.exitCode, browserExit: browser?.exitCode, serverErrors: await Bun.file(join(evidence, "server-errors.log")).text() }, null, 2));
    if (server.exitCode !== 0 || (await Bun.file(join(evidence, "server-errors.log")).text()).trim()) process.exitCode = 1;
  }
}
