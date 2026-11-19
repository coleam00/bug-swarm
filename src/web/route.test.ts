import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

test("board routes load only the board; other paths retain the game", () => {
  const scratch = mkdtempSync(join(tmpdir(), "board-route-")), home = join(scratch, "home");
  mkdirSync(home);
  const moduleUrl = (path: string) => JSON.stringify(pathToFileURL(join(import.meta.dir, path)).href);
  const probe = `
import { mock } from "bun:test";
import assert from "node:assert/strict";
let gameImports = 0;
const Game = () => null;
mock.module(${moduleUrl("App.tsx")}, () => { gameImports++; return { App: Game }; });
Object.defineProperty(globalThis, "localStorage", { get() { throw new Error("Player storage on board"); } });
const { loadView } = await import(${moduleUrl("route.ts")});
const { Board } = await import(${moduleUrl("board/Board.tsx")});
for (const path of ["/board", "/board/", new URL("https://swarm.test/board?stream=1").pathname]) {
  assert.equal(await loadView(path), Board);
  assert.equal(gameImports, 0, "Board imported the game");
}
for (const path of ["/", "/other", "/boardwalk"]) assert.equal(await loadView(path), Game);
assert.equal(gameImports, 1);
`;
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", probe], {
      cwd: scratch, env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home },
      stdout: "pipe", stderr: "pipe", timeout: 10000,
    });
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
