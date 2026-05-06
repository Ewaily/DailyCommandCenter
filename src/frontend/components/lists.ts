// Tickets / Team Board / PRs — shared list-card pattern.
import { api, isAuthError, type Envelope, type Ticket, type PR } from "../api.js";
import { $, escapeHtml, renderNotConnected, skeletonCompact, animateNumber } from "./util.js";
import { renderTaskRow } from "./task-row.js";

export function renderJiraTicket(t: Ticket, cloningEnabled = false): string {
  return renderTaskRow({
    key: t.key || "",
    keyTitle: t.project || undefined,
    url: t.url,
    title: t.title,
    status: t.status,
    statusColor: t.statusColor,
    statusBucket: t.statusBucket,
    priority: t.priority,
    assignees: t.assignee ? [{ name: t.assignee.name, avatar: t.assignee.avatar }] : [],
    listLabel: t.project,
    dueDate: t.dueDate,
    cloneSource: cloningEnabled ? "jira" : undefined,
  });
}

const renderTicket = renderJiraTicket;

function renderPR(p: PR): string {
  const tag = p.waitingOnYou ? `<span class="badge badge-urgent">Review</span>` : `<span class="badge badge-info">Waiting</span>`;
  return `
    <div class="schedule-item">
      <div class="schedule-time item-key">#${escapeHtml(String(p.number || ""))}</div>
      <div class="schedule-content">
        <div class="schedule-title-row">
          <a href="${escapeHtml(p.url)}" target="_blank" class="schedule-title">${escapeHtml(p.title)}</a>
          ${tag}
        </div>
        <div class="schedule-meta">
          ${escapeHtml(p.repo || "")}<span class="meta-sep">·</span>opened ${escapeHtml(p.ageHuman || "")}
          ${p.author ? `<span class="meta-sep">·</span>by ${escapeHtml(p.author)}` : ""}
        </div>
      </div>
    </div>`;
}


async function renderList<T>({
  bodyId, fetchFn, providerName, providerKey, emptyMsg, itemRenderer,
  kpiId, kpiDetailId, kpiDetailFn, silent,
}: {
  bodyId: string;
  fetchFn: () => Promise<Envelope<T[]>>;
  providerName: string;
  providerKey: string;
  emptyMsg: string;
  itemRenderer: (item: T) => string;
  kpiId?: string;
  kpiDetailId?: string;
  kpiDetailFn?: (data: T[]) => string;
  silent?: boolean;
}) {
  const body = $(`#${bodyId}`)!;
  if (!silent) body.innerHTML = skeletonCompact(3);
  try {
    const resp = await fetchFn();
    if (resp.notConfigured) {
      body.innerHTML = renderNotConnected(providerName, providerKey);
      if (kpiId) { const v = $(`#${kpiId}`); if (v) v.textContent = "—"; }
      return;
    }
    const data = resp.data || [];
    if (kpiId) animateNumber($(`#${kpiId}`), data.length);
    if (kpiDetailId && kpiDetailFn) { const d = $(`#${kpiDetailId}`); if (d) d.textContent = kpiDetailFn(data); }
    if (!data.length) {
      body.innerHTML = `<div class="empty"><span class="emoji">🌿</span><div class="empty-title">${escapeHtml(emptyMsg)}</div></div>`;
      return;
    }
    body.innerHTML = data.map(itemRenderer).join("");
  } catch (err) {
    if (isAuthError(err)) body.innerHTML = renderNotConnected(providerName, providerKey);
    else body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
  }
}

export const loadTeamBoard = (silent = false) => renderList({
  bodyId: "team-board-body",
  fetchFn: () => api.ticketsTeam(),
  providerName: "Jira", providerKey: "jira",
  emptyMsg: "Team board is empty for the active project.",
  itemRenderer: renderTicket, silent,
});

