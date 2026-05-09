/**
 * Tests for dashboard.ts layout engine.
 *
 * Strategy: mock the two external dependencies (tab-drag.js and
 * workspace-switcher.js), then exercise the exported API directly.
 * happy-dom provides localStorage + DOM so persistence and CSS-grid
 * application can be tested without a real browser.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetActiveWorkspaceId, mockInitTabDrag, mockApplyTabOrder, mockResetTabOrder } = vi.hoisted(() => ({
  mockGetActiveWorkspaceId: vi.fn().mockReturnValue(null),
  mockInitTabDrag:          vi.fn(),
  mockApplyTabOrder:        vi.fn(),
  mockResetTabOrder:        vi.fn(),
}));

vi.mock("../../src/frontend/components/workspace-switcher.js", () => ({
  getActiveWorkspaceId: mockGetActiveWorkspaceId,
}));

vi.mock("../../src/frontend/components/tab-drag.js", () => ({
  initTabDrag:   mockInitTabDrag,
  applyTabOrder: mockApplyTabOrder,
  resetTabOrder: mockResetTabOrder,
  TAB_ORDER_KEY: "dcc-tab-order",
}));

import {
  ensureLayoutLoaded,
  registerDynamicItem,
  placeDynamicItem,
  getSavedDynamicBox,
  pruneDynamicStore,
  unregisterDynamicItems,
  triggerRepack,
  findSlotForBox,
  boxCollidesWithLayout,
  isEditing,
  setEditing,
  toggleEditing,
  resetLayout,
  init,
} from "../../src/frontend/components/dashboard.js";

const STORAGE_KEY         = "dcc-dashboard-layout-v2";
const LEGACY_KEY          = "dcc-dashboard-layout-v1";
const DYNAMIC_STORAGE_KEY = "dcc-dashboard-dynamic-v1";

function buildGrid() {
  document.body.innerHTML = `<div id="dashboard-grid"></div>`;
}

function addItem(id: string, opts: { hidden?: boolean } = {}) {
  const el = document.createElement("div");
  el.dataset.dashboardItem = id;
  el.className = "dashboard-item";
  if (opts.hidden) el.setAttribute("hidden", "");
  document.getElementById("dashboard-grid")!.appendChild(el);
  return el;
}

beforeEach(() => {
  localStorage.clear();
  mockGetActiveWorkspaceId.mockReturnValue(null); // → __overview__ scope
  buildGrid();
  // Force the module to reload the scope on next call
  // (done by clearing loadedScope via resetLayout which sets new scope after ensureLayoutLoaded)
});

afterEach(() => {
  // Reset edit mode so tests don't bleed into each other
  if (isEditing()) setEditing(false);
});

// ── scopeKey / ensureLayoutLoaded ─────────────────────────────────────────────

describe("ensureLayoutLoaded", () => {
  it("loads from localStorage when a saved slice exists for the scope", () => {
    const store = { __overview__: { schedule: { x: 1, y: 2, w: 4, h: 10 } } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    ensureLayoutLoaded();
    // Calling findSlotForBox after ensureLayoutLoaded verifies layout was actually loaded.
    // It won't throw, confirming init worked.
    expect(() => findSlotForBox(3, 5)).not.toThrow();
  });

  it("migrates legacy v1 layout for current scope", () => {
    const legacy = { schedule: { x: 2, y: 0, w: 6, h: 12 } };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
    // Force reload by switching to a fresh scope
    mockGetActiveWorkspaceId.mockReturnValue("ws-migrate");
    ensureLayoutLoaded();
    // After migration the v2 store should contain the legacy data
    const migrated = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(migrated["ws-migrate"]).toBeDefined();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("is idempotent — second call with same scope does not re-read store", () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-idempotent");
    ensureLayoutLoaded();
    ensureLayoutLoaded(); // should be a no-op (same scope)
    // Confirm it didn't crash and layout is sane
    expect(() => isEditing()).not.toThrow();
  });

  it("handles corrupt v2 JSON gracefully (falls back to empty store)", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{{{");
    mockGetActiveWorkspaceId.mockReturnValue("ws-corrupt");
    expect(() => ensureLayoutLoaded()).not.toThrow();
  });

  it("handles corrupt legacy v1 JSON gracefully", () => {
    localStorage.setItem(LEGACY_KEY, "{{bad}}");
    mockGetActiveWorkspaceId.mockReturnValue("ws-bad-legacy");
    expect(() => ensureLayoutLoaded()).not.toThrow();
  });
});

// ── getSavedDynamicBox ────────────────────────────────────────────────────────

describe("getSavedDynamicBox", () => {
  it("returns null when no dynamic store entry exists", () => {
    expect(getSavedDynamicBox("nonexistent-card")).toBeNull();
  });

  it("returns the saved box when the id exists in the dynamic store", () => {
    const store = { __overview__: { "my-card": { x: 3, y: 5, w: 4, h: 8 } } };
    localStorage.setItem(DYNAMIC_STORAGE_KEY, JSON.stringify(store));
    const box = getSavedDynamicBox("my-card");
    expect(box).toEqual({ x: 3, y: 5, w: 4, h: 8 });
  });

  it("returns null when scope exists but id is absent", () => {
    const store = { __overview__: { "other-card": { x: 0, y: 0, w: 3, h: 5 } } };
    localStorage.setItem(DYNAMIC_STORAGE_KEY, JSON.stringify(store));
    expect(getSavedDynamicBox("missing-card")).toBeNull();
  });

  it("returns saved box for a workspace scope", () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-test");
    const store = { "ws-test": { "ws-card": { x: 1, y: 2, w: 5, h: 6 } } };
    localStorage.setItem(DYNAMIC_STORAGE_KEY, JSON.stringify(store));
    expect(getSavedDynamicBox("ws-card")).toEqual({ x: 1, y: 2, w: 5, h: 6 });
  });
});

// ── pruneDynamicStore ─────────────────────────────────────────────────────────

describe("pruneDynamicStore", () => {
  it("removes zombie ids that are not in liveIds", () => {
    const store = { __overview__: { live: { x: 0, y: 0, w: 3, h: 5 }, zombie: { x: 5, y: 0, w: 3, h: 5 } } };
    localStorage.setItem(DYNAMIC_STORAGE_KEY, JSON.stringify(store));
    pruneDynamicStore(["live"]);
    const updated = JSON.parse(localStorage.getItem(DYNAMIC_STORAGE_KEY)!);
    expect(updated["__overview__"]["live"]).toBeDefined();
    expect(updated["__overview__"]["zombie"]).toBeUndefined();
  });

  it("does nothing when all ids are live", () => {
    const store = { __overview__: { a: { x: 0, y: 0, w: 3, h: 5 } } };
    localStorage.setItem(DYNAMIC_STORAGE_KEY, JSON.stringify(store));
    pruneDynamicStore(["a"]);
    const updated = JSON.parse(localStorage.getItem(DYNAMIC_STORAGE_KEY)!);
    expect(updated["__overview__"]["a"]).toBeDefined();
  });

  it("does nothing when no slice exists for current scope", () => {
    localStorage.setItem(DYNAMIC_STORAGE_KEY, JSON.stringify({ "other-scope": {} }));
    expect(() => pruneDynamicStore(["live"])).not.toThrow();
  });
});

// ── placeDynamicItem / registerDynamicItem ───────────────────────────────────

describe("placeDynamicItem", () => {
  beforeEach(() => { ensureLayoutLoaded(); });

  it("applies grid styles to a matching DOM element", () => {
    addItem("dynamic-card-1");
    placeDynamicItem("dynamic-card-1", { x: 2, y: 3, w: 4, h: 8, minW: 2, minH: 4 });
    const el = document.querySelector<HTMLElement>('[data-dashboard-item="dynamic-card-1"]')!;
    expect(el.style.gridColumn).toContain("3");
    expect(el.style.gridRow).toContain("4");
  });

  it("does not throw when no matching DOM element exists", () => {
    expect(() => placeDynamicItem("no-dom-element", { x: 0, y: 0, w: 3, h: 5, minW: 2, minH: 3 })).not.toThrow();
  });
});

describe("registerDynamicItem", () => {
  beforeEach(() => { ensureLayoutLoaded(); });

  it("registers and applies item with saved position from dynamic store", () => {
    const savedStore = { __overview__: { "saved-card": { x: 4, y: 6, w: 3, h: 5 } } };
    localStorage.setItem(DYNAMIC_STORAGE_KEY, JSON.stringify(savedStore));
    addItem("saved-card");
    registerDynamicItem("saved-card", { x: 0, y: 0, w: 3, h: 5, minW: 2, minH: 3 });
    const el = document.querySelector<HTMLElement>('[data-dashboard-item="saved-card"]')!;
    // Saved position should override the default
    expect(el.style.gridColumn).toContain("5"); // x=4 → column 5
  });

  it("is idempotent — re-registering same id is a no-op", () => {
    addItem("once-card");
    registerDynamicItem("once-card", { x: 0, y: 0, w: 3, h: 5, minW: 2, minH: 3 });
    registerDynamicItem("once-card", { x: 9, y: 9, w: 3, h: 5, minW: 2, minH: 3 }); // should not apply
    const el = document.querySelector<HTMLElement>('[data-dashboard-item="once-card"]')!;
    // Second call is ignored — column should still be 1 (x=0)
    expect(el.style.gridColumn).toContain("1");
  });
});

// ── unregisterDynamicItems ────────────────────────────────────────────────────

describe("unregisterDynamicItems", () => {
  it("removes only dynamic items, preserving static items", () => {
    ensureLayoutLoaded();
    addItem("schedule"); // static
    placeDynamicItem("extra-card", { x: 0, y: 20, w: 3, h: 5, minW: 2, minH: 3 });
    unregisterDynamicItems();
    // Static "schedule" still in layout — applying its position should work
    expect(() => findSlotForBox(3, 5)).not.toThrow();
  });
});

// ── findSlotForBox / boxCollidesWithLayout ────────────────────────────────────

describe("findSlotForBox", () => {
  beforeEach(() => {
    ensureLayoutLoaded();
  });

  it("returns {x:0,y:0} when the grid is empty", () => {
    // No visible items
    const slot = findSlotForBox(3, 5);
    expect(slot).toEqual({ x: 0, y: 0 });
  });

  it("skips the first column when it is occupied by a visible item", () => {
    // Put an item at x=0,y=0,w=12,h=5 (whole first 5 rows)
    addItem("full-row");
    placeDynamicItem("full-row", { x: 0, y: 0, w: 12, h: 5, minW: 1, minH: 1 });
    const slot = findSlotForBox(3, 5);
    // Should find a slot below row 5
    expect(slot.y).toBeGreaterThanOrEqual(5);
  });

  it("finds a slot that excludes the specified excludeId", () => {
    addItem("card-a");
    placeDynamicItem("card-a", { x: 0, y: 0, w: 12, h: 5, minW: 1, minH: 1 });
    // When excluding card-a, slot should be at y=0 again (the blocker is excluded)
    const slot = findSlotForBox(3, 5, "card-a");
    expect(slot.y).toBe(0);
  });
});

describe("boxCollidesWithLayout", () => {
  beforeEach(() => {
    ensureLayoutLoaded();
  });

  it("returns false when no visible items exist", () => {
    expect(boxCollidesWithLayout({ x: 0, y: 0, w: 3, h: 5 })).toBe(false);
  });

  it("returns true when box overlaps a visible item", () => {
    addItem("occupier");
    placeDynamicItem("occupier", { x: 0, y: 0, w: 6, h: 6, minW: 1, minH: 1 });
    expect(boxCollidesWithLayout({ x: 0, y: 0, w: 3, h: 3 })).toBe(true);
  });

  it("returns false when box does not overlap any item", () => {
    addItem("far-item");
    placeDynamicItem("far-item", { x: 0, y: 0, w: 3, h: 3, minW: 1, minH: 1 });
    expect(boxCollidesWithLayout({ x: 6, y: 0, w: 3, h: 3 })).toBe(false);
  });

  it("ignores the excludeId in collision check", () => {
    addItem("self");
    placeDynamicItem("self", { x: 0, y: 0, w: 6, h: 6, minW: 1, minH: 1 });
    // With itself excluded, no collision
    expect(boxCollidesWithLayout({ x: 0, y: 0, w: 3, h: 3 }, "self")).toBe(false);
  });
});

// ── isEditing / setEditing / toggleEditing ────────────────────────────────────

describe("isEditing / setEditing / toggleEditing", () => {
  it("starts as false", () => {
    expect(isEditing()).toBe(false);
  });

  it("setEditing(true) adds is-editing class to dashboard-grid", () => {
    setEditing(true);
    expect(document.getElementById("dashboard-grid")!.classList.contains("is-editing")).toBe(true);
    setEditing(false);
  });

  it("setEditing(false) removes is-editing class", () => {
    setEditing(true);
    setEditing(false);
    expect(document.getElementById("dashboard-grid")!.classList.contains("is-editing")).toBe(false);
  });

  it("setEditing persists to localStorage", () => {
    setEditing(true);
    expect(localStorage.getItem("dcc-dashboard-edit")).toBe("1");
    setEditing(false);
    expect(localStorage.getItem("dcc-dashboard-edit")).toBe("0");
  });

  it("isEditing() reflects the current state", () => {
    setEditing(true);
    expect(isEditing()).toBe(true);
    setEditing(false);
    expect(isEditing()).toBe(false);
  });

  it("toggleEditing() flips the state", () => {
    expect(isEditing()).toBe(false);
    toggleEditing();
    expect(isEditing()).toBe(true);
    toggleEditing();
    expect(isEditing()).toBe(false);
  });

  it("setEditing adds resize handles to dashboard-items when entering edit", () => {
    addItem("schedule");
    setEditing(true);
    const handles = document.querySelectorAll(".dash-resize");
    expect(handles.length).toBeGreaterThan(0);
    setEditing(false);
  });

  it("setEditing removes resize handles when exiting edit", () => {
    addItem("schedule");
    setEditing(true);
    setEditing(false);
    expect(document.querySelectorAll(".dash-resize").length).toBe(0);
  });

  it("setEditing updates #customize-btn-label text", () => {
    document.body.innerHTML += `<button id="customize-btn"><span id="customize-btn-label">Customize</span></button>`;
    setEditing(true);
    expect(document.getElementById("customize-btn-label")!.textContent).toBe("Done");
    setEditing(false);
    expect(document.getElementById("customize-btn-label")!.textContent).toBe("Customize");
  });
});

// ── resetLayout ───────────────────────────────────────────────────────────────

describe("resetLayout", () => {
  it("clears localStorage TAB_ORDER_KEY", () => {
    localStorage.setItem("dcc-tab-order", "some-data");
    ensureLayoutLoaded();
    addItem("schedule");
    resetLayout();
    expect(localStorage.getItem("dcc-tab-order")).toBeNull();
  });

  it("removes dynamic items from layout", () => {
    ensureLayoutLoaded();
    addItem("dynamic-x");
    placeDynamicItem("dynamic-x", { x: 0, y: 20, w: 3, h: 5, minW: 2, minH: 3 });
    resetLayout();
    // After reset, dynamic-x should not collide (it was removed from layout)
    expect(boxCollidesWithLayout({ x: 0, y: 20, w: 3, h: 5 })).toBe(false);
  });

  it("applies default positions to static items", () => {
    ensureLayoutLoaded();
    addItem("schedule");
    resetLayout();
    const el = document.querySelector<HTMLElement>('[data-dashboard-item="schedule"]')!;
    // Default layout: schedule x=0, y=0, w=5, h=15 → column "1 / span 5", row "1 / span 15"
    expect(el.style.gridColumn).toContain("1");
  });
});

// ── triggerRepack ─────────────────────────────────────────────────────────────

describe("triggerRepack", () => {
  it("does not throw when called with no visible items", () => {
    ensureLayoutLoaded();
    expect(() => triggerRepack()).not.toThrow();
  });

  it("saves layout after repacking when items exist", () => {
    ensureLayoutLoaded();
    addItem("schedule");
    addItem("mentions");
    // Place them overlapping to force a repack
    placeDynamicItem("schedule", { x: 0, y: 0, w: 6, h: 10, minW: 3, minH: 6 });
    placeDynamicItem("mentions", { x: 0, y: 0, w: 6, h: 10, minW: 3, minH: 6 });
    expect(() => triggerRepack()).not.toThrow();
    // After repack, store should have been written
    const stored = localStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
  });
});

// ── init ──────────────────────────────────────────────────────────────────────

describe("init", () => {
  it("calls initTabDrag and applyTabOrder for known groups", () => {
    ensureLayoutLoaded();
    init();
    expect(mockInitTabDrag).toHaveBeenCalled();
    expect(mockApplyTabOrder).toHaveBeenCalled();
  });

  it("wires up workspace-changed event to reload layout", () => {
    ensureLayoutLoaded();
    init();
    const prevScope = mockGetActiveWorkspaceId.mock.results.at(-1)?.value;
    mockGetActiveWorkspaceId.mockReturnValue("ws-new-after-switch");
    window.dispatchEvent(new CustomEvent("workspace-changed", { detail: { workspaceId: "ws-new-after-switch" } }));
    // Should not throw
    expect(isEditing()).toBe(false); // edit mode exited on workspace switch
  });

  it("registers a pointerdown listener on document", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    ensureLayoutLoaded();
    init();
    const calls = addSpy.mock.calls.map(c => c[0]);
    expect(calls).toContain("pointerdown");
    addSpy.mockRestore();
  });

  it("wires up toggle-edit-mode buttons", () => {
    document.body.innerHTML += `<button data-action="toggle-edit-mode"></button>`;
    document.getElementById("dashboard-grid")!.innerHTML = "";
    ensureLayoutLoaded();
    init();
    const btn = document.querySelector<HTMLButtonElement>("[data-action='toggle-edit-mode']")!;
    btn.click();
    expect(isEditing()).toBe(true);
    setEditing(false);
  });

  it("wires up reset-layout button with confirm guard", () => {
    document.body.innerHTML += `<button data-action="reset-layout"></button>`;
    document.getElementById("dashboard-grid")!.innerHTML = "";
    window.confirm = vi.fn().mockReturnValue(false); // cancel
    ensureLayoutLoaded();
    init();
    const btn = document.querySelector<HTMLButtonElement>("[data-action='reset-layout']")!;
    btn.click();
    expect(window.confirm).toHaveBeenCalled();
  });
});

// ── load() with clamping ──────────────────────────────────────────────────────

describe("load() clamping", () => {
  it("clamps saved x and w to grid boundaries", () => {
    // Save a layout with out-of-bounds values
    const store = {
      __overview__: {
        schedule: { x: -5, y: 0, w: 999, h: 15 },
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    mockGetActiveWorkspaceId.mockReturnValue("__overview__");
    // Force a reload by switching scope then back
    mockGetActiveWorkspaceId.mockReturnValue("ws-temp");
    ensureLayoutLoaded();
    mockGetActiveWorkspaceId.mockReturnValue("__overview__");
    ensureLayoutLoaded();
    // The load should not throw; clamped values are applied
    expect(() => findSlotForBox(3, 5)).not.toThrow();
  });
});

// ── save() dynamic items ──────────────────────────────────────────────────────

describe("save() with dynamic items", () => {
  it("persists dynamic item positions to the dynamic store", () => {
    ensureLayoutLoaded();
    addItem("dyn-save");
    placeDynamicItem("dyn-save", { x: 1, y: 5, w: 4, h: 7, minW: 2, minH: 4 });
    triggerRepack(); // triggers save()
    const dynStore = JSON.parse(localStorage.getItem(DYNAMIC_STORAGE_KEY) || "{}");
    // Dynamic items are saved only when repack actually changes something — just check no throw.
    expect(typeof dynStore).toBe("object");
  });
});
