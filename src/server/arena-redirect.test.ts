import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server";
import { createServer as createVite } from "vite";
import { arenaRedirect } from "./arena-redirect";

test("production redirects both arena aliases before SPA fallback and retains queries", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "arena-alias-"));
  const app = createServer({ port: 0, hostname: "127.0.0.1", dataDir, env: {} });
  try {
    for (const path of ["/arena", "/arena/"]) {
      const response = await fetch(new URL(path + "?stream=1&team=tabs", app.server.url), { redirect: "manual" });
      expect(response.status).toBe(307); expect(response.headers.get("location")).toBe("/?stream=1&team=tabs");
    }
    for (const path of ["/", "/board", "/board/"]) {
      const response = await fetch(new URL(path, app.server.url), { redirect: "manual" });
      expect(response.headers.get("location")).toBeNull();
    }
  } finally { await app.stop(); rmSync(dataDir, { recursive: true, force: true }); }
});
test("Vite redirects aliases before its fallback without redirecting board or root", async () => {
  const vite = await createVite({ configFile: false, plugins: [arenaRedirect()], server: { host: "127.0.0.1", port: 0 }, logLevel: "silent" });
  try {
    await vite.listen();
    const address = vite.httpServer!.address() as { port: number }, origin = `http://127.0.0.1:${address.port}`;
    for (const path of ["/arena", "/arena/"]) {
      const response = await fetch(origin + path + "?touch=1", { redirect: "manual" });
      expect(response.status).toBe(307); expect(response.headers.get("location")).toBe("/?touch=1");
    }
    for (const path of ["/", "/board", "/board/"]) expect((await fetch(origin + path, { redirect: "manual" })).headers.get("location")).toBeNull();
  } finally { await vite.close(); }
});
