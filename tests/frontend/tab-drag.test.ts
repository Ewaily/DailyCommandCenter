import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/frontend/components/dashboard.js", () => ({
  isEditing: vi.fn().mockReturnValue(false),
}));

import {
  TAB_ORDER_KEY,
  loadTabOrder,
  applyTabOrder,
  resetTabOrder,
} from "../../src/frontend/components/tab-drag.js";

function makeContainer(group: string, ids: string[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.dataset.tabReorder = group;
  for (const id of ids) {
    const btn = document.createElement("button");
    btn.dataset.tabId = id;
    wrap.appendChild(btn);
  }
  document.body.appendChild(wrap);
  return wrap;
}

function tabIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-tab-id]")).map(
    el => el.dataset.tabId!
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

// ── loadTabOrder ──────────────────────────────────────────────────────────────

describe("loadTabOrder", () => {
  it("returns empty object when nothing is stored", () => {
    expect(loadTabOrder()).toEqual({});
  });

  it("deduplicates ids within a group", () => {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify({ clickup: ["mine", "ivan", "ivan", "ashour"] }));
    expect(loadTabOrder().clickup).toEqual(["mine", "ivan", "ashour"]);
  });

  it("strips non-string entries", () => {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify({ prs: ["review", 42, null, "closed"] }));
    expect(loadTabOrder().prs).toEqual(["review", "closed"]);
  });

  it("returns empty object on malformed JSON", () => {
    localStorage.setItem(TAB_ORDER_KEY, "not-json{{{");
    expect(loadTabOrder()).toEqual({});
  });
});

// ── resetTabOrder ─────────────────────────────────────────────────────────────

describe("resetTabOrder", () => {
  it("removes the localStorage key", () => {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify({ prs: ["review"] }));
    resetTabOrder();
    expect(localStorage.getItem(TAB_ORDER_KEY)).toBeNull();
  });
});

// ── applyTabOrder ─────────────────────────────────────────────────────────────

describe("applyTabOrder", () => {
  it("does nothing when no saved order exists for the group", () => {
    const c = makeContainer("prs", ["review", "mine", "all", "closed"]);
    applyTabOrder("prs");
    expect(tabIds(c)).toEqual(["review", "mine", "all", "closed"]);
  });

  it("does nothing when the container does not exist in the DOM", () => {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify({ ghost: ["a", "b"] }));
    // No container added — should not throw
    expect(() => applyTabOrder("ghost")).not.toThrow();
  });

  // ── BUG FIX: stale order self-healing ─────────────────────────────────────

  it("evicts stale group from localStorage when saved ids are a partial subset of current tabs", () => {
    // "open" is not a valid PR bucket — this mirrors the real corrupted data
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify({ prs: ["review", "open", "closed"] }));
    makeContainer("prs", ["review", "mine", "all", "closed"]);

    applyTabOrder("prs");

    expect(loadTabOrder()["prs"]).toBeUndefined();
  });

  it("leaves other groups intact when evicting one stale group", () => {
    localStorage.setItem(
      TAB_ORDER_KEY,
      JSON.stringify({ prs: ["review", "open", "closed"], jira: ["mine", "alice"] })
    );
    makeContainer("prs", ["review", "mine", "all", "closed"]);
    makeContainer("jira", ["mine", "alice"]);

    applyTabOrder("prs");

    expect(loadTabOrder()["prs"]).toBeUndefined();
    expect(loadTabOrder()["jira"]).toEqual(["mine", "alice"]);
  });

  // ── BUG FIX: short-circuit to break infinite MutationObserver loop ─────────

  it("does not call appendChild when current DOM order already matches saved order", () => {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify({ prs: ["mine", "review", "all", "closed"] }));
    const c = makeContainer("prs", ["mine", "review", "all", "closed"]);
    const spy = vi.spyOn(c, "appendChild");

    applyTabOrder("prs");

    expect(spy).not.toHaveBeenCalled();
  });

  // ── Reorder applied correctly ──────────────────────────────────────────────

  it("reorders tabs to match the saved order", () => {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify({ prs: ["closed", "all", "mine", "review"] }));
    const c = makeContainer("prs", ["review", "mine", "all", "closed"]);

    applyTabOrder("prs");

    expect(tabIds(c)).toEqual(["closed", "all", "mine", "review"]);
  });

  it("handles dynamic groups with duplicate ids by treating the deduped set as canonical", () => {
    // Real corrupted clickup data: duplicate "ivan"
    localStorage.setItem(
      TAB_ORDER_KEY,
      JSON.stringify({ clickup: ["mine", "ivan", "ashour", "ayman", "yosef", "ivan"] })
    );
    const c = makeContainer("clickup", ["mine", "ivan", "ashour", "ayman", "yosef"]);

    applyTabOrder("clickup");

    // loadTabOrder deduped to 5 unique IDs, all match the 5 actual tabs
    expect(tabIds(c)).toEqual(["mine", "ivan", "ashour", "ayman", "yosef"]);
  });
});
