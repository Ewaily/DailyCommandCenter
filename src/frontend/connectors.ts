// Single source of truth for "what connectors does the active workspace actually have?"
//
// The whole UI hides anything tagged with [data-requires-connector="..."] until
// the relevant connector is present and has a usable identity. This keeps a
// fresh workspace empty-by-default — no card, KPI, or sidebar slot is rendered
// for a tool that hasn't been connected yet.
//
// Capabilities are UI-level concepts. Multiple backend connector types can map
// to the same capability (e.g. "calendar" is satisfied by either gcal OR outlook).

import { api, type ConnectorInstance } from "./api.js";
import { getActiveWorkspaceId } from "./components/workspace-switcher.js";
import { renderWorkspaceCluster } from "./components/workspace-logo.js";

export type Capability = "calendar" | "slack" | "github" | "jira" | "clickup" | "notion";

const TYPE_TO_CAPABILITY: Record<string, Capability> = {
  gcal: "calendar",
  outlook: "calendar",
  slack: "slack",
  github: "github",
  jira: "jira",
  clickup: "clickup",
  notion: "notion",
};

type WsLite = { id: string; name: string; icon: string | null; color: string | null; logoUrl: string | null; website: string | null };
type ContribEntry = { ws: WsLite; source: "owned" | "shared" };

let connected: Set<Capability> = new Set();
let contributors: Record<Capability, ContribEntry[]> = { calendar: [], slack: [], github: [], jira: [], clickup: [], notion: [] };
let loaded = false;
let rawUsable: ConnectorInstance[] = [];

export function getLoadedConnectors(): ConnectorInstance[] { return rawUsable; }

export function getContributors(cap: Capability): WsLite[] {
  return (contributors[cap] || []).map(e => e.ws);
}

export function getContributorEntries(cap: Capability): ContribEntry[] {
  return contributors[cap] || [];
}

export function hasSharedContributor(cap: Capability): boolean {
  return (contributors[cap] || []).some(e => e.source === "shared");
}

export function hasCapability(cap: Capability): boolean {
  return connected.has(cap);
}

export function hasAnyCapability(caps: Capability[]): boolean {
  return caps.some(c => connected.has(c));
}

export function snapshotCapabilities(): Capability[] {
  return Array.from(connected);
}

export function isConnectorsLoaded(): boolean { return loaded; }

function isUsable(c: ConnectorInstance, isOverview: boolean): boolean {
  if (!c.enabled) return false;
  if (!c.identity?.hasToken) return false;
  if (isOverview) return c.shareWithOverview === true;
  if (c.source === "shared" && !c.enabledForThisWorkspace) return false;
  return true;
}

export async function loadConnectors(): Promise<void> {
  const wsId = getActiveWorkspaceId();
  const next = new Set<Capability>();
  const nextContrib: Record<Capability, ContribEntry[]> = { calendar: [], slack: [], github: [], jira: [], clickup: [], notion: [] };
  const nextUsable: ConnectorInstance[] = [];

  try {
    const list: ConnectorInstance[] = wsId
      ? (await api.workspace(wsId)).data.connectors
      : (await api.connectors()).data;

    for (const c of list) {
      if (!isUsable(c, !wsId)) continue;
      nextUsable.push(c);
      const cap = TYPE_TO_CAPABILITY[c.type];
      if (!cap) continue;
      next.add(cap);
      const owner = c.ownerWorkspace;
      const source: "owned" | "shared" = c.source === "shared" ? "shared" : "owned";
      if (owner) {
        const arr = nextContrib[cap];
        if (!arr.some(e => e.ws.id === owner.id)) {
          arr.push({
            ws: {
              id: owner.id, name: owner.name,
              icon: owner.icon ?? null, color: owner.color ?? null,
              logoUrl: owner.logoUrl ?? null, website: owner.website ?? null,
            },
            source,
          });
        }
      }
    }
  } catch {
    // On failure we keep the previous snapshot rather than blanking the UI.
    return;
  }

  connected = next;
  contributors = nextContrib;
  rawUsable = nextUsable;
  loaded = true;
  window.dispatchEvent(new CustomEvent("connectors-changed", { detail: { capabilities: snapshotCapabilities() } }));
}

// Walks every [data-requires-connector="cap1 cap2"] element and toggles a
// hidden attribute. An element shows when ANY listed capability is connected
// (logical OR) — this matches "Schedule shows if calendar OR outlook is set up".
export function applyConnectorVisibility(): void {
  document.querySelectorAll<HTMLElement>("[data-requires-connector]").forEach(el => {
    const raw = el.dataset.requiresConnector || "";
    const caps = raw.split(/\s+/).filter(Boolean) as Capability[];
    const visible = caps.length === 0 || hasAnyCapability(caps);
    el.toggleAttribute("hidden", !visible);
    el.classList.toggle("connector-hidden", !visible);
  });

  applyProvenance();

  // Top-level empty state: when no capability is connected at all, show a CTA
  // instead of an empty grid. Copy depends on whether the active scope is a
  // workspace ("connect your first tool") or Overview ("nothing shared yet").
  const emptyState = document.getElementById("workspace-empty");
  const grids = document.querySelectorAll<HTMLElement>(".dashboard-grid, .grid-main, .grid-bottom, .kpi-strip");
  const anyConnected = connected.size > 0;
  const isOverview = !getActiveWorkspaceId();
  if (emptyState) {
    emptyState.toggleAttribute("hidden", anyConnected);
    emptyState.classList.toggle("workspace-empty--overview", isOverview);
    const titleEl = emptyState.querySelector<HTMLElement>(".workspace-empty-title");
    const descEl  = emptyState.querySelector<HTMLElement>(".workspace-empty-desc");
    const btnEl   = emptyState.querySelector<HTMLElement>(".btn-primary");
    if (isOverview) {
      if (titleEl) titleEl.textContent = "Overview is empty";
      if (descEl)  descEl.innerHTML = `Overview shows a unified dashboard built from connectors you've explicitly shared.
        Open any workspace in Settings, find a connected tool, and flip on
        <strong>Show in Overview <span class="overview-glyph" aria-hidden="true">✦</span></strong>
        to surface its data here.`;
      if (btnEl)   btnEl.textContent = "Open Settings → Workspaces";
    } else {
      if (titleEl) titleEl.textContent = "No tools connected yet";
      if (descEl)  descEl.textContent = "This workspace is a clean slate — connect a calendar, Slack, GitHub, Jira, or ClickUp to start populating your dashboard. Each card only appears once its tool is connected.";
      if (btnEl)   btnEl.textContent = "Open Settings → Workspaces";
    }
  }
  grids.forEach(g => g.toggleAttribute("hidden", !anyConnected));
}

// Inject provenance badges into each card-header.
// Overview mode: show ALL contributing workspaces.
// Workspace mode: show only SHARED contributors (data from other workspaces),
// so the user always knows when a widget's data originates outside this workspace.
function applyProvenance(): void {
  const wsId = getActiveWorkspaceId();
  const isOverview = !wsId;
  document.querySelectorAll<HTMLElement>("[data-requires-connector]").forEach(card => {
    const head = card.querySelector<HTMLElement>(".card-header .title-row");
    if (!head) return;
    head.querySelector(".ws-logo-cluster")?.remove();
    const caps = (card.dataset.requiresConnector || "").split(/\s+/).filter(Boolean) as Capability[];
    const seen = new Map<string, WsLite>();
    for (const cap of caps) {
      for (const entry of getContributorEntries(cap)) {
        // In workspace mode only surface shared contributors (not the workspace's own data).
        if (!isOverview && entry.source !== "shared") continue;
        seen.set(entry.ws.id, entry.ws);
      }
    }
    const list = [...seen.values()];
    if (!list.length) return;
    const cluster = renderWorkspaceCluster(list, 22);
    // Mark workspace-mode badges so CSS can style them distinctly.
    const wrapper = document.createElement("span");
    wrapper.innerHTML = cluster;
    const clusterEl = wrapper.firstElementChild as HTMLElement | null;
    if (clusterEl) {
      if (!isOverview) clusterEl.classList.add("ws-logo-cluster--shared");
      head.appendChild(clusterEl);
    }
  });
}
