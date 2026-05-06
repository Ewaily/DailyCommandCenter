// Command palette (⌘K) — fully dynamic, context-aware.
//
// Sections:
//   System      — global actions, always shown
//   Workspaces  — one entry per workspace, reactive to workspace-switcher state
//   Navigation  — jump commands, shown only when the target widget is visible
//   Content     — schedule events, tickets, PRs, channels (live DOM scrape)
import { $, escapeHtml } from "./util.js";
import { toggleTheme } from "./theme.js";
import { listWorkspaces, getActiveWorkspaceId, setActiveWorkspaceId } from "./workspace-switcher.js";
import { openSettings, openToNewWorkspace } from "./settings.js";

type PaletteItem = {
  section: string;
  glyph: string;
  title: string;
  meta?: string;
  url?: string;
  action?: () => void;
  hay: string;   // lowercased haystack for matching
};

let items: PaletteItem[] = [];
let filtered: PaletteItem[] = [];
let activeIdx = 0;

function el(id: string) { return document.getElementById(id); }
function isOpen() { return !!el("palette")?.classList.contains("open"); }

export function openPalette(seed = "") {
  rebuildItems();
  const backdrop = el("palette");
  const input = $<HTMLInputElement>("#palette-input");
  if (!backdrop || !input) return;
  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");
  input.value = seed;
  filter(seed);
  setTimeout(() => input.focus(), 0);
}

export function closePalette() {
  el("palette")?.classList.remove("open");
  el("palette")?.setAttribute("aria-hidden", "true");
}

function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── System commands — always present ─────────────────────────────────────────

const SYSTEM: Array<Omit<PaletteItem, "section" | "hay">> = [
  { glyph: "↻",  title: "Refresh all modules",     meta: "R", action: () => (window as any).__dccRefreshAll?.() },
  { glyph: "🌓", title: "Toggle dark / light mode", meta: "T", action: toggleTheme },
  { glyph: "⚙",  title: "Open Settings",            meta: ",", action: openSettings },
  { glyph: "＋", title: "Create new workspace",     meta: "",  action: openToNewWorkspace },
  { glyph: "?",  title: "Show keyboard shortcuts",  meta: "?", action: () => el("help-modal")?.classList.add("open") },
];

// ── Widgets eligible for Navigation jump commands ─────────────────────────────
// Each entry is only added to the palette if its DOM element is currently visible.

const WIDGETS = [
  { id: "section-schedule", glyph: "📅", title: "Jump to Schedule",       meta: "G S" },
  { id: "section-mentions", glyph: "🔔", title: "Jump to Mentions & DMs", meta: "" },
  { id: "section-prs",      glyph: "👀", title: "Jump to Pull Requests",  meta: "" },
  { id: "section-tickets",  glyph: "🎫", title: "Jump to Tickets",        meta: "" },
  { id: "section-clickup",  glyph: "✅", title: "Jump to ClickUp",        meta: "" },
  { id: "section-channels", glyph: "💬", title: "Jump to Channels",       meta: "G C" },
] as const;

// ── Rebuild — called on every openPalette() ───────────────────────────────────

function rebuildItems() {
  const out: PaletteItem[] = [];

  // 1. System
  for (const c of SYSTEM) {
    out.push({ section: "System", ...c, hay: `${c.title} ${c.meta ?? ""}`.toLowerCase() });
  }

  // 2. Workspaces — derived from live workspace-switcher state.
  const workspaces = listWorkspaces();
  const activeWsId = getActiveWorkspaceId();

  if (workspaces.length >= 2) {
    // Overview option only appears when multiple workspaces exist.
    const overviewActive = activeWsId === null;
    out.push({
      section: "Workspaces",
      glyph: overviewActive ? "✓" : "✦",
      title: "Overview",
      meta: overviewActive ? "current" : "All workspaces",
      hay: "overview switch workspace all",
      action: overviewActive ? undefined : () => setActiveWorkspaceId(null),
    });
  }

  for (const ws of workspaces) {
    const isCurrent = ws.id === activeWsId;
    out.push({
      section: "Workspaces",
      glyph: isCurrent ? "✓" : (ws.icon ?? "□"),
      title: ws.name,
      meta: isCurrent ? "current" : "Switch workspace",
      hay: `switch workspace ${ws.name.toLowerCase()}`,
      action: isCurrent ? undefined : () => setActiveWorkspaceId(ws.id),
    });
  }

  // 3. Navigation — only widgets that are currently visible in the dashboard.
  for (const w of WIDGETS) {
    const node = document.getElementById(w.id);
    if (!node || node.hasAttribute("hidden")) continue;
    out.push({
      section: "Navigation",
      glyph: w.glyph,
      title: w.title,
      meta: w.meta,
      hay: `${w.title} ${w.meta}`.toLowerCase(),
      action: () => jump(w.id),
    });
  }

  // 4. Content — scraped from the live DOM at palette-open time.

  document.querySelectorAll<HTMLElement>("#schedule-body .schedule-item").forEach(node => {
    const title = node.querySelector(".schedule-title")?.textContent?.trim() || "";
    const time  = node.querySelector(".schedule-time")?.textContent?.trim() || "";
    const link  = node.querySelector<HTMLAnchorElement>(".schedule-meta a[target=_blank]");
    if (!title) return;
    out.push({
      section: "Today's events",
      glyph: "📅", title, meta: time,
      url: link?.href, action: link ? () => link.click() : undefined,
      hay: title.toLowerCase(),
    });
  });

  document.querySelectorAll<HTMLAnchorElement>("#my-tickets-body a.schedule-title").forEach(a => {
    const title = a.textContent?.trim() || ""; if (!title) return;
    const key = a.closest(".schedule-item")?.querySelector(".schedule-time")?.textContent?.trim() || "";
    out.push({
      section: "Tickets", glyph: "🎫", title, meta: key, url: a.href,
      action: () => a.click(), hay: `${title} ${key}`.toLowerCase(),
    });
  });

  document.querySelectorAll<HTMLAnchorElement>("#pr-queue-body a.schedule-title").forEach(a => {
    const title = a.textContent?.trim() || ""; if (!title) return;
    const repo = a.closest(".schedule-item")?.querySelector(".schedule-time")?.textContent?.trim() || "";
    out.push({
      section: "Pull requests", glyph: "👀", title, meta: repo, url: a.href,
      action: () => a.click(), hay: `${title} ${repo}`.toLowerCase(),
    });
  });

  document.querySelectorAll<HTMLElement>("#channels-body .slack-channel").forEach(ch => {
    const name = ch.querySelector(".slack-channel-name")?.textContent?.trim() || "";
    const link = ch.querySelector<HTMLAnchorElement>(".slack-channel-link");
    if (!name) return;
    out.push({
      section: "Channels", glyph: "#", title: name, meta: "open in Slack",
      url: link?.href, action: link ? () => link.click() : undefined,
      hay: name.toLowerCase(),
    });
  });

  items = out;
}

// ── Fuzzy scoring ─────────────────────────────────────────────────────────────

function score(query: string, item: PaletteItem): number {
  if (!query) return 1;
  const q = query.toLowerCase().trim();
  if (item.hay.includes(q)) {
    const idx = item.hay.indexOf(q);
    if (idx === 0) return 3;
    if (item.section === "System" || item.section === "Workspaces") return 2.4;
    if (item.section === "Navigation") return 2.2;
    return 2;
  }
  // Subsequence fallback
  let i = 0;
  for (const ch of item.hay) { if (ch === q[i]) i++; if (i === q.length) break; }
  return i >= q.length ? 0.5 : 0;
}

function filter(query: string) {
  const q = query.trim().toLowerCase();
  filtered = items
    .map(it => ({ it, s: score(q, it) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 60)
    .map(x => x.it);
  activeIdx = 0;
  render();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const out = el("palette-results"); if (!out) return;
  if (!filtered.length) {
    out.innerHTML = `<div class="palette-empty">No matches.</div>`;
    return;
  }
  const buckets = new Map<string, PaletteItem[]>();
  for (const it of filtered) {
    const arr = buckets.get(it.section) ?? [];
    arr.push(it);
    buckets.set(it.section, arr);
  }
  let i = 0;
  const html: string[] = [];
  for (const [section, arr] of buckets) {
    html.push(`<div class="palette-section">${escapeHtml(section)}</div>`);
    for (const it of arr) {
      const isCurrent = it.meta === "current";
      html.push(`
        <div class="palette-item${i === activeIdx ? " active" : ""}${isCurrent ? " palette-item--current" : ""}" data-idx="${i}">
          <span class="pi-glyph">${escapeHtml(it.glyph)}</span>
          <span class="pi-title">${escapeHtml(it.title)}</span>
          <span class="pi-meta">${escapeHtml(it.meta || "")}</span>
        </div>`);
      i++;
    }
  }
  out.innerHTML = html.join("");
  out.querySelectorAll<HTMLElement>(".palette-item").forEach(node => {
    node.addEventListener("mousemove", () => { activeIdx = Number(node.dataset.idx); markActive(); });
    node.addEventListener("click",     () => { activeIdx = Number(node.dataset.idx); execute(); });
  });
}

function markActive() {
  el("palette-results")?.querySelectorAll<HTMLElement>(".palette-item")
    .forEach(n => n.classList.toggle("active", Number(n.dataset.idx) === activeIdx));
  el("palette-results")?.querySelector<HTMLElement>(".palette-item.active")
    ?.scrollIntoView({ block: "nearest" });
}

function execute() {
  const it = filtered[activeIdx]; if (!it) return;
  closePalette();
  if (it.action) it.action();
  else if (it.url) window.open(it.url, "_blank");
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export function bindPalette() {
  const input = $<HTMLInputElement>("#palette-input");
  input?.addEventListener("input",   () => filter(input.value));
  input?.addEventListener("keydown", e => {
    if      (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(filtered.length - 1, activeIdx + 1); markActive(); }
    else if (e.key === "ArrowUp")   { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); markActive(); }
    else if (e.key === "Enter")     { e.preventDefault(); execute(); }
    else if (e.key === "Escape")    { e.preventDefault(); closePalette(); }
  });
  el("palette")?.addEventListener("click", e => { if (e.target === e.currentTarget) closePalette(); });
}

export const isPaletteOpen = isOpen;
