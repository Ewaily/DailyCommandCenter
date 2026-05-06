import { api, isAuthError, type Ticket, type WatchedUser } from "../api.js";
import { $, escapeHtml, renderNotConnected, skeletonCompact, animateNumber } from "./util.js";
import { saveSetting, getSetting } from "../state.js";
import { renderJiraTicket } from "./lists.js";

const MINE = "mine";

// The visible tabs are always [Mine, ...watchedUsers] for the active workspace.
// `watchedUsers` arrives from the server (per-connector config) so the user can
// add or remove tracked teammates without touching code.
let watchedUsers: WatchedUser[] = [];
let active: string = getSetting<string>("jiraTab") || MINE;

const renderTicket = (t: Ticket): string => renderJiraTicket(t);

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
    body.innerHTML = data.map(renderTicket).join("");
  } catch (err) {
    if (isAuthError(err)) { body.innerHTML = renderNotConnected("Jira", "jira"); resetCounts(); }
    else body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
  }
}

export function bindTicketTabs() {
  // Initial render with just "Mine" — server response then expands the list.
  renderTabs();
}

// Team Board still lives in lists.ts (no spec change for it).
export { loadTeamBoard } from "./lists.js";
