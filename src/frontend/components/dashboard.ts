// Dashboard layout engine — vanilla TS, CSS-Grid based.
// Each .dashboard-item lives at {x, y, w, h} on a 12-col grid.
// Edit mode unlocks drag-to-move (header) and drag-to-resize (handles).
import { initTabDrag, applyTabOrder, resetTabOrder, TAB_ORDER_KEY } from "./tab-drag.js";
import { getActiveWorkspaceId } from "./workspace-switcher.js";

const GRID_COLS = 12;
const ROW_PX = 30;
const STORAGE_KEY = "dcc-dashboard-layout-v2";   // v2: keyed by workspace
const LEGACY_KEY  = "dcc-dashboard-layout-v1";   // single-blob predecessor
const DYNAMIC_STORAGE_KEY = "dcc-dashboard-dynamic-v1"; // per-instance overview items
const OVERVIEW_KEY = "__overview__";
const EDIT_KEY = "dcc-dashboard-edit";

function scopeKey(): string {
  return getActiveWorkspaceId() ?? OVERVIEW_KEY;
}

export type ItemId = string;

interface Box { x: number; y: number; w: number; h: number; }
interface Item extends Box { id: ItemId; minW: number; minH: number; }

type StaticItemId = "schedule" | "mentions" | "prs" | "tickets" | "clickup" | "channels";

const DEFAULT_LAYOUT: Record<StaticItemId, Item> = {
  schedule: { id: "schedule", x: 0, y: 0,  w: 5, h: 15, minW: 3, minH: 6 },
  mentions: { id: "mentions", x: 5, y: 0,  w: 4, h: 15, minW: 3, minH: 6 },
  prs:      { id: "prs",      x: 9, y: 0,  w: 3, h: 5,  minW: 2, minH: 4 },
  tickets:  { id: "tickets",  x: 9, y: 5,  w: 3, h: 5,  minW: 2, minH: 4 },
  clickup:  { id: "clickup",  x: 9, y: 10, w: 3, h: 5,  minW: 2, minH: 4 },
  channels: { id: "channels", x: 0, y: 15, w: 12, h: 11, minW: 4, minH: 5 },
};

let layout: Record<string, Item> = structuredClone(DEFAULT_LAYOUT);
let editing = false;

// ────────────────────────────────────────────────────────────────────
// Persistence
// ────────────────────────────────────────────────────────────────────

type Slice = Record<string, Box>;
type StoreV2 = Record<string, Slice>;

function readStore(): StoreV2 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoreV2;
  } catch { /* corrupt blob → defaults */ }
  // One-time migration: a pre-v2 single-blob layout becomes the current scope's slice.
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const slice = JSON.parse(legacy) as Slice;
      const seeded: StoreV2 = { [scopeKey()]: slice };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      localStorage.removeItem(LEGACY_KEY);
      return seeded;
    }
  } catch { /* ignore */ }
  return {};
}

function writeStore(store: StoreV2): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function readDynamicStore(): StoreV2 {
  try {
    const raw = localStorage.getItem(DYNAMIC_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StoreV2;
  } catch { /* corrupt */ }
  return {};
}

function writeDynamicStore(store: StoreV2): void {
  localStorage.setItem(DYNAMIC_STORAGE_KEY, JSON.stringify(store));
}

let loadedScope: string | null = null;

// Idempotent per-scope — callable from anywhere that needs the saved static
// layout in memory before performing collision checks (e.g. per-instance
// overview cards being placed before dashboard.init() runs, or on workspace
// switch before initOverviewWidgets re-runs for the new scope).
export function ensureLayoutLoaded(): void {
  const scope = scopeKey();
  if (loadedScope === scope) return;
  load();
  loadedScope = scope;
}

function load(): void {
  // Reset to defaults first so a previous workspace's customizations don't leak
  // into a workspace that has never been customized.
  layout = structuredClone(DEFAULT_LAYOUT);
  const slice = readStore()[scopeKey()];
  if (!slice) return;
  for (const id of Object.keys(DEFAULT_LAYOUT)) {
    const saved = slice[id];
    if (!saved) continue;
    layout[id] = {
      ...layout[id],
      x: clampInt(saved.x, 0, GRID_COLS - 1),
      y: Math.max(0, Math.floor(saved.y)),
      w: clampInt(saved.w, layout[id].minW, GRID_COLS),
      h: Math.max(layout[id].minH, Math.floor(saved.h)),
    };
  }
}

function save(): void {
  const staticKeys = new Set(Object.keys(DEFAULT_LAYOUT));
  const slice: Slice = {};
  const dynamicSlice: Slice = {};
  for (const id of Object.keys(layout)) {
    const { x, y, w, h } = layout[id];
    if (staticKeys.has(id)) slice[id] = { x, y, w, h };
    else dynamicSlice[id] = { x, y, w, h };
  }
  const store = readStore();
  store[scopeKey()] = slice;
  writeStore(store);
  if (Object.keys(dynamicSlice).length) {
    const dynStore = readDynamicStore();
    dynStore[scopeKey()] = { ...(dynStore[scopeKey()] ?? {}), ...dynamicSlice };
    writeDynamicStore(dynStore);
  }
}

export function registerDynamicItem(id: string, box: { x: number; y: number; w: number; h: number; minW: number; minH: number }): void {
  if (layout[id]) return;
  layout[id] = { id, ...box };
  const saved = readDynamicStore()[scopeKey()]?.[id];
  if (saved) {
    layout[id] = {
      ...layout[id],
      x: clampInt(saved.x, 0, GRID_COLS - 1),
      y: Math.max(0, Math.floor(saved.y)),
      w: clampInt(saved.w, box.minW, GRID_COLS),
      h: Math.max(box.minH, Math.floor(saved.h)),
    };
  }
  applyOne(id);
}

// Place a per-instance dynamic item at the EXACT coords supplied — no
// saved-store override. Per-instance cards must come from a single batch
// placement pass that already computed non-overlapping slots; pulling stale
// coords back in would defeat that and cause the "two cards in one cell"
// stacking bug. User drags still persist via the normal save() path and are
// honored because we'd pre-seed the batch from those saved positions.
export function placeDynamicItem(id: string, box: { x: number; y: number; w: number; h: number; minW: number; minH: number }): void {
  layout[id] = { id, ...box };
  applyOne(id);
}

export function getSavedDynamicBox(id: string): { x: number; y: number; w: number; h: number } | null {
  const slice = readDynamicStore()[scopeKey()];
  return slice?.[id] ?? null;
}

// Drop any persisted dynamic positions whose ids are no longer live.
// Prevents zombie entries (deleted connectors, renamed instance ids) from
// ever coming back as collisions in a future placement pass.
export function pruneDynamicStore(liveIds: string[]): void {
  const store = readDynamicStore();
  const slice = store[scopeKey()];
  if (!slice) return;
  const live = new Set(liveIds);
  let changed = false;
  for (const id of Object.keys(slice)) {
    if (!live.has(id)) { delete slice[id]; changed = true; }
  }
  if (changed) {
    store[scopeKey()] = slice;
    writeDynamicStore(store);
  }
}

export function unregisterDynamicItems(): void {
  const staticKeys = new Set(Object.keys(DEFAULT_LAYOUT));
  for (const id of Object.keys(layout)) {
    if (!staticKeys.has(id)) delete layout[id];
  }
}

export function triggerRepack(): void {
  if (repackVisible()) { applyAll(); save(); }
}

// Find a free {x,y} for a box of size w×h that doesn't collide with any
// currently-visible (non-`hidden`) layout item. Used by dynamic per-instance
// cards so they flow into open space rather than landing on a fixed column.
export function findSlotForBox(w: number, h: number, excludeId?: string): { x: number; y: number } {
  return findFreeSlot(w, h, occupiedBoxes(excludeId));
}

// Returns true if the supplied box collides with any visible layout item
// other than `excludeId`. Authoritative collision check sourced from the
// in-memory layout map, not the DOM — this works even before dashboard.init()
// has painted inline grid styles on the static cards.
export function boxCollidesWithLayout(box: { x: number; y: number; w: number; h: number }, excludeId?: string): boolean {
  return occupiedBoxes(excludeId).some(o => collides(box, o));
}

function occupiedBoxes(excludeId?: string): Box[] {
  return getVisibleItemIds()
    .filter(id => id !== excludeId)
    .map(id => {
      const it = layout[id];
      return { x: it.x, y: it.y, w: it.w, h: it.h };
    });
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(v)));
}

// ────────────────────────────────────────────────────────────────────
// Apply layout to DOM
// ────────────────────────────────────────────────────────────────────

function applyAll(): void {
  for (const id of Object.keys(layout)) applyOne(id);
}

function applyOne(id: string): void {
  const el = document.querySelector<HTMLElement>(`[data-dashboard-item="${CSS.escape(id)}"]`);
  if (!el) return;
  const it = layout[id];
  el.style.gridColumn = `${it.x + 1} / span ${it.w}`;
  el.style.gridRow    = `${it.y + 1} / span ${it.h}`;
}

// ────────────────────────────────────────────────────────────────────
// Edit mode
// ────────────────────────────────────────────────────────────────────

export function isEditing(): boolean { return editing; }

export function setEditing(on: boolean): void {
  // If exiting while a drag is in flight, commit whatever was dragged so far.
  if (!on && drag) onPointerUp();

  editing = on;
  document.body.classList.toggle("dashboard-editing", editing);
  const grid = document.getElementById("dashboard-grid");
  grid?.classList.toggle("is-editing", editing);
  document.getElementById("dashboard-edit-toolbar")?.toggleAttribute("hidden", !editing);
  const btn = document.getElementById("customize-btn");
  btn?.classList.toggle("active", editing);
  const lbl = document.getElementById("customize-btn-label");
  if (lbl) lbl.textContent = editing ? "Done" : "Customize";
  ensureHandles();
  localStorage.setItem(EDIT_KEY, editing ? "1" : "0");
}

export function toggleEditing(): void { setEditing(!editing); }

export function resetLayout(): void {
  unregisterDynamicItems();
  layout = structuredClone(DEFAULT_LAYOUT);
  save();
  applyAll();
  // After reset, hidden widgets free up space — repack so visible widgets
  // collapse into the freed slots without overlap.
  repackVisible();
  applyAll();
  save();
  // Also reset tab orders.
  localStorage.removeItem(TAB_ORDER_KEY);
}

// ────────────────────────────────────────────────────────────────────
// Drag/resize handles — added once when entering edit mode, removed when leaving.
// ────────────────────────────────────────────────────────────────────

function ensureHandles(): void {
  document.querySelectorAll<HTMLElement>(".dashboard-item").forEach(el => {
    el.querySelectorAll(".dash-resize, .dash-move").forEach(n => n.remove());
    if (!editing) return;
    const handles: Array<["e" | "s" | "se" | "n" | "w" | "sw" | "ne" | "nw", string]> = [
      ["e",  "dash-resize dash-resize-e"],
      ["s",  "dash-resize dash-resize-s"],
      ["se", "dash-resize dash-resize-se"],
      ["w",  "dash-resize dash-resize-w"],
      ["sw", "dash-resize dash-resize-sw"],
    ];
    for (const [dir, cls] of handles) {
      const h = document.createElement("div");
      h.className = cls;
      h.dataset.dir = dir;
      el.appendChild(h);
    }
  });
}

// ────────────────────────────────────────────────────────────────────
// Pointer-driven drag & resize
// ────────────────────────────────────────────────────────────────────

interface DragState {
  id: ItemId;
  mode: "move" | "resize";
  dir?: string;
  startPx: { x: number; y: number };
  startBox: Box;
  cellW: number;
  cellH: number;
  ghost: HTMLElement;
}

let drag: DragState | null = null;

// ────────────────────────────────────────────────────────────────────
// Collision detection & smart auto-placement
// ────────────────────────────────────────────────────────────────────

function collides(a: Box, b: Box): boolean {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

// Scan top→bottom, left→right for the first slot that fits a w×h box without
// overlapping any item in `occupied`. The grid is unbounded vertically; the
// 500-row cap is just a safety net.
function findFreeSlot(w: number, h: number, occupied: Box[]): { x: number; y: number } {
  const width = Math.min(w, GRID_COLS);
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x <= GRID_COLS - width; x++) {
      const candidate: Box = { x, y, w: width, h };
      if (!occupied.some(o => collides(candidate, o))) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function getVisibleItemIds(): ItemId[] {
  return Object.keys(layout).filter(id => {
    const el = document.querySelector<HTMLElement>(`[data-dashboard-item="${CSS.escape(id)}"]`);
    return !!el && !el.hasAttribute("hidden");
  });
}

// Resolve overlaps among currently-visible items. `priority` (e.g. the just-
// dropped item) is pinned to its current position; everything else either
// keeps its spot or, if it overlaps a pinned/earlier item, slides into the
// next free slot.
function repackVisible(priority?: ItemId): boolean {
  const visible = getVisibleItemIds();
  const ordered = priority
    ? [priority, ...visible.filter(id => id !== priority)]
    : [...visible].sort((a, b) =>
        (layout[a].y - layout[b].y) || (layout[a].x - layout[b].x));

  const fixed: Box[] = [];
  let changed = false;

  for (const id of ordered) {
    const it = layout[id];
    const here: Box = { x: it.x, y: it.y, w: it.w, h: it.h };
    const overlaps = fixed.some(f => collides(here, f));
    // Enforce minimum dimensions in case a saved size slipped below the min.
    const safeW = Math.max(it.w, it.minW);
    const safeH = Math.max(it.h, it.minH);
    if (!overlaps || id === priority) {
      if (safeW !== it.w || safeH !== it.h) {
        layout[id] = { ...it, w: safeW, h: safeH };
        changed = true;
      }
      fixed.push({ x: it.x, y: it.y, w: safeW, h: safeH });
    } else {
      const slot = findFreeSlot(safeW, safeH, fixed);
      if (slot.x !== it.x || slot.y !== it.y || safeW !== it.w || safeH !== it.h) {
        layout[id] = { ...it, x: slot.x, y: slot.y, w: safeW, h: safeH };
        changed = true;
      }
      fixed.push({ x: slot.x, y: slot.y, w: safeW, h: safeH });
    }
  }
  return changed;
}

function gridCellSize(grid: HTMLElement): { w: number; h: number; gap: number } {
  const cs = getComputedStyle(grid);
  const gap = parseFloat(cs.columnGap || "0") || 0;
  const totalW = grid.clientWidth;
  const cellW = (totalW - gap * (GRID_COLS - 1)) / GRID_COLS;
  return { w: cellW, h: ROW_PX, gap };
}

function onPointerDown(e: PointerEvent): void {
  if (!editing) return;
  const target = e.target as HTMLElement;
  const card = target.closest<HTMLElement>(".dashboard-item");
  if (!card) return;
  const id = card.dataset.dashboardItem as ItemId;
  if (!id || !layout[id]) return;

  const isResize = target.classList.contains("dash-resize");
  const inHeader = !!target.closest(".card-header") && target.closest(".card-header")!.parentElement === card;
  const onControl = !!target.closest("button, .tab, .icon-btn, .chip, input, select, a");
  const isMove = !isResize && inHeader && !onControl;
  if (!isMove && !isResize) return;

  e.preventDefault();
  const grid = document.getElementById("dashboard-grid")!;
  const cell = gridCellSize(grid);

  const ghost = document.createElement("div");
  ghost.className = "dash-ghost";
  grid.appendChild(ghost);

  drag = {
    id,
    mode: isResize ? "resize" : "move",
    dir: isResize ? (target.dataset.dir || "se") : undefined,
    startPx: { x: e.clientX, y: e.clientY },
    startBox: { ...layout[id] },
    cellW: cell.w + cell.gap,
    cellH: ROW_PX + cell.gap,
    ghost,
  };
  card.classList.add("is-dragging");
  positionGhost(layout[id]);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp, { once: true });
}

function positionGhost(box: Box): void {
  if (!drag) return;
  drag.ghost.style.gridColumn = `${box.x + 1} / span ${box.w}`;
  drag.ghost.style.gridRow    = `${box.y + 1} / span ${box.h}`;
}

function onPointerMove(e: PointerEvent): void {
  if (!drag) return;
  const dx = e.clientX - drag.startPx.x;
  const dy = e.clientY - drag.startPx.y;
  const dCol = Math.round(dx / drag.cellW);
  const dRow = Math.round(dy / drag.cellH);

  const start = drag.startBox;
  const it = layout[drag.id];
  let next: Box = { ...start };

  if (drag.mode === "move") {
    next.x = clampInt(start.x + dCol, 0, GRID_COLS - start.w);
    next.y = Math.max(0, start.y + dRow);
  } else {
    const dir = drag.dir!;
    if (dir.includes("e")) next.w = clampInt(start.w + dCol, it.minW, GRID_COLS - start.x);
    if (dir.includes("s")) next.h = Math.max(it.minH, start.h + dRow);
    if (dir.includes("w")) {
      const newX = clampInt(start.x + dCol, 0, start.x + start.w - it.minW);
      next.w = start.w + (start.x - newX);
      next.x = newX;
    }
  }

  positionGhost(next);
  // Stash on ghost dataset so pointerup can read final box without recomputing.
  (drag.ghost as any).__box = next;
}

function onPointerUp(): void {
  if (!drag) return;
  const finalBox: Box | undefined = (drag.ghost as any).__box;
  const card = document.querySelector<HTMLElement>(`[data-dashboard-item="${CSS.escape(drag.id)}"]`);
  card?.classList.remove("is-dragging");
  drag.ghost.remove();
  document.removeEventListener("pointermove", onPointerMove);

  if (finalBox) {
    const droppedId = drag.id;
    layout[droppedId] = { ...layout[droppedId], ...finalBox };
    // Push any items that now overlap the drop target into the next free slot.
    const moved = repackVisible(droppedId);
    if (moved) applyAll(); else applyOne(droppedId);
    save();
  }
  drag = null;
}


function refreshTabDraggability(): void {
  // No-op: tab reordering is always active via the pointer-based engine in tab-drag.ts.
  // Removing draggable attrs so the browser's native DnD doesn't interfere.
  document.querySelectorAll<HTMLElement>("[data-tab-reorder] [data-tab-id]").forEach(t => {
    t.removeAttribute("draggable");
    t.classList.remove("tab-reorderable");
  });
}

export function init(): void {
  ensureLayoutLoaded();
  // Defensive: if a saved or migrated layout has stale overlaps (e.g. pre-v2
  // data positioned for a different visibility set), normalize before paint.
  if (repackVisible()) save();
  applyAll();
  initTabDrag();
  // Apply persisted tab orders for known groups.
  ["prs", "jira", "clickup", "mentions"].forEach(applyTabOrder);

  document.addEventListener("pointerdown", onPointerDown);

  // Customize button + toolbar buttons
  document.querySelectorAll<HTMLElement>("[data-action='toggle-edit-mode']").forEach(btn => {
    btn.addEventListener("click", () => setEditing(!editing));
  });
  document.querySelectorAll<HTMLElement>("[data-action='reset-layout']").forEach(btn => {
    btn.addEventListener("click", () => {
      if (confirm("Reset dashboard to default layout?")) resetLayout();
    });
  });

  // Switching workspaces: exit edit mode, then mount the new scope's layout
  // from scratch. The visibility observer below handles any post-switch
  // overlaps (e.g. a widget that was hidden in the old scope reappearing here).
  window.addEventListener("workspace-changed", () => {
    if (editing) setEditing(false);
    loadedScope = null;
    ensureLayoutLoaded();
    applyAll();
    // The visibility observer below will repack once main.ts finishes
    // applying connector visibility for the new scope.
  });

  // Keyboard: 'e' toggles edit mode (skip when typing).
  document.addEventListener("keydown", e => {
    const inField = ["INPUT", "TEXTAREA"].includes((document.activeElement?.tagName) || "");
    if (inField) return;
    if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setEditing(!editing);
    }
  });

  // Watch the dashboard grid for newly-rendered tab elements (Jira tabs are dynamic).
  // Guard with a rAF-debounce: applyTabOrder calls appendChild which would otherwise
  // re-trigger this observer synchronously, creating an infinite mutation loop.
  const grid = document.getElementById("dashboard-grid");
  if (grid) {
    let rafPending = false;
    new MutationObserver(() => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        refreshTabDraggability();
        ["prs", "jira", "clickup", "mentions"].forEach(applyTabOrder);
      });
    }).observe(grid, { childList: true, subtree: true });

    // Visibility observer: when a connector activates and its dashboard item
    // un-hides, smart-place it into the next free slot if it would overlap an
    // existing visible item. rAF-debounced so a batch of visibility toggles
    // (e.g. workspace switch) only triggers one repack.
    // The item that just became visible is passed as `priority` so it keeps its
    // current position (DEFAULT_LAYOUT or saved) while other items shift around it.
    let repackPending = false;
    new MutationObserver(muts => {
      if (!muts.some(m => m.attributeName === "hidden")) return;
      if (repackPending) return;
      repackPending = true;
      requestAnimationFrame(() => {
        repackPending = false;
        // Determine which dashboard item was just un-hidden, if exactly one.
        const justShown = muts
          .filter(m => m.attributeName === "hidden" && !(m.target as HTMLElement).hasAttribute("hidden"))
          .map(m => (m.target as HTMLElement).dataset.dashboardItem)
          .find(id => !!id && !!layout[id]);
        if (repackVisible(justShown)) {
          applyAll();
          save();
        }
      });
    }).observe(grid, { attributes: true, attributeFilter: ["hidden"], subtree: true });
  }

  refreshTabDraggability();
}
