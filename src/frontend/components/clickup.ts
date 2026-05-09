import { api, isAuthError, type ClickUpTask, type WatchedUser } from "../api.js";
import { $, escapeHtml, renderWorkspaceNotConfigured, skeletonCompact, toast, confirmModal, errorModal, cloneSuccessModal, animateNumber } from "./util.js";
import { saveSetting, getSetting } from "../state.js";
import { renderTaskRow, maybeShowCloneHint } from "./task-row.js";
import { hasCapability } from "../connectors.js";

export interface ClickUpInstance {
  load(silent?: boolean): Promise<void>;
}

const MINE = "mine";

let watchedUsers: WatchedUser[] = [];
let active: string = getSetting<string>("clickupTab") || MINE;

async function handleClone(btn: HTMLElement): Promise<void> {
  try {
    const connectorId = btn.dataset.connectorId || "";
    const project     = btn.dataset.targetProject || "";
    if (!connectorId || !project) {
      errorModal({
        title: "Cloning not configured",
        detail: "Go to Settings → Workspaces → expand this ClickUp connector card → '1-Click Cloning to Jira' and fill in Target Base URL, Email, API Token, and Project.",
      });
      return;
    }
    const title = btn.dataset.cloneTitle || "(untitled)";
    const url   = btn.dataset.cloneUrl   || "";

    const truncated = title.length > 60 ? title.slice(0, 57) + "…" : title;
    const confirmed = await confirmModal({
      title: "Clone to Jira?",
      body: `<strong>${escapeHtml(truncated)}</strong><br><span style="font-size:var(--fs-sm);color:var(--text-muted)">will be created as a new Task in project <code>${escapeHtml(project)}</code></span>`,
      confirmLabel: "Clone",
    });
    if (!confirmed) return;

    const dismiss = toast("Cloning…", { type: "info", duration: 20_000 });
    try {
      const resp = await api.cloneTicket({ sourceProvider: "clickup", title, originalLink: url, connectorId });
      dismiss?.();
      cloneSuccessModal({ key: resp.data.key, url: resp.data.url });
      markClonedRow(url, resp.data.key, resp.data.url);
    } catch (apiErr: any) {
      dismiss?.();
      errorModal({ title: "Clone failed", detail: apiErr.message ?? String(apiErr) });
    }
  } catch (unexpected: any) {
    errorModal({ title: "Unexpected error", detail: unexpected?.message ?? String(unexpected) });
  }
}

function markClonedRow(sourceUrl: string, clonedKey: string, clonedUrl: string) {
  document.querySelectorAll<HTMLElement>(`[data-clone-url="${CSS.escape(sourceUrl)}"]`).forEach(btn => {
    const row = btn.closest<HTMLElement>(".schedule-item");
    if (!row) return;
    btn.remove();
    const badge = document.createElement("a");
    badge.className = "cloned-badge";
    badge.href = clonedUrl;
    badge.target = "_blank";
    badge.rel = "noopener";
    badge.textContent = clonedKey;
    row.appendChild(badge);
    row.classList.add("is-cloned");
  });
}

function renderTask(t: ClickUpTask, cloningEnabled = false, targetProject = "", connectorId = ""): string {
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
    cloneSource: cloningEnabled ? "clickup" : undefined,
    cloneTargetProject: cloningEnabled ? targetProject : undefined,
    cloneConnectorId: cloningEnabled ? connectorId : undefined,
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

export function bindClickUpClone() {
  const body = $("#clickup-body");
  body?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".clone-to-jira-btn");
    if (btn) { e.preventDefault(); handleClone(btn).catch(err => errorModal({ title: "Unexpected error", detail: String(err) })); }
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
      if (!hasCapability("jira")) {
        const k = $("#kpi-tickets"); if (k) k.textContent = "—";
        const d = $("#kpi-tickets-detail"); if (d) d.textContent = "Not connected";
      }
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

    // Write the ticket KPI only when Jira isn't present — Jira owns it when both are active.
    if (!hasCapability("jira")) {
      const mineCount = resp.counts?.[MINE] ?? 0;
      animateNumber($("#kpi-tickets"), mineCount);
      const detail = $("#kpi-tickets-detail");
      if (detail) {
        const parts: string[] = [`${mineCount} mine`];
        for (const w of watchedUsers) parts.push(`${resp.counts?.[w.id] ?? 0} ${w.label}`);
        detail.textContent = parts.join(" · ");
      }
    }

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
    const cc = resp.connectorCloningConfig ?? { cloningEnabled: false, cloneTargetProject: "", connectorId: undefined };
    body.innerHTML = data.map(t => renderTask(t, cc.cloningEnabled, cc.cloneTargetProject, cc.connectorId)).join("");
    applyCloneHistory(body);
    maybeShowCloneHint(body);
  } catch (err) {
    if (isAuthError(err)) {
      body.innerHTML = renderWorkspaceNotConfigured("ClickUp");
    } else {
      body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
    }
  }
}

async function applyCloneHistory(container: HTMLElement) {
  try {
    const resp = await api.cloneHistory();
    const history = resp.data ?? {};
    for (const [sourceUrl, info] of Object.entries(history)) {
      container.querySelectorAll<HTMLElement>(`[data-clone-url="${CSS.escape(sourceUrl)}"]`).forEach(btn => {
        const row = btn.closest<HTMLElement>(".schedule-item");
        if (!row || row.classList.contains("is-cloned")) return;
        btn.remove();
        const badge = document.createElement("a");
        badge.className = "cloned-badge";
        badge.href = info.url;
        badge.target = "_blank";
        badge.rel = "noopener";
        badge.textContent = info.key;
        badge.title = `Previously cloned as ${info.key}`;
        row.appendChild(badge);
        row.classList.add("is-cloned");
      });
    }
  } catch { /* best-effort */ }
}

export function instantiateClickUp(
  container: HTMLElement,
  connectorId: string,
  opts: { wsName: string; title: string }
): ClickUpInstance {
  const { wsName, title } = opts;
  let activeBucket: string = getSetting<string>("clickupTab") || MINE;
  let localWatched: WatchedUser[] = [];

  container.innerHTML = `
    <div class="card-header">
      <div class="title-row">
        <span class="title-source">${escapeHtml(wsName)}</span>
        <span class="title-text">
          <span class="title-icon" data-icon="check"></span>
          <span>${escapeHtml(title)}</span>
        </span>
      </div>
      <div class="tabs" data-ov-tabs></div>
    </div>
    <div class="card-body" data-ov-body></div>
  `;

  const body = container.querySelector<HTMLElement>("[data-ov-body]")!;
  const tabsEl = container.querySelector<HTMLElement>("[data-ov-tabs]");

  body.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>(".clone-to-jira-btn");
    if (btn) { e.preventDefault(); handleClone(btn).catch(err => errorModal({ title: "Unexpected error", detail: String(err) })); }
  });

  function bucketIdsLocal() { return [MINE, ...localWatched.map(w => w.id)]; }
  function bucketLabelLocal(id: string) {
    if (id === MINE) return "Mine";
    return localWatched.find(w => w.id === id)?.label || id;
  }

  function renderTabsLocal(counts?: Record<string, number>) {
    if (!tabsEl) return;
    if (bucketIdsLocal().length <= 1) { tabsEl.innerHTML = ""; return; }
    tabsEl.innerHTML = bucketIdsLocal().map(id => {
      const cls = id === activeBucket ? "tab active" : "tab";
      const count = counts?.[id] ?? "—";
      return `<button class="${cls}" data-ov-bucket="${escapeHtml(id)}">${escapeHtml(bucketLabelLocal(id))} <span class="tab-count">${count}</span></button>`;
    }).join("");
    tabsEl.querySelectorAll<HTMLElement>("[data-ov-bucket]").forEach(b => {
      b.addEventListener("click", () => {
        activeBucket = b.dataset.ovBucket || MINE;
        saveSetting("clickupTab", activeBucket);
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

  async function load(silent = false): Promise<void> {
    if (!silent) body.innerHTML = skeletonCompact(3);
    try {
      const resp = await api.clickupTasks(activeBucket, connectorId);
      if (resp.notConfigured) {
        body.innerHTML = renderWorkspaceNotConfigured("ClickUp");
        return;
      }
      localWatched = resp.buckets ?? [];
      if (!bucketIdsLocal().includes(activeBucket)) {
        activeBucket = MINE;
        saveSetting("clickupTab", activeBucket);
      }
      renderTabsLocal(resp.counts);
      syncTabUILocal();
      const data = resp.data || [];
      if (!data.length) {
        body.innerHTML = `
          <div class="empty">
            <span class="empty-icon" data-icon="check"></span>
            <div class="empty-title">All caught up</div>
            <div class="empty-hint">No open ClickUp tasks${activeBucket === MINE ? " assigned to you" : ` for ${escapeHtml(bucketLabelLocal(activeBucket))}`} in this team.</div>
          </div>`;
        return;
      }
      const cc = resp.connectorCloningConfig ?? { cloningEnabled: false, cloneTargetProject: "", connectorId: undefined };
      body.innerHTML = data.map(t => renderTask(t, cc.cloningEnabled, cc.cloneTargetProject, cc.connectorId)).join("");
      applyCloneHistory(body);
      maybeShowCloneHint(body);
    } catch (err) {
      if (isAuthError(err)) {
        body.innerHTML = renderWorkspaceNotConfigured("ClickUp");
      } else {
        body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
      }
    }
  }

  return { load };
}
