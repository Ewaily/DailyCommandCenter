import { api, isAuthError, type ClickUpTask, type WatchedUser } from "../api.js";
import { $, escapeHtml, renderWorkspaceNotConfigured, skeletonCompact } from "./util.js";
import { saveSetting, getSetting } from "../state.js";
import { renderTaskRow } from "./task-row.js";

const MINE = "mine";

let watchedUsers: WatchedUser[] = [];
let active: string = getSetting<string>("clickupTab") || MINE;

function renderTask(t: ClickUpTask): string {
  // ClickUp ids are opaque hashes — fall back to the last 5 chars prefixed with
  // `#` so every row still has a stable identifier column like Jira's EPM-465.
  const key = t.customId || `#${t.id.slice(-5)}`;
  return renderTaskRow({
    key,
    keyTitle: t.id,
    url: t.url,
    title: t.title,
    status: t.status,
    statusColor: t.statusColor,
    statusBucket: t.statusBucket,
    priority: t.priority,
    assignees: t.assignees.map(a => ({ name: a.name, avatar: a.avatar, color: a.color })),
    listLabel: t.list,
    dueDate: t.dueDate,
  });
}

function bucketIds(): string[] {
  return [MINE, ...watchedUsers.map(w => w.id)];
}

function bucketLabel(id: string): string {
  if (id === MINE) return "Mine";
  return watchedUsers.find(w => w.id === id)?.label || id;
}

function renderTabs(counts?: Record<string, number>) {
  const tabs = $("#clickup-tabs");
  if (!tabs) return;
  if (bucketIds().length <= 1) { tabs.innerHTML = ""; return; }
  tabs.innerHTML = bucketIds().map(id => {
    const cls = id === active ? "tab active" : "tab";
    const count = counts?.[id] ?? "—";
    return `<button class="${cls}" data-clickup-tab="${escapeHtml(id)}" data-tab-id="${escapeHtml(id)}">${escapeHtml(bucketLabel(id))} <span class="tab-count">${count}</span></button>`;
  }).join("");

  tabs.querySelectorAll<HTMLElement>("[data-clickup-tab]").forEach(b => {
    b.addEventListener("click", () => {
      active = b.dataset.clickupTab || MINE;
      saveSetting("clickupTab", active);
      loadClickUp();
    });
  });
}

function syncTabUI() {
  document.querySelectorAll<HTMLElement>("[data-clickup-tab]").forEach(b => {
    b.classList.toggle("active", b.dataset.clickupTab === active);
  });
}

export async function loadClickUp(silent = false) {
  const body = $("#clickup-body");
  if (!body) return;
  if (!silent) body.innerHTML = skeletonCompact(3);
  try {
    const resp = await api.clickupTasks(active);
    if (resp.notConfigured) {
      body.innerHTML = renderWorkspaceNotConfigured("ClickUp");
      return;
    }

    watchedUsers = resp.buckets ?? [];

    // Validate active tab still exists; fall back to mine
    if (!bucketIds().includes(active)) {
      active = MINE;
      saveSetting("clickupTab", active);
    }

    renderTabs(resp.counts);
    syncTabUI();

    const data = resp.data || [];
    if (!data.length) {
      body.innerHTML = `
        <div class="empty">
          <span class="empty-icon" data-icon="check"></span>
          <div class="empty-title">All caught up</div>
          <div class="empty-hint">No open ClickUp tasks${active === MINE ? " assigned to you" : ` for ${escapeHtml(bucketLabel(active))}`} in this team.</div>
        </div>`;
      return;
    }
    body.innerHTML = data.map(renderTask).join("");
  } catch (err) {
    if (isAuthError(err)) {
      body.innerHTML = renderWorkspaceNotConfigured("ClickUp");
    } else {
      body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
    }
  }
}
