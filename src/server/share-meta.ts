// Shared with Vite: no runtime, database or rasterizer imports here.
export const ORIGIN_PLACEHOLDER = "__BUG_SWARM_PUBLIC_ORIGIN__";

function validateOrigin(raw: string, setting: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error(`${setting} must be an HTTP(S) origin.`); }
  if (!/^https?:\/\/[^/\\?#@]+\/?$/i.test(raw) || !/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" ||
      url.search || url.hash || raw.trim() !== raw || /[?#]/.test(raw)) {
    throw new Error(`${setting} must be an HTTP(S) origin without credentials, path, query or fragment.`);
  }
  return url.origin;
}

export function configuredOrigin(env: Record<string, string | undefined>): string | undefined {
  if (env.PUBLIC_ORIGIN !== undefined) return validateOrigin(env.PUBLIC_ORIGIN, "PUBLIC_ORIGIN");
  if (env.RAILWAY_PUBLIC_DOMAIN !== undefined) {
    return validateOrigin(`https://${env.RAILWAY_PUBLIC_DOMAIN}`, "RAILWAY_PUBLIC_DOMAIN");
  }
  return undefined;
}

export function renderShareMeta(html: string, origin: string): string {
  const escaped = origin.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
  return html.replaceAll(ORIGIN_PLACEHOLDER, escaped);
}
