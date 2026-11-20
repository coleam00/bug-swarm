import { expect, test } from "bun:test";
import { createShareAssets, SHARE_PATHS } from "./share-assets";

const app = createShareAssets();
function pngDimensions(bytes: Buffer, width: number, height: number) {
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(12, 16).toString()).toBe("IHDR");
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([width, height]);
}

test.each(SHARE_PATHS)("%s serves cached artwork with an image content type", async path => {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(path.endsWith("svg") ? "image/svg+xml" :
    path.endsWith("ico") ? "image/vnd.microsoft.icon" : "image/png");
  expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.length).toBeGreaterThan(100);
  if (path.endsWith("svg")) {
    expect(bytes.toString()).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(bytes.toString()).toContain('viewBox="-24 -24 48 48"');
    expect(bytes.toString()).toContain('fill="#b5fff0"');
    expect(bytes.toString()).not.toMatch(/<(image|text|script)\b/);
  } else if (path.endsWith("ico")) {
    expect([...bytes.subarray(0, 6)]).toEqual([0, 0, 1, 0, 1, 0]);
    expect([...bytes.subarray(6, 14)]).toEqual([32, 32, 0, 0, 1, 0, 32, 0]);
    expect(bytes.readUInt32LE(14)).toBe(bytes.length - 22);
    expect(bytes.readUInt32LE(18)).toBe(22);
    pngDimensions(bytes.subarray(22), 32, 32);
  } else pngDimensions(bytes, path.includes("og-image") ? 1200 : 180, path.includes("og-image") ? 630 : 180);
  expect(Buffer.from(await (await app.request(path)).arrayBuffer())).toEqual(bytes);
});
