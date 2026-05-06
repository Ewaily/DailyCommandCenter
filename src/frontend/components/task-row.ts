// Shared row renderer used by Jira Tickets, Jira Team Board, and ClickUp Tasks.
// Each card supplies a normalized shape; this module owns the visual contract
// (id column · title + colored status chip + priority badge · meta with avatar
// stack, list/project pill, due date) so both providers stay in sync.

import { escapeHtml } from "./util.js";

export type RowAssignee = { name: string; avatar: string | null; color?: string | null };

export type TaskRow = {
  key: string;                        // monospace identifier ("EPM-465", "#abc12")
  keyTitle?: string;                  // hover tooltip for the key cell
  url: string;
  title: string;
  status: string;
  statusColor: string | null;         // provider-defined hex; falls back to bucket palette
  statusBucket: "todo" | "in_progress" | "in_review" | "blocked" | "done";
  priority: "urgent" | "high" | "medium" | "low" | null;
  assignees: RowAssignee[];
  listLabel: string | null;           // ClickUp list, Jira project — tinted pill
  dueDate: string | null;
  cloneSource?: "jira" | "clickup";   // when set, renders a 1-click clone-to-Jira button
  cloneTargetProject?: string;        // target Jira project key, encoded into the button
};

const prioPalette = (p: string | null) =>
  p === "urgent" ? "urgent" : p === "high" ? "warning" : p === "medium" ? "info" : "focus";

const statusBucketPalette = (b: TaskRow["statusBucket"]) =>
  b === "blocked" ? "urgent"
  : b === "in_progress" ? "info"
  : b === "in_review" ? "warning"
  : b === "done" ? "success"
  : "focus";

function statusChip(row: TaskRow): string {
  if (row.statusColor) {
    const c = escapeHtml(row.statusColor);
    return `<span class="badge badge-task-status" style="background:${c}1f;color:${c};border:1px solid ${c}55;">${escapeHtml(row.status)}</span>`;
  }
  return `<span class="badge badge-${statusBucketPalette(row.statusBucket)}">${escapeHtml(row.status)}</span>`;
}

function avatarFor(a: RowAssignee): string {
  if (a.avatar) {
    return `<img class="task-avatar" src="${escapeHtml(a.avatar)}" alt="${escapeHtml(a.name)}" title="${escapeHtml(a.name)}" />`;
  }
  const initials = a.name
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(s => s[0]?.toUpperCase() || "")
    .join("") || "?";
  const bg = a.color || "#7B68EE";
  return `<span class="task-avatar task-avatar-fallback" style="background:${escapeHtml(bg)};" title="${escapeHtml(a.name)}">${escapeHtml(initials)}</span>`;
}

function renderAssignees(list: RowAssignee[]): string {
  if (!list.length) return "";
  const visible = list.slice(0, 3);
  const rest = list.length - visible.length;
  const stack = visible.map(avatarFor).join("");
  const overflow = rest > 0
    ? `<span class="task-avatar task-avatar-more" title="${escapeHtml(list.slice(3).map(a => a.name).join(", "))}">+${rest}</span>`
    : "";
  const primaryName = visible[0].name;
  const tail = list.length > 1 ? ` <span class="muted">+${list.length - 1}</span>` : "";
  return `<span class="task-assignees"><span class="task-avatar-stack">${stack}${overflow}</span><span class="task-assignee-name">${escapeHtml(primaryName)}${tail}</span></span>`;
}

function fmtDue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `due ${iso}`;
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0)  return `${-days}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days <= 7) return `due in ${days}d`;
  return `due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function renderTaskRow(row: TaskRow): string {
  const prio = row.priority
    ? `<span class="badge badge-${prioPalette(row.priority)}">${escapeHtml(row.priority)}</span>`
    : "";
  const dueText = fmtDue(row.dueDate);
  const overdue = !!row.dueDate && new Date(row.dueDate).getTime() < Date.now();
  const meta: string[] = [];
  if (row.assignees.length) meta.push(renderAssignees(row.assignees));
  if (row.listLabel)        meta.push(`<span class="task-list-pill">${escapeHtml(row.listLabel)}</span>`);
  if (dueText)              meta.push(`<span style="${overdue ? "color:var(--urgent);font-weight:600;" : ""}">${escapeHtml(dueText)}</span>`);
  const metaRow = meta.length
    ? `<div class="schedule-meta">${meta.join('<span class="meta-sep">·</span>')}</div>`
    : "";
  const keyTitle = row.keyTitle ? ` title="${escapeHtml(row.keyTitle)}"` : "";
  const cloneBtn = row.cloneSource
    ? `<button class="clone-to-jira-btn" title="Clone to Jira"
         data-clone-title="${escapeHtml(row.title)}"
         data-clone-url="${escapeHtml(row.url)}"
         data-clone-source="${escapeHtml(row.cloneSource)}"
         data-target-project="${escapeHtml(row.cloneTargetProject || "")}"
         aria-label="Clone to Jira">
         <span data-icon="copy"></span>
       </button>`
    : "";
  return `
    <div class="schedule-item${row.cloneSource ? " schedule-item--cloneable" : ""}">
      <div class="schedule-time item-key"${keyTitle}>${escapeHtml(row.key)}</div>
      <div class="schedule-content">
        <div class="schedule-title-row">
          <a href="${escapeHtml(row.url)}" target="_blank" class="schedule-title">${escapeHtml(row.title)}</a>
          ${statusChip(row)}${prio}
        </div>
        ${metaRow}
      </div>
      ${cloneBtn}
    </div>`;
}
