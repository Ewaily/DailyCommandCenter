import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockListWorkspaces, mockGetActiveWorkspaceId, mockSetActiveWorkspaceId, mockOpenSettings, mockOpenToNewWorkspace, mockToggleTheme } = vi.hoisted(() => ({
  mockListWorkspaces:        vi.fn().mockReturnValue([]),
  mockGetActiveWorkspaceId:  vi.fn().mockReturnValue(null),
  mockSetActiveWorkspaceId:  vi.fn(),
  mockOpenSettings:          vi.fn(),
  mockOpenToNewWorkspace:    vi.fn(),
  mockToggleTheme:           vi.fn(),
}));

vi.mock("../../src/frontend/components/workspace-switcher.js", () => ({
  listWorkspaces:        mockListWorkspaces,
  getActiveWorkspaceId:  mockGetActiveWorkspaceId,
  setActiveWorkspaceId:  mockSetActiveWorkspaceId,
}));
vi.mock("../../src/frontend/components/settings.js", () => ({
  openSettings:       mockOpenSettings,
  openToNewWorkspace: mockOpenToNewWorkspace,
}));
vi.mock("../../src/frontend/components/theme.js",   () => ({ toggleTheme: mockToggleTheme }));
vi.mock("../../src/frontend/components/util.js",    () => ({
  $:          (sel: string) => document.querySelector(sel),
  escapeHtml: (s: string) => s,
}));

import { openPalette, closePalette, bindPalette, isPaletteOpen } from "../../src/frontend/components/palette.js";

function buildDom() {
  document.body.innerHTML = `
    <div id="palette" aria-hidden="true">
      <input id="palette-input" />
      <div id="palette-results"></div>
    </div>
    <div id="help-modal"></div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  buildDom();
  mockListWorkspaces.mockReturnValue([]);
  mockGetActiveWorkspaceId.mockReturnValue(null);
});

// ── openPalette / closePalette ────────────────────────────────────────────────

describe("openPalette / closePalette", () => {
  it("adds 'open' class to #palette element", () => {
    openPalette();
    expect(document.getElementById("palette")!.classList.contains("open")).toBe(true);
  });

  it("sets aria-hidden to false when opened", () => {
    openPalette();
    expect(document.getElementById("palette")!.getAttribute("aria-hidden")).toBe("false");
  });

  it("isPaletteOpen returns true when open", () => {
    openPalette();
    expect(isPaletteOpen()).toBe(true);
  });

  it("closePalette removes 'open' class", () => {
    openPalette();
    closePalette();
    expect(document.getElementById("palette")!.classList.contains("open")).toBe(false);
  });

  it("closePalette sets aria-hidden back to true", () => {
    openPalette();
    closePalette();
    expect(document.getElementById("palette")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("isPaletteOpen returns false after close", () => {
    openPalette();
    closePalette();
    expect(isPaletteOpen()).toBe(false);
  });

  it("pre-populates input with seed string", () => {
    openPalette("settings");
    expect((document.getElementById("palette-input") as HTMLInputElement).value).toBe("settings");
  });

  it("renders system commands in results", () => {
    openPalette();
    const html = document.getElementById("palette-results")!.innerHTML;
    expect(html).toContain("Open Settings");
    expect(html).toContain("Toggle dark");
  });

  it("does nothing when palette element is absent", () => {
    document.getElementById("palette")!.remove();
    expect(() => openPalette()).not.toThrow();
  });
});

// ── Workspace entries ─────────────────────────────────────────────────────────

describe("workspace entries in palette", () => {
  it("shows Overview entry when 2+ workspaces exist", () => {
    mockListWorkspaces.mockReturnValue([
      { id: "ws-1", name: "Alpha", icon: "🏢" },
      { id: "ws-2", name: "Beta",  icon: "🏭" },
    ]);
    openPalette();
    expect(document.getElementById("palette-results")!.innerHTML).toContain("Overview");
  });

  it("does not show Overview entry when only 1 workspace", () => {
    mockListWorkspaces.mockReturnValue([{ id: "ws-1", name: "Alpha", icon: "🏢" }]);
    openPalette();
    // results rendered, but no Overview section header
    const html = document.getElementById("palette-results")!.innerHTML;
    // If the results don't contain "Overview" title, it's hidden
    // Note: palette renders "Workspaces" section — but "Overview" item should not appear
    const items = document.querySelectorAll(".palette-item");
    const hasOverviewItem = Array.from(items).some(i => i.textContent?.includes("Overview") && !i.textContent?.includes("Alpha"));
    expect(hasOverviewItem).toBe(false);
  });

  it("marks current workspace with ✓ glyph", () => {
    mockListWorkspaces.mockReturnValue([
      { id: "ws-1", name: "Alpha", icon: "🏢" },
      { id: "ws-2", name: "Beta",  icon: "🏭" },
    ]);
    mockGetActiveWorkspaceId.mockReturnValue("ws-1");
    openPalette();
    const items = document.querySelectorAll(".palette-item");
    const alphaItem = Array.from(items).find(i => i.textContent?.includes("Alpha"));
    expect(alphaItem?.innerHTML).toContain("✓");
  });
});

// ── Navigation entries ────────────────────────────────────────────────────────

describe("navigation entries", () => {
  it("includes navigation item when section element is visible", () => {
    document.body.innerHTML += `<div id="section-schedule"></div>`;
    openPalette();
    expect(document.getElementById("palette-results")!.innerHTML).toContain("Schedule");
  });

  it("excludes navigation item when section element has hidden attribute", () => {
    document.body.innerHTML += `<div id="section-schedule" hidden></div>`;
    openPalette();
    // Should not show Schedule in Navigation section
    const sections = document.querySelectorAll(".palette-section");
    const hasNav = Array.from(sections).some(s => s.textContent === "Navigation");
    expect(hasNav).toBe(false);
  });
});

// ── Filtering ─────────────────────────────────────────────────────────────────

describe("palette filtering", () => {
  it("shows 'No matches.' when query has no results", () => {
    openPalette("zzzzunmatchable");
    expect(document.getElementById("palette-results")!.innerHTML).toContain("No matches.");
  });

  it("filters results by query — 'settings' shows Open Settings", () => {
    openPalette("settings");
    expect(document.getElementById("palette-results")!.innerHTML).toContain("Open Settings");
  });

  it("subsequence match works for partial queries", () => {
    openPalette("stg");
    // "settings" subsequence-matches "s..t..g"
    expect(document.getElementById("palette-results")!.innerHTML).toContain("Open Settings");
  });
});

// ── bindPalette keyboard ──────────────────────────────────────────────────────

describe("bindPalette keyboard navigation", () => {
  it("ArrowDown moves activeIdx down", () => {
    openPalette();
    bindPalette();
    const input = document.getElementById("palette-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const active = document.querySelector(".palette-item.active");
    expect(Number(active?.getAttribute("data-idx"))).toBe(1);
  });

  it("ArrowUp does not go below 0", () => {
    openPalette();
    bindPalette();
    const input = document.getElementById("palette-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    const active = document.querySelector(".palette-item.active");
    expect(Number(active?.getAttribute("data-idx"))).toBe(0);
  });

  it("Escape closes the palette", () => {
    openPalette();
    bindPalette();
    const input = document.getElementById("palette-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(isPaletteOpen()).toBe(false);
  });

  it("clicking backdrop closes palette", () => {
    openPalette();
    bindPalette();
    const palette = document.getElementById("palette")!;
    palette.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(isPaletteOpen()).toBe(false);
  });

  it("input event filters results", () => {
    openPalette();
    bindPalette();
    const input = document.getElementById("palette-input") as HTMLInputElement;
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    expect(document.getElementById("palette-results")!.innerHTML).toContain("No matches.");
  });

  it("Enter executes active item action", () => {
    openPalette();
    bindPalette();
    const input = document.getElementById("palette-input")!;
    // First item is "Refresh all modules" — no action issue, just test doesn't crash
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(isPaletteOpen()).toBe(false);
  });
});

// ── Content scraping ──────────────────────────────────────────────────────────

describe("content scraping from DOM", () => {
  it("scrapes schedule items into Today's events section", () => {
    document.body.innerHTML += `
      <div id="schedule-body">
        <div class="schedule-item">
          <span class="schedule-title">Team sync</span>
          <span class="schedule-time">10:00 AM</span>
          <span class="schedule-meta"><a href="https://meet.google.com/xxx" target="_blank">Join</a></span>
        </div>
      </div>
    `;
    openPalette();
    expect(document.getElementById("palette-results")!.innerHTML).toContain("Team sync");
  });

  it("scrapes PR items into Pull requests section", () => {
    document.body.innerHTML += `
      <div id="pr-queue-body">
        <div class="schedule-item">
          <a class="schedule-title" href="https://github.com/alice/repo/pull/1">Fix login</a>
          <span class="schedule-time">alice/repo</span>
        </div>
      </div>
    `;
    openPalette();
    expect(document.getElementById("palette-results")!.innerHTML).toContain("Fix login");
  });

  it("scrapes ticket items into Tickets section", () => {
    document.body.innerHTML += `
      <div id="my-tickets-body">
        <div class="schedule-item">
          <a class="schedule-title" href="https://jira.example.com/browse/PROJ-1">Fix login bug</a>
          <span class="schedule-time">PROJ-1</span>
        </div>
      </div>
    `;
    openPalette();
    expect(document.getElementById("palette-results")!.innerHTML).toContain("Fix login bug");
  });

  it("scrapes Slack channels into Channels section", () => {
    document.body.innerHTML += `
      <div id="channels-body">
        <div class="slack-channel">
          <span class="slack-channel-name">engineering</span>
          <a class="slack-channel-link" href="https://slack.com/archives/C123">open</a>
        </div>
      </div>
    `;
    openPalette();
    expect(document.getElementById("palette-results")!.innerHTML).toContain("engineering");
  });

  it("skips channel entries with empty name", () => {
    document.body.innerHTML += `
      <div id="channels-body">
        <div class="slack-channel">
          <span class="slack-channel-name">   </span>
        </div>
      </div>
    `;
    openPalette();
    // Should not throw and should render no channel items for the blank name
    expect(document.getElementById("palette-results")!.innerHTML).not.toContain("open in Slack");
  });
});

// ── jump() action via navigation item ────────────────────────────────────────

describe("jump() via navigation item action", () => {
  it("calls scrollIntoView on the target element when a navigation item is clicked", () => {
    document.body.innerHTML += `
      <div id="section-schedule" style="display:block"></div>
    `;
    const target = document.getElementById("section-schedule")!;
    target.scrollIntoView = vi.fn();

    openPalette();
    bindPalette();

    // filter to get just the navigation items, then click the Schedule one
    const input = document.getElementById("palette-input") as HTMLInputElement;
    input.value = "Schedule";
    input.dispatchEvent(new Event("input"));

    // The first result should now be the "Jump to Schedule" nav entry — click it
    const firstItem = document.querySelector<HTMLElement>(".palette-item");
    firstItem?.click();
    expect(target.scrollIntoView).toHaveBeenCalled();
  });
});

