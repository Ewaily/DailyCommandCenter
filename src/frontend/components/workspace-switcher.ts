// Header workspace switcher.
//
// State model:
//   activeWorkspaceId === null  → Overview (cross-workspace, shows only
//                                 connectors marked "Show in Overview").
//   activeWorkspaceId === "<id>" → drilled into a specific workspace.
// Persisted in localStorage. Components react via the "workspace-changed" custom event.

import { api, type Workspace } from "../api.js";
import { escapeHtml } from "./util.js";
import { renderWorkspaceBadge } from "./workspace-logo.js";

const KEY = "dcc-active-workspace";

let workspaces: Workspace[] = [];
let active: string | null = (() => {
  const v = localStorage.getItem(KEY);
  return v === null || v === "" ? null : v;
})();

export function getActiveWorkspaceId(): string | null { return active; }

export function setActiveWorkspaceId(id: string | null) {
  active = id;
  if (id === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, id);
  render();
  window.dispatchEvent(new CustomEvent("workspace-changed", { detail: { workspaceId: id } }));
}

export function listWorkspaces(): Workspace[] { return workspaces; }

function host() { return document.getElementById("workspace-switcher"); }

// Apply the workspace's accent color as the live --accent CSS variable so
// every tinted element (buttons, focus rings, links, calendar stripe) reflects
// the active workspace's brand color. Reverts to the stylesheet default when
// Overview is active or no workspace has a custom color.
// Relative luminance per WCAG. Returns 0–1.
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function applyAccent(ws: Workspace | undefined) {
  const root = document.documentElement;
  const color = ws?.color ?? null;
  if (!color) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-hover");
    root.style.removeProperty("--accent-soft");
    root.style.removeProperty("--accent-on");
    return;
  }
  root.style.setProperty("--accent", color);
  root.style.setProperty("--accent-hover", `color-mix(in srgb, ${color} 82%, black)`);
  root.style.setProperty("--accent-soft", `color-mix(in srgb, ${color} 14%, transparent)`);
  // Pick black for light accents, white for dark — keeps button text readable.
  root.style.setProperty("--accent-on", luminance(color) > 0.55 ? "#0b0d10" : "#ffffff");
}

function render() {
  const el = host();
  if (!el) return;

  const activeWs = workspaces.find(w => w.id === active);
  applyAccent(activeWs);

  // With only one workspace there is nothing to switch to.
  // Render a plain (non-interactive) pill so the header stays informative
  // but doesn't confuse with a pointless dropdown.
  if (workspaces.length <= 1) {
    const ws = workspaces[0];
    const badge = ws ? renderWorkspaceBadge(ws, 28) : "";
    el.innerHTML = `
      <div class="ws-switcher-pill">
        ${badge}<span class="ws-switcher-label">${escapeHtml(ws?.name || "—")}</span>
      </div>`;
    return;
  }

  // Multiple workspaces — full dropdown.
  const labelText = activeWs ? activeWs.name : "Overview";
  const lead = active === null
    ? `<span class="ws-overview-glyph" aria-hidden="true">✦</span>`
    : (activeWs ? renderWorkspaceBadge(activeWs, 26) : "");

  el.innerHTML = `
    <button class="ws-switcher-btn ${active === null ? "is-overview" : ""}" aria-haspopup="listbox" aria-expanded="false" id="ws-switcher-btn">
      ${lead}<span class="ws-switcher-label">${escapeHtml(labelText)}</span><span class="ws-switcher-caret" aria-hidden="true">▾</span>
    </button>
  `;

  const btn = document.getElementById("ws-switcher-btn") as HTMLButtonElement | null;

  // Tear down any previously-mounted body menu (from a prior render).
  document.getElementById("ws-switcher-menu")?.remove();

  const menu = document.createElement("div");
  menu.id = "ws-switcher-menu";
  menu.className = "ws-switcher-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("hidden", "");
  menu.innerHTML = `
    <button class="ws-menu-item ws-menu-overview ${active === null ? "active" : ""}" data-ws-id="">
      <span class="ws-overview-glyph" aria-hidden="true">✦</span>
      <span class="ws-menu-item-label">
        <span class="ws-menu-item-name">Overview</span>
        <span class="ws-menu-item-sub">Shared connectors across every workspace</span>
      </span>
    </button>
    <div class="ws-menu-divider" aria-hidden="true"></div>
    ${workspaces.map(w => `
      <button class="ws-menu-item ${active === w.id ? "active" : ""}" data-ws-id="${escapeHtml(w.id)}">
        ${renderWorkspaceBadge(w, 22, { title: false })}
        <span class="ws-menu-item-name">${escapeHtml(w.name)}</span>
        ${w.website ? `<span class="ws-menu-item-domain muted">${escapeHtml(w.website)}</span>` : ""}
      </button>
    `).join("")}
  `;
  // Mount on body so it escapes any header stacking context / overflow clipping.
  document.body.appendChild(menu);

  const onDoc = (e: MouseEvent) => {
    const t = e.target as Node;
    if (menu.contains(t) || btn?.contains(t)) return;
    closeMenu();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };

  const closeMenu = () => {
    menu.setAttribute("hidden", "");
    btn?.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDoc, true);
    document.removeEventListener("keydown", onKey);
  };

  const openMenu = () => {
    const rect = btn!.getBoundingClientRect();
    menu.style.top   = `${rect.bottom + 6}px`;
    menu.style.right = `${window.innerWidth - rect.right}px`;
    menu.removeAttribute("hidden");
    btn?.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onDoc, true);
    document.addEventListener("keydown", onKey);
  };

  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hasAttribute("hidden")) openMenu();
    else closeMenu();
  });

  menu.querySelectorAll<HTMLElement>("[data-ws-id]").forEach(item => {
    item.addEventListener("click", () => {
      closeMenu();
      const id = item.dataset.wsId;
      setActiveWorkspaceId(id ? id : null);
    });
  });
}

// Auto-pick: with exactly one workspace, "Overview" is meaningless — drill into it.
function autoSelectIfSingle() {
  if (active === null && workspaces.length === 1) {
    setActiveWorkspaceId(workspaces[0].id);
    return true;
  }
  return false;
}

// Refetch workspace list (after Settings CRUD) and re-render. If the active id
// no longer exists, fall back (auto-select if 1, else null).
export async function refreshActiveWorkspace() {
  try {
    const r = await api.workspaces();
    workspaces = r.data.workspaces;
    if (active && !workspaces.some(w => w.id === active)) {
      active = null;
      localStorage.removeItem(KEY);
    }
    if (autoSelectIfSingle()) {
      window.dispatchEvent(new CustomEvent("workspaces-updated", { detail: { workspaces } }));
      return;
    }
    render();
    window.dispatchEvent(new CustomEvent("workspaces-updated", { detail: { workspaces } }));
  } catch {
    render();
  }
}

export async function initWorkspaceSwitcher() {
  try {
    const r = await api.workspaces();
    workspaces = r.data.workspaces;
    if (autoSelectIfSingle()) return;
    render();
  } catch {
    // Server may be down; render an empty switcher.
    render();
  }
}
