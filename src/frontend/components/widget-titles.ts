// Inline-editable widget titles with smart workspace-prefixed defaults.
// Persists per-scope in localStorage["dcc-widget-titles-v1"].
import { getActiveWorkspaceId } from "./workspace-switcher.js";
import { getLoadedConnectors } from "../connectors.js";
import { escapeHtml } from "./util.js";
import { CAPABILITIES } from "./instance-card-registry.js";

// Static widget IDs whose custom title can be inherited from the connector's
// owning workspace when the single usable connector is shared in from
// elsewhere. Derived from the central capability registry so a new connector
// type added there is auto-covered here without a parallel edit. The
// `channels` widget shares slack's connector type but isn't in the registry,
// so it's added explicitly.
const WIDGET_ID_TO_TYPES: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = { channels: ["slack"] };
  for (const spec of CAPABILITIES) m[spec.staticWidgetId] = spec.matchTypes;
  return m;
})();

const STORAGE_KEY = "dcc-widget-titles-v1";
const OVERVIEW_KEY = "__overview__";

type TitleStore = Record<string, Record<string, string>>;

const DEFAULT_LABELS: Record<string, string> = {
  schedule: "Schedule",
  mentions: "Mentions & DMs",
  prs: "Pull Requests",
  tickets: "Tickets",
  clickup: "Tasks",
  channels: "Channel Digest",
};

function scopeKey(): string {
  return getActiveWorkspaceId() ?? OVERVIEW_KEY;
}

function readStore(): TitleStore {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as TitleStore; }
  catch { return {}; }
}

function writeStore(store: TitleStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function getCustomTitle(widgetId: string): string | null {
  return readStore()[scopeKey()]?.[widgetId] ?? null;
}

// Read a custom title from a specific scope (workspace id, or OVERVIEW_KEY).
// Used when a connector is rendered outside its owning workspace so it can
// keep the title its owner gave it (e.g. shared connectors surfaced in
// Overview or in another workspace via per-instance cards).
export function getCustomTitleForScope(scopeId: string, widgetId: string): string | null {
  return readStore()[scopeId]?.[widgetId] ?? null;
}

export function setCustomTitle(widgetId: string, title: string): void {
  const store = readStore();
  const scope = scopeKey();
  if (!store[scope]) store[scope] = {};
  if (title.trim()) {
    store[scope][widgetId] = title.trim();
  } else {
    delete store[scope][widgetId];
  }
  writeStore(store);
}

export function getEffectiveTitle(widgetId: string, workspaceName?: string): string {
  // 1. Local customization (this scope) wins.
  const custom = getCustomTitle(widgetId);
  if (custom) return custom;

  // 2. Otherwise, if this widget is being driven by a single shared/foreign
  //    connector, inherit the title its owner workspace gave it.
  const inherited = inheritedTitleForStatic(widgetId);
  if (inherited) return inherited;

  const base = DEFAULT_LABELS[widgetId] || widgetId;
  if (workspaceName) return `${workspaceName} – ${base}`;
  return base;
}

function inheritedTitleForStatic(widgetId: string): string | null {
  const types = WIDGET_ID_TO_TYPES[widgetId];
  if (!types) return null;
  const matches = getLoadedConnectors().filter(c => types.includes(c.type));
  if (matches.length !== 1) return null;
  const ownerId = matches[0].ownerWorkspace?.id;
  const activeId = getActiveWorkspaceId();
  if (!ownerId || ownerId === activeId) return null;
  return getCustomTitleForScope(ownerId, widgetId);
}

// Re-render the text portion of every .title-text in the dashboard.
// workspaceName is the name of the currently-active workspace (undefined = Overview).
export function applyTitles(workspaceName?: string): void {
  document.querySelectorAll<HTMLElement>("[data-dashboard-item]").forEach(card => {
    if (card.classList.contains("overview-instance-card")) return;
    const widgetId = card.dataset.dashboardItem!;
    const titleEl = card.querySelector<HTMLElement>(".title-text");
    if (!titleEl) return;
    const icon = titleEl.querySelector<HTMLElement>(".title-icon");
    const pencil = titleEl.querySelector<HTMLElement>(".title-edit-btn");
    const label = titleEl.querySelector<HTMLElement>(".title-label");
    const title = getEffectiveTitle(widgetId, workspaceName);
    if (label) {
      label.textContent = title;
    } else {
      // First call: rebuild the span structure
      titleEl.innerHTML = "";
      if (icon) titleEl.appendChild(icon);
      const textSpan = document.createElement("span");
      textSpan.className = "title-label";
      textSpan.textContent = title;
      titleEl.appendChild(textSpan);
      if (pencil) titleEl.appendChild(pencil);
    }
  });
}

// Wire up hover-pencil + click-to-edit on all widget title-text spans.
// Safe to call multiple times (idempotent via .title-edit-btn presence check).
export function initInlineEditing(): void {
  document.querySelectorAll<HTMLElement>("[data-dashboard-item] .title-text").forEach(titleEl => {
    if (titleEl.closest(".overview-instance-card")) return;
    if (titleEl.querySelector(".title-edit-btn")) return;

    const pencil = document.createElement("button");
    pencil.className = "title-edit-btn";
    pencil.setAttribute("aria-label", "Edit widget title");
    pencil.title = "Edit title";
    pencil.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5l2.5 2.5-8 8H3v-2.5l8-8z"/><path d="M9.5 4l2.5 2.5"/></svg>`;
    titleEl.appendChild(pencil);

    pencil.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      startEdit(titleEl);
    });

    // Clicking the label text itself also starts an edit
    titleEl.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".title-edit-btn")) return;
      if (titleEl.classList.contains("is-editing")) return;
      startEdit(titleEl);
    });
  });
}

function startEdit(titleEl: HTMLElement): void {
  const card = titleEl.closest<HTMLElement>("[data-dashboard-item]");
  if (!card) return;
  const widgetId = card.dataset.dashboardItem!;
  if (titleEl.classList.contains("is-editing")) return;

  const labelEl = titleEl.querySelector<HTMLElement>(".title-label");
  if (!labelEl) return;
  const current = labelEl.textContent || "";

  titleEl.classList.add("is-editing");

  const input = document.createElement("input");
  input.className = "title-edit-input";
  input.type = "text";
  input.value = current;
  input.setAttribute("aria-label", "Widget title");
  input.setAttribute("maxlength", "80");
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  function commit(): void {
    const newTitle = input.value.trim();
    setCustomTitle(widgetId, newTitle);
    titleEl.classList.remove("is-editing");
    const span = document.createElement("span");
    span.className = "title-label";
    span.textContent = newTitle || getEffectiveTitle(widgetId);
    input.replaceWith(span);
  }

  input.addEventListener("blur", commit, { once: true });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") { input.value = current; commit(); }
  });
}

// Escape the title for safe use as an HTML attribute.
export { escapeHtml };
