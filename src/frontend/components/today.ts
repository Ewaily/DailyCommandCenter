// Today/Overview context banner.
//
// The app defaults to Overview (active = null) and this banner makes the active
// context obvious at a glance. Overview only surfaces connectors whose owner
// flipped "Show in Overview" on — never every workspace's data automatically.

import { api, type Workspace } from "../api.js";
import { escapeHtml } from "./util.js";
import { snapshotCapabilities, type Capability } from "../connectors.js";

// Ordered list of capabilities → display labels for the scope pill.
// Order here is the display order.
const SCOPE_ORDER: Array<[Capability, string]> = [
  ["calendar", "schedule"],
  ["slack",    "messages"],
  ["github",   "PRs"],
  ["jira",     "tickets"],
  ["clickup",  "tasks"],
  ["notion",   "docs"],
];

function buildScope(): string {
  const active = new Set(snapshotCapabilities());
  const parts = SCOPE_ORDER.filter(([cap]) => active.has(cap)).map(([, label]) => label);
  return parts.length ? `scope: ${parts.join(" · ")}` : "";
}

let cache: Workspace[] = [];

function host() { return document.getElementById("context-banner"); }

function getActive(): string | null {
  const v = localStorage.getItem("dcc-active-workspace");
  return v && v.length ? v : null;
}

function render() {
  const el = host();
  if (!el) return;
  const active = getActive();
  document.body.classList.toggle("is-overview", active === null);
  if (active === null) {
    el.innerHTML = `
      <div class="context-banner-overview">
        <span class="cb-tag">OVERVIEW</span>
        <span class="cb-msg">A unified view of every connector you've explicitly shared with Overview.</span>
      </div>
    `;
    return;
  }
  // Single-workspace user: banner is noise (the switcher already shows the name).
  if (cache.length <= 1) { el.innerHTML = ""; return; }
  const ws = cache.find(w => w.id === active);
  if (!ws) {
    el.innerHTML = `<div class="context-banner-ws"><span class="cb-tag">WORKSPACE</span><span class="cb-msg">${escapeHtml(active)}</span></div>`;
    return;
  }
  const dot = ws.color ? `<span class="ws-dot" style="--c:${ws.color}"></span>` : "";
  const icon = ws.icon ? `<span>${escapeHtml(ws.icon)}</span>` : "";
  const scope = buildScope();
  el.innerHTML = `
    <div class="context-banner-ws">
      ${dot}${icon}<span class="cb-tag">WORKSPACE</span>
      <span class="cb-msg"><strong>${escapeHtml(ws.name)}</strong>${scope ? ` — <span class="cb-scope">${escapeHtml(scope)}</span>` : ""}</span>
    </div>
  `;
}

async function refetchAndRender() {
  try {
    const r = await api.workspaces();
    cache = r.data.workspaces;
  } catch { /* ignore */ }
  render();
}

export async function initTodayBanner() {
  await refetchAndRender();
  window.addEventListener("workspace-changed", render);
  window.addEventListener("connectors-changed", render);
  window.addEventListener("workspaces-updated", refetchAndRender);
}
