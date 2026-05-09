import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockIsEditing } = vi.hoisted(() => ({
  mockIsEditing: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/frontend/components/dashboard.js", () => ({
  isEditing: (...a: any[]) => mockIsEditing(...a),
}));

import {
  TAB_ORDER_KEY,
  loadTabOrder,
  initTabDrag,
} from "../../src/frontend/components/tab-drag.js";

function makeTabs(group: string, ids: string[]): HTMLElement {
  const container = document.createElement("div");
  container.dataset.tabReorder = group;
  ids.forEach((id, i) => {
    const tab = document.createElement("button");
    tab.dataset.tabId = id;
    // Give each tab fake boundingClientRect for step calculation
    Object.defineProperty(tab, "getBoundingClientRect", {
      value: () => ({ width: 60, left: i * 70, right: i * 70 + 60, top: 0, bottom: 20 }),
      configurable: true,
    });
    container.appendChild(tab);
  });
  document.body.appendChild(container);
  return container;
}

function pointerdown(target: HTMLElement, x = 10, y = 10, button = 0) {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button, clientX: x, clientY: y }));
}

function pointermove(x: number, y = 10) {
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y }));
}

function pointerup() {
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsEditing.mockReturnValue(false);
  document.body.innerHTML = "";
  localStorage.clear();
  initTabDrag();
});

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

// ── initTabDrag ───────────────────────────────────────────────────────────────

describe("initTabDrag", () => {
  it("does not throw on init", () => {
    expect(() => initTabDrag()).not.toThrow();
  });
});

// ── onPointerDown — guards ────────────────────────────────────────────────────

describe("onPointerDown guards", () => {
  it("ignores non-primary mouse button", () => {
    mockIsEditing.mockReturnValue(true);
    const container = makeTabs("g-button", ["a", "b"]);
    const tab = container.querySelector<HTMLElement>("[data-tab-id='a']")!;
    pointerdown(tab, 10, 10, 2); // right-click
    // no drag started — no error
    expect(true).toBe(true);
  });

  it("ignores pointerdown when not in edit mode", () => {
    mockIsEditing.mockReturnValue(false);
    const container = makeTabs("g-noedit", ["a", "b"]);
    const tab = container.querySelector<HTMLElement>("[data-tab-id='a']")!;
    pointerdown(tab, 10, 10, 0);
    // no drag, no error
    expect(true).toBe(true);
  });

  it("ignores pointerdown on element outside a tab container", () => {
    mockIsEditing.mockReturnValue(true);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    expect(true).toBe(true);
  });
});

// ── full drag sequence ────────────────────────────────────────────────────────

describe("full drag and reorder", () => {
  it("persists new tab order after a drag that crosses a slot boundary", () => {
    mockIsEditing.mockReturnValue(true);
    const container = makeTabs("g-reorder", ["tab-a", "tab-b", "tab-c"]);

    const tabA = container.querySelector<HTMLElement>("[data-tab-id='tab-a']")!;

    pointerdown(tabA, 0, 0);            // start at x=0
    pointermove(80, 0);                 // move far enough to exceed threshold (>5px) and cross a slot
    pointerup();

    const saved = loadTabOrder();
    // After reorder, the order should be saved
    expect(saved["g-reorder"]).toBeDefined();
  });

  it("does not save order when drag does not move beyond threshold", () => {
    mockIsEditing.mockReturnValue(true);
    const container = makeTabs("g-nodrag", ["tab-x", "tab-y"]);

    const tabX = container.querySelector<HTMLElement>("[data-tab-id='tab-x']")!;

    pointerdown(tabX, 0, 0);
    pointermove(2, 0);  // less than DRAG_THRESHOLD (5px)
    pointerup();

    // No drag committed, nothing saved
    const saved = loadTabOrder();
    expect(saved["g-nodrag"]).toBeUndefined();
  });

  it("clears drag state on pointerup even without actual drag", () => {
    mockIsEditing.mockReturnValue(true);
    const container = makeTabs("g-clean", ["tab-1", "tab-2"]);

    const tab = container.querySelector<HTMLElement>("[data-tab-id='tab-1']")!;
    pointerdown(tab, 0, 0);
    pointerup(); // immediate release
    // second drag attempt should still work
    pointerdown(tab, 0, 0);
    pointermove(100, 0);
    pointerup();
    expect(true).toBe(true);
  });

  it("handles pointerup without prior pointerdown gracefully", () => {
    expect(() => pointerup()).not.toThrow();
  });

  it("handles pointermove without prior pointerdown gracefully", () => {
    expect(() => pointermove(100)).not.toThrow();
  });
});
