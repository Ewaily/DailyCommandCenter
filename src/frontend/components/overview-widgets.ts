// Per-instance dashboard cards.
//
// When the active scope (Overview or a specific workspace) has N > 1 usable
// connectors of the same capability, this module hides the merged static card
// and renders N separate cards — one per connector instance — each mounting the
// EXACT SAME top-level widget component used by the workspace card. This
// guarantees 100% UI parity: filters, pagination, tabs, and all header controls
// are identical in Overview mode and Workspace mode.
//
// Adding support for a NEW connector type does NOT require touching this file:
// register a new `CapabilitySpec` in `instance-card-registry.ts` AND add the
// corresponding `instantiate*` factory to MOUNTERS below.
import { type ConnectorInstance } from "../api.js";
import { getLoadedConnectors } from "../connectors.js";
import { placeDynamicItem, unregisterDynamicItems, triggerRepack, findSlotForBox, getSavedDynamicBox, pruneDynamicStore, boxCollidesWithLayout, ensureLayoutLoaded } from "./dashboard.js";
import { paintIcons } from "./icons.js";
import { getCustomTitleForScope } from "./widget-titles.js";
import { CAPABILITIES, specForCap, specForType, type CapabilitySpec } from "./instance-card-registry.js";
import { instantiateSchedule } from "./schedule.js";
import { instantiatePRs } from "./prs.js";
import { instantiateTickets } from "./tickets.js";
import { instantiateClickUp } from "./clickup.js";
import { instantiateMentions } from "./mentions.js";

let injectedIds: string[] = [];

// Map capability → widget factory. Each factory renders the full widget UI
// (header controls, filters, tabs, body) into the container and returns a
// load() method. This is the ONLY place Overview cards diverge from workspace
// cards — they receive a connectorId so data fetches are scoped.
type Mounter = (
  container: HTMLElement,
  connectorId: string,
  opts: { wsName: string; title: string }
) => { load(silent?: boolean): Promise<void> };

const MOUNTERS = new Map<string, Mounter>([
  ["calendar", (c, id, opts) => instantiateSchedule(c, id, opts)],
  ["github",   (c, id, opts) => instantiatePRs(c, id, opts)],
  ["jira",     (c, id, opts) => instantiateTickets(c, id, opts)],
  ["clickup",  (c, id, opts) => instantiateClickUp(c, id, opts)],
  ["slack",    (c, id, opts) => instantiateMentions(c, id, opts)],
]);

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

  // Group every usable connector by its capability via the registry.
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

  type Pending = {
    itemId: string;
    conn: ConnectorInstance;
    spec: CapabilitySpec;
    card: HTMLElement;
    instance: { load(silent?: boolean): Promise<void> } | null;
  };
  const pending: Pending[] = [];
  let hasDynamic = false;

  // Phase 1: hide static cards and build instance DOM (visibility:hidden).
  for (const [cap, instances] of byCap) {
    if (instances.length <= 1) continue;
    const spec = specForCap(cap);
    if (!spec) continue;
    hasDynamic = true;

    const sel = `[data-dashboard-item="${CSS.escape(spec.staticWidgetId)}"]`;
    document.querySelectorAll<HTMLElement>(sel).forEach(el => {
      el.setAttribute("hidden", "");
      el.dataset.ovHidden = "1";
    });

    const mounter = MOUNTERS.get(cap);

    for (const conn of instances) {
      const itemId  = `ov-${conn.id}`;
      const wsName  = buildSourceLabel(conn);
      const title   = resolveInstanceTitle(spec, conn);

      const card = document.createElement("div");
      card.className = "card dashboard-item overview-instance-card";
      card.dataset.dashboardItem = itemId;
      card.dataset.connectorId   = conn.id;
      card.dataset.capability    = cap;
      card.style.visibility = "hidden";
      grid.appendChild(card);

      let instance: { load(silent?: boolean): Promise<void> } | null = null;
      if (mounter) {
        // Mount the full widget component — identical UI to the workspace card.
        instance = mounter(card, conn.id, { wsName, title });
      }

      pending.push({ itemId, conn, spec, card, instance });
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
      if (p.instance) {
        p.instance.load().catch(() => {/* per-card error is rendered in-body */});
      }
    }
  }

  if (hasDynamic) {
    document.body.classList.add("has-dynamic-overview");
    triggerRepack();
    paintIcons();
  }
}

// ────────────────────────────────────────────────────────────────────
// Labels & titles
// ────────────────────────────────────────────────────────────────────

function buildSourceLabel(conn: ConnectorInstance): string {
  const owner = conn.ownerWorkspace?.name?.trim() || "";
  const acct  = (conn.identity?.account || conn.identity?.label || "").trim();
  if (owner && acct && owner.toLowerCase() !== acct.toLowerCase()) return `${owner} · ${acct}`;
  return owner || acct || "—";
}

function resolveInstanceTitle(spec: CapabilitySpec, conn: ConnectorInstance): string {
  const ownerId = conn.ownerWorkspace?.id;
  if (ownerId) {
    const owned = getCustomTitleForScope(ownerId, spec.staticWidgetId);
    if (owned) return owned;
  }
  return spec.defaultTitle;
}

// Re-export for tests/diagnostics.
export { CAPABILITIES };
