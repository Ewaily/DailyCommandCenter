// Per-instance dashboard cards.
//
// When the active scope (Overview or a specific workspace) has N > 1 usable
// connectors of the same capability, this module hides the merged static card
// and renders N separate cards — one per connector instance — each carrying
// its own tab state, counts, and isolated data fetches scoped via
// `?connectorId=`. Adding support for a NEW connector type does NOT require
// touching anything in this file: register a new `CapabilitySpec` in
// `instance-card-registry.ts` and the rendering pipeline below picks it up
// automatically.
import { type ConnectorInstance } from "../api.js";
import { getLoadedConnectors } from "../connectors.js";
import { escapeHtml, skeletonCompact } from "./util.js";
import { placeDynamicItem, unregisterDynamicItems, triggerRepack, findSlotForBox, getSavedDynamicBox, pruneDynamicStore, boxCollidesWithLayout, ensureLayoutLoaded } from "./dashboard.js";
import { paintIcons } from "./icons.js";
import { getCustomTitleForScope } from "./widget-titles.js";
import { getSetting } from "../state.js";
import { CAPABILITIES, specForCap, specForType, readWatchedUsers, type CapabilitySpec } from "./instance-card-registry.js";

let injectedIds: string[] = [];

// Per-instance card state — each card owns its OWN active tab so picking
// "All Open" on one card never affects siblings. Map key is the itemId.
const cardState = new Map<string, { bucket: string }>();

export function clearOverviewWidgets(): void {
  for (const id of injectedIds) {
    document.querySelector(`[data-dashboard-item="${CSS.escape(id)}"]`)?.remove();
  }
  injectedIds = [];
  unregisterDynamicItems();
  document.querySelectorAll<HTMLElement>("[data-ov-hidden]").forEach(el => {
    el.removeAttribute("data-ov-hidden");
    el.removeAttribute("hidden");
  });
  document.body.classList.remove("has-dynamic-overview");
}

export async function initOverviewWidgets(): Promise<void> {
  clearOverviewWidgets();
  ensureLayoutLoaded();

  const connectors = getLoadedConnectors();

  // Group every usable connector by its capability via the registry. Any
  // connector type not registered is silently ignored here (it would just
  // show through its own static card if one exists).
  const byCap = new Map<string, ConnectorInstance[]>();
  for (const c of connectors) {
    const spec = specForType(c.type);
    if (!spec) continue;
    const arr = byCap.get(spec.cap) ?? [];
    arr.push(c);
    byCap.set(spec.cap, arr);
  }

  const grid = document.getElementById("dashboard-grid");
  if (!grid) return;

  type Pending = { itemId: string; conn: ConnectorInstance; spec: CapabilitySpec; card: HTMLElement };
  const pending: Pending[] = [];
  let hasDynamic = false;

  // Phase 1: hide static cards and build instance DOM (visibility:hidden).
  for (const [cap, instances] of byCap) {
    if (instances.length <= 1) continue;
    const spec = specForCap(cap);
    if (!spec) continue;
    hasDynamic = true;

    // Hide every static card whose data-dashboard-item matches this spec.
    const sel = `[data-dashboard-item="${CSS.escape(spec.staticWidgetId)}"]`;
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      el.setAttribute("hidden", "");
      el.dataset.ovHidden = "1";
    });

    for (const conn of instances) {
      const itemId       = `ov-${conn.id}`;
      const wsName       = buildSourceLabel(conn);
      const title        = resolveInstanceTitle(spec, conn);
      const activeBucket = getActiveBucket(itemId, spec, conn);

      const card = document.createElement("div");
      card.className = "card dashboard-item overview-instance-card";
      card.dataset.dashboardItem = itemId;
      card.dataset.connectorId   = conn.id;
      card.dataset.capability    = cap;
      card.style.visibility = "hidden";
      card.innerHTML = buildCardHtml(spec, conn, wsName, title, activeBucket);
      grid.appendChild(card);
      bindInstanceCardClicks(card, spec, conn);
      pending.push({ itemId, conn, spec, card });
    }
  }

  // Phase 2: BATCH placement so two cards can never claim the same cell.
  if (pending.length) {
    pruneDynamicStore(pending.map(p => p.itemId));

    for (const p of pending) {
      const dims = p.spec.defaultDims;
      const saved = getSavedDynamicBox(p.itemId);
      let chosen = saved
        ? { x: saved.x, y: saved.y, w: Math.max(saved.w, dims.minW), h: Math.max(saved.h, dims.minH) }
        : null;
      if (chosen && boxCollidesWithLayout(chosen, p.itemId)) chosen = null;
      if (!chosen) {
        const slot = findSlotForBox(dims.w, dims.h, p.itemId);
        chosen = { x: slot.x, y: slot.y, w: dims.w, h: dims.h };
      }
      placeDynamicItem(p.itemId, { ...dims, x: chosen.x, y: chosen.y, w: chosen.w, h: chosen.h });
      injectedIds.push(p.itemId);
      p.card.style.visibility = "";
      loadInstanceData(p.card, p.spec, p.conn).catch(() => {/* per-card */});
    }
  }

  if (hasDynamic) {
    document.body.classList.add("has-dynamic-overview");
    triggerRepack();
    paintIcons();
  }
}

// ────────────────────────────────────────────────────────────────────
// Tab state
// ────────────────────────────────────────────────────────────────────

function getActiveBucket(itemId: string, spec: CapabilitySpec, _conn: ConnectorInstance): string {
  const stored = cardState.get(itemId)?.bucket;
  if (stored) return stored;
  if (!spec.tabs) return "";
  // Default: mirror the static card's saved tab so first paint matches what
  // the user sees in the owning workspace.
  if (spec.tabs.settingKey) {
    const v = getSetting<string>(spec.tabs.settingKey);
    if (v) return v;
  }
  return spec.tabs.defaultBucket;
}

function setActiveBucket(itemId: string, bucket: string): void {
  cardState.set(itemId, { bucket });
}

// ────────────────────────────────────────────────────────────────────
// Labels & titles
// ────────────────────────────────────────────────────────────────────

// "Vennre · @ewaily" — keeps each card distinguishable even when a single
// workspace owns multiple connectors of the same type.
function buildSourceLabel(conn: ConnectorInstance): string {
  const owner = conn.ownerWorkspace?.name?.trim() || "";
  const acct  = (conn.identity?.account || conn.identity?.label || "").trim();
  if (owner && acct && owner.toLowerCase() !== acct.toLowerCase()) return `${owner} · ${acct}`;
  return owner || acct || "—";
}

// Inherit the owning workspace's custom title for the matching static widget,
// so a card surfaced in Overview / another workspace keeps the title its
// owner gave it.
function resolveInstanceTitle(spec: CapabilitySpec, conn: ConnectorInstance): string {
  const ownerId = conn.ownerWorkspace?.id;
  if (ownerId) {
    const owned = getCustomTitleForScope(ownerId, spec.staticWidgetId);
    if (owned) return owned;
  }
  return spec.defaultTitle;
}

// ────────────────────────────────────────────────────────────────────
// HTML
// ────────────────────────────────────────────────────────────────────

function buildCardHtml(spec: CapabilitySpec, conn: ConnectorInstance, wsName: string, title: string, activeBucket: string): string {
  const tabsHtml = renderInstanceTabs(spec, conn, activeBucket);
  return `
    <div class="card-header">
      <div class="title-row">
        <span class="title-source">${escapeHtml(wsName)}</span>
        <span class="title-text">
          <span class="title-icon" data-icon="${escapeHtml(spec.icon)}"></span>
          <span class="title-label">${escapeHtml(title)}</span>
        </span>
      </div>
      ${tabsHtml ? `<div class="tabs" data-instance-tabs>${tabsHtml}</div>` : ""}
    </div>
    <div class="card-body" data-ov-body></div>
  `;
}

function renderInstanceTabs(spec: CapabilitySpec, conn: ConnectorInstance, activeBucket: string): string {
  if (!spec.tabs) return "";
  if (spec.tabs.kind === "fixed") {
    return spec.tabs.entries.map(([id, label]) => tabButton(id, label, activeBucket)).join("");
  }
  // Dynamic — seed from the connector's saved watchedUsers config so tabs
  // render immediately at first paint, before the API response arrives.
  const watched = readWatchedUsers(conn);
  const all: Array<[string, string]> = [["mine", "Mine"], ...watched.map(w => [w.id, w.label] as [string, string])];
  return all.map(([id, label]) => tabButton(id, label, activeBucket)).join("");
}

function tabButton(id: string, label: string, active: string): string {
  const cls = id === active ? "tab active" : "tab";
  return `<button class="${cls}" data-bucket="${escapeHtml(id)}" data-tab-id="${escapeHtml(id)}">${escapeHtml(label)} <span class="tab-count" data-count-for="${escapeHtml(id)}">—</span></button>`;
}

// Re-render the dynamic tab strip from the latest response so jira/clickup
// pick up watched-user edits without a full reload.
function syncDynamicTabs(card: HTMLElement, buckets: Array<{ id: string; label: string }>, activeBucket: string): void {
  const tabsEl = card.querySelector<HTMLElement>("[data-instance-tabs]");
  if (!tabsEl) return;
  const all: Array<[string, string]> = [["mine", "Mine"], ...buckets.map(b => [b.id, b.label] as [string, string])];
  tabsEl.innerHTML = all.map(([id, label]) => tabButton(id, label, activeBucket)).join("");
}

function syncTabCounts(card: HTMLElement, counts: Record<string, number>): void {
  for (const [id, n] of Object.entries(counts)) {
    const el = card.querySelector<HTMLElement>(`[data-count-for="${CSS.escape(id)}"]`);
    if (el) el.textContent = String(n ?? 0);
  }
}

function setActiveTabUi(card: HTMLElement, activeBucket: string): void {
  card.querySelectorAll<HTMLElement>("[data-instance-tabs] .tab").forEach(b => {
    b.classList.toggle("active", b.dataset.bucket === activeBucket);
  });
}

function bindInstanceCardClicks(card: HTMLElement, spec: CapabilitySpec, conn: ConnectorInstance): void {
  const itemId = `ov-${conn.id}`;
  card.addEventListener("click", e => {
    const t = e.target as HTMLElement;
    const tab = t.closest<HTMLElement>("[data-instance-tabs] [data-bucket]");
    if (!tab || !card.contains(tab)) return;
    e.preventDefault();
    const bucket = tab.dataset.bucket || (spec.tabs?.defaultBucket ?? "mine");
    setActiveBucket(itemId, bucket);
    setActiveTabUi(card, bucket);
    loadInstanceData(card, spec, conn).catch(() => {/* per-card */});
  });
}

// ────────────────────────────────────────────────────────────────────
// Data load — fully spec-driven
// ────────────────────────────────────────────────────────────────────

async function loadInstanceData(card: HTMLElement, spec: CapabilitySpec, conn: ConnectorInstance): Promise<void> {
  const body = card.querySelector<HTMLElement>("[data-ov-body]");
  if (!body) return;
  body.innerHTML = skeletonCompact(3);
  const itemId = `ov-${conn.id}`;
  const requestedBucket = spec.tabs ? getActiveBucket(itemId, spec, conn) : null;

  try {
    const resp = await spec.fetch(conn.id, requestedBucket);
    if (resp.notConfigured) { body.innerHTML = emptyHtml("Not connected", "—"); return; }

    // Honor server bucket coercion (e.g. unknown bucket id falls back to mine).
    const effective = resp.effectiveBucket || requestedBucket || "";
    if (spec.tabs && requestedBucket && effective && effective !== requestedBucket) {
      setActiveBucket(itemId, effective);
    }
    if (resp.buckets) syncDynamicTabs(card, resp.buckets, effective);
    if (resp.counts)  syncTabCounts(card, resp.counts);
    if (spec.tabs)    setActiveTabUi(card, effective);

    if (!resp.items.length) {
      const e = spec.empty(effective);
      body.innerHTML = emptyHtml(e.emoji, e.title);
      return;
    }
    body.innerHTML = resp.items.map(item => spec.renderItem(item)).join("");
  } catch (err) {
    body.innerHTML = `<div class="error">${escapeHtml((err as Error).message)}</div>`;
  }
}

function emptyHtml(emoji: string, title: string): string {
  return `<div class="empty"><span class="emoji">${escapeHtml(emoji)}</span><div class="empty-title">${escapeHtml(title)}</div></div>`;
}

// Re-export for tests/diagnostics.
export { CAPABILITIES };
