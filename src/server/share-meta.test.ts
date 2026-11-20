import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { configuredOrigin, ORIGIN_PLACEHOLDER, renderShareMeta } from "./share-meta";

test("public origin precedence, normalization and local request fallback", () => {
  expect(configuredOrigin({ PUBLIC_ORIGIN: "http://localhost:9876/", RAILWAY_PUBLIC_DOMAIN: "ignored.test" })).toBe("http://localhost:9876");
  expect(configuredOrigin({ RAILWAY_PUBLIC_DOMAIN: "swarm.up.railway.app" })).toBe("https://swarm.up.railway.app");
  expect(configuredOrigin({})).toBeUndefined();
});

test.each(["", "wat", "ftp://example.test", "https://user:pass@example.test", "https://example.test/path",
  "https://example.test?x=1", "https://example.test#x", "https://example.test?", "https://example.test#", " https://example.test",
  "https://example.test/path/..", "http:example.test", "https://@example.test", "https://example.test\\"])("rejects PUBLIC_ORIGIN %j", value => {
  expect(() => configuredOrigin({ PUBLIC_ORIGIN: value })).toThrow("PUBLIC_ORIGIN must be an HTTP(S) origin");
});

test.each(["", "example.test/path", "example.test?x=1", "user@example.test", "https://example.test"])("rejects Railway domain %j", value => {
  expect(() => configuredOrigin({ RAILWAY_PUBLIC_DOMAIN: value })).toThrow("RAILWAY_PUBLIC_DOMAIN");
});

test("substitutes every placeholder and escapes attribute content", () => {
  const html = `<meta content="${ORIGIN_PLACEHOLDER}/"><meta content="${ORIGIN_PLACEHOLDER}/og-image.png">`;
  expect(renderShareMeta(html, `https://a.test/\"<>&'`)).toBe('<meta content="https://a.test/&quot;&lt;&gt;&amp;&#39;/"><meta content="https://a.test/&quot;&lt;&gt;&amp;&#39;/og-image.png">');
});

test("initial HTML carries complete cards, dark theme and generated icon links", () => {
  const html = renderShareMeta(readFileSync(new URL("../../index.html", import.meta.url), "utf8"), "https://swarm.test");
  const tags = new Map([...html.matchAll(/<meta (?:name|property)="([^"]+)" content="([^"]*)"/g)].map(match => [match[1], match[2]]));
  const description = "Steer a glowing robot, squash bugs, pick upgrades, and race Tabs vs Spaces on the shared leaderboard.";
  const alt = "A glowing robot surrounded by colourful beetles on Bug Swarm's dark grid arena.";
  const viewport = Object.fromEntries((tags.get("viewport") ?? "").split(",").map(directive =>
    directive.trim().split("=").map(part => part.trim())));
  expect(viewport.width).toBe("device-width");
  expect(Number(viewport["initial-scale"])).toBe(1);
  expect(viewport["viewport-fit"]).toBe("cover");
  expect(Object.fromEntries(tags)).toMatchObject({
    description, "theme-color": "#0b1018", "og:title": "Bug Swarm", "og:description": description,
    "og:type": "website", "og:site_name": "Bug Swarm", "og:url": "https://swarm.test/",
    "og:image": "https://swarm.test/og-image.png", "og:image:type": "image/png", "og:image:width": "1200",
    "og:image:height": "630", "og:image:alt": alt, "twitter:card": "summary_large_image",
    "twitter:title": "Bug Swarm", "twitter:description": description, "twitter:image": "https://swarm.test/og-image.png", "twitter:image:alt": alt,
  });
  expect(html).not.toContain(ORIGIN_PLACEHOLDER);
  expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="32x32"');
  expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml"');
  expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180"');
});
