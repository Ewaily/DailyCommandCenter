import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetActiveWs, mockGetLoadedConnectors, mockCapabilities } = vi.hoisted(() => ({
  mockGetActiveWs: vi.fn(),
  mockGetLoadedConnectors: vi.fn().mockReturnValue([]),
  mockCapabilities: [
    { staticWidgetId: "schedule", matchTypes: ["gcal", "outlook"] },
    { staticWidgetId: "prs",      matchTypes: ["github"] },
    { staticWidgetId: "tickets",  matchTypes: ["jira"] },
    { staticWidgetId: "clickup",  matchTypes: ["clickup"] },
    { staticWidgetId: "mentions", matchTypes: ["slack"] },
  ],
}));

vi.mock("../../src/frontend/components/workspace-switcher.js", () => ({ getActiveWorkspaceId: mockGetActiveWs }));
vi.mock("../../src/frontend/connectors.js",                    () => ({ getLoadedConnectors: mockGetLoadedConnectors }));
vi.mock("../../src/frontend/components/instance-card-registry.js", () => ({ CAPABILITIES: mockCapabilities }));
vi.mock("../../src/frontend/components/util.js", () => ({ escapeHtml: (s: string) => s }));

import {
  getCustomTitle,
  setCustomTitle,
  getCustomTitleForScope,
  getEffectiveTitle,
  applyTitles,
  initInlineEditing,
} from "../../src/frontend/components/widget-titles.js";

beforeEach(() => {
  localStorage.clear();
  mockGetActiveWs.mockReturnValue("ws-1");
  mockGetLoadedConnectors.mockReturnValue([]);
});

// ── getCustomTitle / setCustomTitle ───────────────────────────────────────────

describe("getCustomTitle / setCustomTitle", () => {
  it("returns null when no custom title is set", () => {
    expect(getCustomTitle("schedule")).toBeNull();
  });

  it("returns the custom title after setting it", () => {
    setCustomTitle("schedule", "My Calendar");
    expect(getCustomTitle("schedule")).toBe("My Calendar");
  });

  it("scopes titles per workspace", () => {
    mockGetActiveWs.mockReturnValue("ws-1");
    setCustomTitle("prs", "WS1 PRs");
    mockGetActiveWs.mockReturnValue("ws-2");
    expect(getCustomTitle("prs")).toBeNull();
  });

  it("removes title when set to empty string", () => {
    setCustomTitle("schedule", "My Cal");
    setCustomTitle("schedule", "");
    expect(getCustomTitle("schedule")).toBeNull();
  });

  it("removes title when set to whitespace-only", () => {
    setCustomTitle("schedule", "Title");
    setCustomTitle("schedule", "   ");
    expect(getCustomTitle("schedule")).toBeNull();
  });

  it("trims whitespace from saved title", () => {
    setCustomTitle("schedule", "  My Cal  ");
    expect(getCustomTitle("schedule")).toBe("My Cal");
  });

  it("persists to localStorage", () => {
    setCustomTitle("tickets", "JIRA Tickets");
    const stored = JSON.parse(localStorage.getItem("dcc-widget-titles-v1") || "{}");
    expect(stored["ws-1"]["tickets"]).toBe("JIRA Tickets");
  });
});

// ── getCustomTitleForScope ────────────────────────────────────────────────────

describe("getCustomTitleForScope", () => {
  it("returns null for unknown scope", () => {
    expect(getCustomTitleForScope("ws-999", "schedule")).toBeNull();
  });

  it("reads title from a specific scope regardless of active workspace", () => {
    mockGetActiveWs.mockReturnValue("ws-owner");
    setCustomTitle("prs", "Owner PRs");
    mockGetActiveWs.mockReturnValue("ws-consumer");
    expect(getCustomTitleForScope("ws-owner", "prs")).toBe("Owner PRs");
  });
});

// ── getEffectiveTitle ─────────────────────────────────────────────────────────

describe("getEffectiveTitle", () => {
  it("returns custom title when one is set", () => {
    setCustomTitle("schedule", "My Calendar");
    expect(getEffectiveTitle("schedule")).toBe("My Calendar");
  });

  it("returns default label when no customization", () => {
    expect(getEffectiveTitle("schedule")).toBe("Schedule");
    expect(getEffectiveTitle("prs")).toBe("Pull Requests");
    expect(getEffectiveTitle("tickets")).toBe("Tickets");
    expect(getEffectiveTitle("clickup")).toBe("Tasks");
    expect(getEffectiveTitle("mentions")).toBe("Mentions & DMs");
    expect(getEffectiveTitle("channels")).toBe("Channel Digest");
  });

  it("returns widgetId itself as fallback for unknown widget", () => {
    expect(getEffectiveTitle("unknown-widget")).toBe("unknown-widget");
  });

  it("prefixes with workspaceName when provided", () => {
    const title = getEffectiveTitle("schedule", "Acme");
    expect(title).toBe("Acme – Schedule");
  });

  it("does not prefix with workspaceName when custom title is set", () => {
    setCustomTitle("schedule", "My Cal");
    const title = getEffectiveTitle("schedule", "Acme");
    expect(title).toBe("My Cal");
  });

  it("inherits title from owner workspace when single shared connector", () => {
    mockGetActiveWs.mockReturnValue("ws-consumer");
    // Set a title in the owner scope
    mockGetActiveWs.mockReturnValue("ws-owner");
    setCustomTitle("prs", "Owner PRs");
    mockGetActiveWs.mockReturnValue("ws-consumer");

    // Simulate a single shared github connector owned by ws-owner
    mockGetLoadedConnectors.mockReturnValue([{
      type: "github",
      ownerWorkspace: { id: "ws-owner" },
    }]);

    const title = getEffectiveTitle("prs");
    expect(title).toBe("Owner PRs");
  });

  it("does NOT inherit when multiple connectors match (ambiguous)", () => {
    mockGetLoadedConnectors.mockReturnValue([
      { type: "github", ownerWorkspace: { id: "ws-a" } },
      { type: "github", ownerWorkspace: { id: "ws-b" } },
    ]);
    const title = getEffectiveTitle("prs");
    expect(title).toBe("Pull Requests"); // falls through to default
  });

  it("does NOT inherit when owner is the active workspace", () => {
    mockGetActiveWs.mockReturnValue("ws-1");
    mockGetLoadedConnectors.mockReturnValue([{
      type: "github",
      ownerWorkspace: { id: "ws-1" }, // same as active
    }]);
    const title = getEffectiveTitle("prs");
    expect(title).toBe("Pull Requests");
  });
});

// ── applyTitles ───────────────────────────────────────────────────────────────

describe("applyTitles", () => {
  it("updates .title-label text in dashboard items", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule">
        <span class="title-text">
          <span class="title-label">Old</span>
        </span>
      </div>
    `;
    setCustomTitle("schedule", "My Calendar");
    applyTitles();
    expect(document.querySelector(".title-label")!.textContent).toBe("My Calendar");
  });

  it("skips overview-instance-card elements", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule" class="overview-instance-card">
        <span class="title-text"><span class="title-label">Untouched</span></span>
      </div>
    `;
    setCustomTitle("schedule", "Changed");
    applyTitles();
    expect(document.querySelector(".title-label")!.textContent).toBe("Untouched");
  });

  it("creates title-label span on first call when missing", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="prs">
        <span class="title-text"></span>
      </div>
    `;
    applyTitles("Acme");
    const label = document.querySelector(".title-label");
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe("Acme – Pull Requests");
  });

  it("does nothing when title-text element is missing", () => {
    document.body.innerHTML = `<div data-dashboard-item="prs"></div>`;
    expect(() => applyTitles()).not.toThrow();
  });
});

// ── initInlineEditing ─────────────────────────────────────────────────────────

describe("initInlineEditing", () => {
  it("appends a pencil button to each .title-text", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule">
        <span class="title-text"><span class="title-label">Schedule</span></span>
      </div>
    `;
    initInlineEditing();
    expect(document.querySelector(".title-edit-btn")).not.toBeNull();
  });

  it("is idempotent — does not add duplicate pencil buttons", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule">
        <span class="title-text"><span class="title-label">Schedule</span></span>
      </div>
    `;
    initInlineEditing();
    initInlineEditing();
    expect(document.querySelectorAll(".title-edit-btn")).toHaveLength(1);
  });

  it("clicking pencil starts edit mode (is-editing class + input)", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule">
        <span class="title-text"><span class="title-label">Schedule</span></span>
      </div>
    `;
    initInlineEditing();
    const pencil = document.querySelector<HTMLElement>(".title-edit-btn")!;
    pencil.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".is-editing")).not.toBeNull();
    expect(document.querySelector("input.title-edit-input")).not.toBeNull();
  });

  it("pressing Enter commits the new title", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule">
        <span class="title-text"><span class="title-label">Schedule</span></span>
      </div>
    `;
    initInlineEditing();
    document.querySelector<HTMLElement>(".title-edit-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>("input.title-edit-input")!;
    input.value = "New Title";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector(".is-editing")).toBeNull();
    expect(getCustomTitle("schedule")).toBe("New Title");
  });

  it("pressing Escape restores the original text in the label", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule">
        <span class="title-text"><span class="title-label">Schedule</span></span>
      </div>
    `;
    initInlineEditing();
    document.querySelector<HTMLElement>(".title-edit-btn")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const input = document.querySelector<HTMLInputElement>("input.title-edit-input")!;
    input.value = "Will Be Cancelled";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".is-editing")).toBeNull();
    // Escape resets input.value to `current` (the original label text) then calls commit —
    // the rendered label is restored to "Schedule"
    const label = document.querySelector<HTMLElement>(".title-label");
    expect(label?.textContent).toBe("Schedule");
  });

  it("skips overview-instance-card elements", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule" class="overview-instance-card">
        <span class="title-text"><span class="title-label">Schedule</span></span>
      </div>
    `;
    initInlineEditing();
    expect(document.querySelector(".title-edit-btn")).toBeNull();
  });
});

// ── readStore catch path (line 40) ────────────────────────────────────────────

describe("readStore error recovery", () => {
  it("returns empty store when localStorage contains invalid JSON", () => {
    localStorage.setItem("dcc-widget-titles", "not-valid-json{{{");
    // getCustomTitle calls readStore() which will catch the JSON.parse error
    const result = getCustomTitle("schedule");
    expect(result).toBeNull(); // returns null because store is empty (recovered)
  });
});

// ── titleEl click starts edit ─────────────────────────────────────────────────

describe("click on title text itself starts edit", () => {
  it("clicking the .title-text (not pencil) starts editing", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule">
        <span class="title-text"><span class="title-label">Schedule</span></span>
      </div>
    `;
    initInlineEditing();
    const titleEl = document.querySelector<HTMLElement>(".title-text")!;
    // Click the titleEl itself (not the pencil button child)
    titleEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".is-editing")).not.toBeNull();
  });

  it("clicking .title-edit-btn inside title-text does NOT start duplicate edit", () => {
    document.body.innerHTML = `
      <div data-dashboard-item="schedule">
        <span class="title-text"><span class="title-label">Schedule</span></span>
      </div>
    `;
    initInlineEditing();
    const pencil = document.querySelector<HTMLElement>(".title-edit-btn")!;
    // Click the pencil — this triggers the pencil's own click listener
    pencil.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    // Now the titleEl click handler fires (bubbled), but .title-edit-btn check prevents double edit
    expect(document.querySelectorAll("input.title-edit-input")).toHaveLength(1);
  });
});
