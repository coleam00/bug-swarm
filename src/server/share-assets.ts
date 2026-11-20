import { Resvg } from "@resvg/resvg-js";
import { Hono } from "hono";
import { BUG_STYLES } from "../web/game/styles";

// A static SVG interpretation of draw.ts. No canvas or per-frame work is shared.
const glow = `<radialGradient id="core"><stop stop-color="#b5fff0"/><stop offset=".32" stop-color="#64fbd0" stop-opacity=".65"/><stop offset="1" stop-color="#64fbd0" stop-opacity="0"/></radialGradient>`;
const robot = `<rect x="-14" y="-14" width="28" height="28" rx="7" fill="#314757" stroke="#84b6bd" stroke-width="2"/>
  <path d="M-18-8h5v16h-5z M13-8h5v16h-5z" fill="#152532"/>
  <circle r="30" fill="url(#core)"/><circle r="6" fill="#b5fff0"/>`;

export function robotSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="-24 -24 48 48"><defs>${glow}</defs><rect x="-24" y="-24" width="48" height="48" rx="10" fill="#0b1018"/>${robot}</svg>`;
}

function beetle(x: number, y: number, angle: number, kind: keyof typeof BUG_STYLES): string {
  const style = BUG_STYLES[kind];
  let legs = "";
  for (const side of [-1, 1]) for (const leg of [-1, 0, 1]) {
    legs += `M${leg * 6},${side * 5} ${leg * 8},${side * 12} ${leg * 10 - 3},${side * style.leg} `;
  }
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(2.6)">
    <path d="${legs}" fill="none" stroke="${style.legs}" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="9" rx="5" ry="6" fill="#502f43"/>
    <ellipse cx="-1" rx="${style.length}" ry="${style.width}" fill="${style.body}"/>
    <path d="M-11 0H7" stroke="#663b50" stroke-width="1.5"/>
    <ellipse cx="-2" cy="-3" rx="6" ry="2" fill="${style.highlight}"/>
    <path d="M10-4h2v2h-2z M10 2h2v2h-2z" fill="#ffe6c5"/></g>`;
}

export function previewSvg(): string {
  const bugs: [number, number, number, keyof typeof BUG_STYLES][] = [
    [210, 180, 20, "base"], [350, 450, -25, "fast"], [940, 160, 155, "fast"],
    [910, 445, -160, "base"], [150, 370, -10, "fast"], [1060, 310, 180, "base"],
    [430, 130, 55, "base"], [720, 510, -110, "fast"],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>${glow}<pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#2d5765" stroke-opacity=".35"/></pattern>
    <radialGradient id="vignette"><stop offset=".3" stop-color="#080f19" stop-opacity="0"/><stop offset="1" stop-color="#080f19" stop-opacity=".85"/></radialGradient></defs>
    <path fill="#101d2a" d="M0 0h1200v630H0z"/><path fill="url(#grid)" d="M0 0h1200v630H0z"/>
    <g fill="url(#core)" opacity=".4"><circle cx="535" cy="340" r="65"/><circle cx="490" cy="360" r="45"/><circle cx="455" cy="375" r="30"/></g>
    ${bugs.map(args => beetle(...args)).join("")}
    <g stroke="#64fbd0" stroke-width="12" opacity=".2" stroke-linecap="round"><path d="M690 270l65-32 M480 260l-55-30 M710 380l60 30"/></g>
    <g stroke="#fff2b8" stroke-width="4" stroke-linecap="round"><path d="M690 270l65-32 M480 260l-55-30 M710 380l60 30"/></g>
    <g transform="translate(600 315) scale(4)">${robot}</g>
    <path fill="url(#vignette)" d="M0 0h1200v630H0z"/></svg>`;
}

function raster(svg: string, width: number): Buffer {
  // Only trusted, code-generated SVG: no fonts, images, links or external resources.
  return new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: "width", value: width } }).render().asPng();
}

function ico(png: Buffer): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); // icon directory type
  header.writeUInt16LE(1, 4); // one embedded PNG
  header[6] = 32; header[7] = 32;
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

export const SHARE_PATHS = ["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/og-image.png"] as const;

export function createShareAssets() {
  // Generate once at startup. Requests only copy cached bytes into responses.
  const svg = robotSvg();
  const assets = [
    { type: "image/svg+xml", body: Buffer.from(svg) },
    { type: "image/vnd.microsoft.icon", body: ico(raster(svg, 32)) },
    { type: "image/png", body: raster(svg, 180) },
    { type: "image/png", body: raster(previewSvg(), 1200) },
  ];
  const app = new Hono();
  SHARE_PATHS.forEach((path, index) => {
    const asset = assets[index]!;
    app.get(path, () => new Response(new Uint8Array(asset.body), { headers: {
      "Content-Type": asset.type, "Cache-Control": "public, max-age=3600",
    } }));
  });
  return app;
}
