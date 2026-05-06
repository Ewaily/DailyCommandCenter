// Smart workspace logo: client-side fetcher + monogram fallback.
//
// Strategy: a workspace optionally stores a `website` (e.g. "expensepoint.com")
// and a resolved `logoUrl`. We probe Clearbit's logo API first (transparent PNG
// when found, 404 otherwise); if it fails we fall back to Google's favicon
// service; if that fails (or no website), we render a monogram SVG built from
// the workspace's initials over its accent color.

import type { Workspace } from "../api.js";
import { escapeHtml } from "./util.js";

export function domainFromUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch { return null; }
}

export function clearbitLogoUrl(domain: string, size = 128): string {
  return `https://logo.clearbit.com/${encodeURIComponent(domain)}?size=${size}`;
}

export function googleFaviconUrl(domain: string, size = 128): string {
  return `https://www.google.com/s2/favicons?sz=${size}&domain_url=${encodeURIComponent(domain)}`;
}

export function buildLogoCandidates(websiteOrLogoUrl: string | null | undefined): string[] {
  if (!websiteOrLogoUrl) return [];
  // If caller already gave us an absolute URL ending in an image-like path,
  // try it verbatim first; otherwise treat it as a website + derive candidates.
  const looksAbsolute = /^https?:\/\//i.test(websiteOrLogoUrl) && /\.(png|jpe?g|svg|webp|ico)(\?|$)/i.test(websiteOrLogoUrl);
  if (looksAbsolute) return [websiteOrLogoUrl];
  const dom = domainFromUrl(websiteOrLogoUrl);
  if (!dom) return [];
  return [clearbitLogoUrl(dom), googleFaviconUrl(dom)];
}

export function initialsFor(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Pick a readable foreground (#fff or #111) given a hex bg color.
function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  // perceived luminance
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? "#0F172A" : "#FFFFFF";
}

// Inline SVG monogram → data URL (fits any <img src>). Crisp at any size.
export function monogramDataUrl(name: string, color: string | null, size = 96): string {
  const bg = (color && /^#[0-9a-f]{6}$/i.test(color)) ? color : "#0E4C5B";
  const fg = readableOn(bg);
  const txt = initialsFor(name);
  const fs  = txt.length > 1 ? Math.round(size * 0.42) : Math.round(size * 0.5);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg}"/>
        <stop offset="100%" stop-color="${shade(bg, -16)}"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" rx="${Math.round(size * 0.22)}" fill="url(#g)"/>
    <text x="50%" y="50%" dy=".07em" text-anchor="middle" dominant-baseline="middle"
          font-family="Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
          font-weight="700" font-size="${fs}" fill="${fg}" letter-spacing="-0.02em">${escapeXml(txt)}</text>
  </svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

function shade(hex: string, delta: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + delta));
  const g = Math.max(0, Math.min(255, ((n >> 8)  & 0xff) + delta));
  const b = Math.max(0, Math.min(255, (n & 0xff)         + delta));
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

// Render a workspace logo badge (img with onerror cascade ending in monogram).
// Size is the rendered px box; sources are cycled via inline error handlers.
type WsLite = Pick<Workspace, "name" | "color" | "logoUrl" | "website" | "icon">;
export function renderWorkspaceBadge(ws: WsLite, size: number = 24, opts: { title?: boolean } = {}): string {
  const candidates = ws.logoUrl
    ? [ws.logoUrl, ...buildLogoCandidates(ws.website)]
    : buildLogoCandidates(ws.website);
  const monogram = monogramDataUrl(ws.name, ws.color, Math.max(48, size * 2));
  const all = [...candidates.filter(Boolean), monogram];

  // Build a small JS chain on the <img>: on error, replace src with the next
  // candidate; final entry is the monogram (always succeeds).
  const stages = all.map(s => JSON.stringify(s)).join(",");
  const onerr = `(function(img){var a=[${stages}];var i=img.dataset.stage?+img.dataset.stage:0;img.dataset.stage=String(i+1);if(i+1<a.length){img.src=a[i+1];}else{img.onerror=null;}})(this)`;

  const title = opts.title === false ? "" : ` title="${escapeHtml(ws.name)}"`;
  return `<span class="ws-logo" style="--ws-size:${size}px;--ws-color:${ws.color || "var(--accent)"}"${title}>
    <img src="${escapeHtml(all[0])}" alt="${escapeHtml(ws.name)} logo" data-stage="0" onerror='${onerr}' loading="lazy" />
  </span>`;
}

// Compact cluster (overlapped) of multiple workspace badges — used in Overview
// to attribute each card to its contributing workspaces.
export function renderWorkspaceCluster(list: WsLite[], size: number = 18, max = 4): string {
  if (!list.length) return "";
  const visible = list.slice(0, max);
  const overflow = list.length - visible.length;
  const items = visible.map(ws => renderWorkspaceBadge(ws, size)).join("");
  const moreChip = overflow > 0
    ? `<span class="ws-logo ws-logo-more" style="--ws-size:${size}px" title="${overflow} more">+${overflow}</span>`
    : "";
  return `<span class="ws-logo-cluster" aria-label="Contributing workspaces">${items}${moreChip}</span>`;
}
