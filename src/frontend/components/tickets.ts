import { api, isAuthError, type Ticket, type WatchedUser } from "../api.js";
import { $, escapeHtml, renderNotConnected, skeletonCompact, animateNumber, toast } from "./util.js";
import { saveSetting, getSetting } from "../state.js";
import { renderJiraTicket } from "./lists.js";

const MINE = "mine";

async function handleClone(btn: HTMLElement): Promise<void> {
  const connectorId = btn.dataset.connectorId || "";
  const project     = btn.dataset.targetProject || "";
  if (!connectorId || !project) {
    toast("Configure 1-Click Cloning on this connector (Workspaces tab) — set Target Base URL, Email, API Token, and Project.", "error");
    return;
  }
  const title  = btn.dataset.cloneTitle || "";
  const url    = btn.dataset.cloneUrl   || "";
  const source = (btn.dataset.cloneSource || "jira") as "jira" | "clickup";
  const dismiss = toast("Cloning ticket…", { type: "info", duration: 15_000 });
  try {
    const resp = await api.cloneTicket({ sourceProvider: source, title, originalLink: url, connectorId });
    dismiss?.();
    toast("Cloned!", {
      type: "success",
      duration: 6000,
      action: { label: `Open ${resp.data.key}`, onClick: () => window.open(resp.data.url, "_blank") },
    });
  } catch (err: any) {
    dismiss?.();
    toast(`Clone failed: ${err.message}`, "error");
  }
}

// The visible tabs are always [Mine, ...watchedUsers] for the active workspace.
// `watchedUsers` arrives from the server (per-connector config) so the user can
// add or remove tracked teammates without touching code.
let watchedUsers: WatchedUser[] = [];
let active: string = getSetting<string>("jiraTab") || MINE;

function bucketIds(): string[] {
  return [MINE, ...watchedUsers.map(w => w.id)];
}

function bucketLabel(id: string): string {
  if (id === MINE) return "Mine";
  return watchedUsers.find(w => w.id === id)?.label || id;
}

function renderTabs() {
  const tabs = $("#jira-tabs");
  if (!tabs) return;
  tabs.innerHTML = bucketIds().map(id => {
    const cls = id === active ? "tab active" : "tab";
    return `<button class="${cls}" data-jira-tab="${escapeHtml(id)}" data-tab-id="${escapeHtml(id)}">${escapeHtml(bucketLabel(id))} <span class="tab-count" data-jira-count="${escapeHtml(id)}">—</span></button>`;
  }).join("");

  tabs.querySelectorAll<HTMLElement>("[data-jira-tab]").forEach(b => {
    b.addEventListener("click", () => {
      active = b.dataset.jiraTab || MINE;
      saveSetting("jiraTab", active);
      syncTabUI();
      loadTickets();
    });
  });
}

function syncTabUI() {
  document.querySelectorAll<HTMLElement>("#jira-tabs [data-jira-tab]").forEach(b => {
    b.classList.toggle("active", b.dataset.jiraTab === active);
  });
}

function updateCounts(counts: Record<string, number>) {
  for (const id of bucketIds()) {
    const el = document.querySelector(`#jira-tabs [data-jira-count="${CSS.escape(id)}"]`);
    if (el) el.textContent = String(counts[id] ?? 0);
  }
  // KPI uses the "mine" count.
  animateNumber($("#kpi-tickets"), counts[MINE] ?? 0);
  const detail = $("#kpi-tickets-detail");
  if (detail) {
    const parts = [`${counts[MINE] ?? 0} mine`];
    for (const w of watchedUsers) parts.push(`${counts[w.id] ?? 0} ${w.label}`);
    detail.textContent = parts.join(" · ");
  }
}

function resetCounts() {
  for (const id of bucketIds()) {
    const el = document.querySelector(`#jira-tabs [data-jira-count="${CSS.escape(id)}"]`);
    if (el) el.textContent = "0";
  }
  const k = $("#kpi-tickets"); if (k) k.textContent = "—";
  const d = $("#kpi-tickets-detail"); if (d) d.textContent = "Not in this workspace";
}

export async function loadTickets(silent = false) {
  const body = $("#my-tickets-body");
  if (!body) return;
  if (!silent) body.innerHTML = skeletonCompact(3);
  try {
    const resp = await api.ticketsMine(active);
    if (resp.notConfigured) {
      // Tabs stay empty; the section itself is hidden by connector visibility.
      watchedUsers = [];
      renderTabs();
      body.innerHTML = renderNotConnected("Jira", "jira");
      resetCounts();
      return;
    }

    // Sync the watched-users list from the server response. This also re-renders
    // tabs whenever the user adds/removes a watched teammate in Settings.
    const incoming = Array.isArray(resp.buckets) ? resp.buckets : [];
    const idsChanged = incoming.length !== watchedUsers.length
      || incoming.some((w, i) => w.id !== watchedUsers[i]?.id || w.label !== watchedUsers[i]?.label);
    if (idsChanged) {
      watchedUsers = incoming;
      // If our active tab no longer exists, fall back to "mine".
      if (active !== MINE && !watchedUsers.some(w => w.id === active)) {
        active = MINE;
        saveSetting("jiraTab", active);
      }
      renderTabs();
    }

    // The server may have coerced the bucket (e.g. unknown id → mine). Honor it.
    if (resp.bucket && resp.bucket !== active) {
      active = resp.bucket;
      saveSetting("jiraTab", active);
      syncTabUI();
    }

    if (resp.counts) updateCounts(resp.counts);
    const data = resp.data || [];

    const titleEl = $("#tickets-title");
    if (titleEl) titleEl.textContent = "Tickets";

    if (!data.length) {
      const owner = active === MINE ? "Your" : `${bucketLabel(active)}'s`;
      body.innerHTML = `<div class="empty">
        <span class="emoji">${active === MINE ? "🎉" : "✅"}</span>
        <div class="empty-title">${escapeHtml(owner)} queue is clear</div>
        <div>No open tickets in this view.</div>
      </div>`;
      return;
    }
    const cc = resp.connectorCloningConfig ?? { cloningEnabled: false, cloneTargetProject: "", connectorId: undefined };
    body.innerHTML = data.map(t => renderJiraTicket(t, cc.cloningEnabled, cc.cloneTargetProject, cc.connectorId)).join("");
  } catch (err) {
    if (isAuthError(err)) { body.innerHTML = renderNotConnected("Jira", "jira"); resetCounts(); }
    else body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
  }
}

export function bindTicketTabs() {
  renderTabs();

  const body = $("#my-tickets-body");
  body?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".clone-to-jira-btn");
    if (btn) { e.preventDefault(); void handleClone(btn); }
  });
}

// Team Board still lives in lists.ts (no spec change for it).
export { loadTeamBoard } from "./lists.js";

export interface TicketsInstance {
  load(silent?: boolean): Promise<void>;
}

export function instantiateTickets(
  container: HTMLElement,
  connectorId: string,
  opts: { wsName: string; title: string }
): TicketsInstance {
  const { wsName, title } = opts;
  let activeBucket: string = getSetting<string>("jiraTab") || MINE;
  let localWatched: WatchedUser[] = [];

  container.innerHTML = `
    <div class="card-header">
      <div class="title-row">
        <span class="title-source">${escapeHtml(wsName)}</span>
        <span class="title-text">
          <span class="title-icon" data-icon="ticket"></span>
          <span>${escapeHtml(title)}</span>
        </span>
      </div>
      <div class="tabs" data-ov-tabs></div>
    </div>
    <div class="card-body" data-ov-body></div>
  `;

  const body = container.querySelector<HTMLElement>("[data-ov-body]")!;
  const tabsEl = container.querySelector<HTMLElement>("[data-ov-tabs]");

  function bucketIdsLocal() { return [MINE, ...localWatched.map(w => w.id)]; }
  function bucketLabelLocal(id: string) {
    if (id === MINE) return "Mine";
    return localWatched.find(w => w.id === id)?.label || id;
  }

  function renderTabsLocal(counts?: Record<string, number>) {
    if (!tabsEl) return;
    tabsEl.innerHTML = bucketIdsLocal().map(id => {
      const cls = id === activeBucket ? "tab active" : "tab";
      const count = counts?.[id] ?? "—";
      return `<button class="${cls}" data-ov-bucket="${escapeHtml(id)}">${escapeHtml(bucketLabelLocal(id))} <span class="tab-count" data-ov-count="${escapeHtml(id)}">${count}</span></button>`;
    }).join("");
    tabsEl.querySelectorAll<HTMLElement>("[data-ov-bucket]").forEach(b => {
      b.addEventListener("click", () => {
        activeBucket = b.dataset.ovBucket || MINE;
        saveSetting("jiraTab", activeBucket);
        syncTabUILocal();
        load();
      });
    });
  }

  function syncTabUILocal() {
    tabsEl?.querySelectorAll<HTMLElement>("[data-ov-bucket]").forEach(b => {
      b.classList.toggle("active", b.dataset.ovBucket === activeBucket);
    });
  }

  function updateCountsLocal(counts: Record<string, number>) {
    for (const id of bucketIdsLocal()) {
      const el = container.querySelector(`[data-ov-count="${CSS.escape(id)}"]`);
      if (el) el.textContent = String(counts[id] ?? 0);
    }
  }

  renderTabsLocal();

  body.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".clone-to-jira-btn");
    if (btn) { e.preventDefault(); void handleClone(btn); }
  });

  async function load(silent = false): Promise<void> {
    if (!body) return;
    if (!silent) body.innerHTML = skeletonCompact(3);
    try {
      const resp = await api.ticketsMine(activeBucket, connectorId);
      if (resp.notConfigured) {
        localWatched = [];
        renderTabsLocal();
        body.innerHTML = renderNotConnected("Jira", "jira");
        return;
      }
      const incoming = Array.isArray(resp.buckets) ? resp.buckets : [];
      const idsChanged = incoming.length !== localWatched.length
        || incoming.some((w, i) => w.id !== localWatched[i]?.id || w.label !== localWatched[i]?.label);
      if (idsChanged) {
        localWatched = incoming;
        if (activeBucket !== MINE && !localWatched.some(w => w.id === activeBucket)) {
          activeBucket = MINE;
          saveSetting("jiraTab", activeBucket);
        }
        renderTabsLocal(resp.counts as Record<string, number> | undefined);
      }
      if (resp.bucket && resp.bucket !== activeBucket) {
        activeBucket = resp.bucket;
        saveSetting("jiraTab", activeBucket);
        syncTabUILocal();
      }
      if (resp.counts) updateCountsLocal(resp.counts as Record<string, number>);
      const data = resp.data || [];
      if (!data.length) {
        const owner = activeBucket === MINE ? "Your" : `${bucketLabelLocal(activeBucket)}'s`;
        body.innerHTML = `<div class="empty">
          <span class="emoji">${activeBucket === MINE ? "🎉" : "✅"}</span>
          <div class="empty-title">${escapeHtml(owner)} queue is clear</div>
          <div>No open tickets in this view.</div>
        </div>`;
        return;
      }
      const cc = resp.connectorCloningConfig ?? { cloningEnabled: false, cloneTargetProject: "", connectorId: undefined };
      body.innerHTML = data.map(t => renderJiraTicket(t, cc.cloningEnabled, cc.cloneTargetProject, cc.connectorId)).join("");
    } catch (err) {
      if (isAuthError(err)) body.innerHTML = renderNotConnected("Jira", "jira");
      else body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
    }
  }

  return { load };
}
