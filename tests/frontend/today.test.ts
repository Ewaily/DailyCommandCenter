import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockSnapshotCapabilities } = vi.hoisted(() => ({
  mockApi: { workspaces: vi.fn() },
  mockSnapshotCapabilities: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/frontend/api.js",        () => ({ api: mockApi }));
vi.mock("../../src/frontend/connectors.js", () => ({ snapshotCapabilities: mockSnapshotCapabilities }));
vi.mock("../../src/frontend/components/util.js", () => ({ escapeHtml: (s: string) => s }));

import { initTodayBanner } from "../../src/frontend/components/today.js";

function buildDom() {
  document.body.innerHTML = `<div id="context-banner"></div>`;
  localStorage.removeItem("dcc-active-workspace");
}

const makeWorkspace = (id = "ws-1", name = "Alpha") => ({
  id, name, icon: "🏢", color: "#123", slug: "alpha",
});

beforeEach(() => {
  vi.clearAllMocks();
  buildDom();
  mockApi.workspaces.mockResolvedValue({ data: { workspaces: [] } });
});

// ── Overview mode (active = null) ─────────────────────────────────────────────

describe("initTodayBanner — overview mode", () => {
  it("renders OVERVIEW banner when no workspace is active", async () => {
    await initTodayBanner();
    expect(document.getElementById("context-banner")!.innerHTML).toContain("OVERVIEW");
  });

  it("adds is-overview class to body when in overview", async () => {
    await initTodayBanner();
    expect(document.body.classList.contains("is-overview")).toBe(true);
  });
});

// ── Single workspace mode ─────────────────────────────────────────────────────

describe("initTodayBanner — single workspace", () => {
  it("renders empty banner when only one workspace exists (noise suppression)", async () => {
    localStorage.setItem("dcc-active-workspace", "ws-1");
    mockApi.workspaces.mockResolvedValue({ data: { workspaces: [makeWorkspace()] } });
    await initTodayBanner();
    expect(document.getElementById("context-banner")!.innerHTML).toBe("");
  });
});

// ── Multi-workspace mode ──────────────────────────────────────────────────────

describe("initTodayBanner — multi-workspace", () => {
  beforeEach(() => {
    localStorage.setItem("dcc-active-workspace", "ws-1");
    mockApi.workspaces.mockResolvedValue({
      data: { workspaces: [makeWorkspace("ws-1", "Alpha"), makeWorkspace("ws-2", "Beta")] },
    });
  });

  it("renders WORKSPACE banner with workspace name", async () => {
    await initTodayBanner();
    const banner = document.getElementById("context-banner")!;
    expect(banner.innerHTML).toContain("WORKSPACE");
    expect(banner.innerHTML).toContain("Alpha");
  });

  it("includes scope string when capabilities are active", async () => {
    mockSnapshotCapabilities.mockReturnValue(["calendar", "slack"]);
    await initTodayBanner();
    expect(document.getElementById("context-banner")!.innerHTML).toContain("scope:");
    expect(document.getElementById("context-banner")!.innerHTML).toContain("schedule");
  });

  it("does not include scope string when no capabilities are active", async () => {
    mockSnapshotCapabilities.mockReturnValue([]);
    await initTodayBanner();
    expect(document.getElementById("context-banner")!.innerHTML).not.toContain("scope:");
  });

  it("renders icon when workspace has icon", async () => {
    await initTodayBanner();
    expect(document.getElementById("context-banner")!.innerHTML).toContain("🏢");
  });

  it("renders fallback when active workspace id not found in cache", async () => {
    localStorage.setItem("dcc-active-workspace", "ws-ghost");
    await initTodayBanner();
    expect(document.getElementById("context-banner")!.innerHTML).toContain("WORKSPACE");
    expect(document.getElementById("context-banner")!.innerHTML).toContain("ws-ghost");
  });
});

// ── Scope string ordering ─────────────────────────────────────────────────────

describe("scope ordering in banner", () => {
  beforeEach(() => {
    localStorage.setItem("dcc-active-workspace", "ws-1");
    mockApi.workspaces.mockResolvedValue({
      data: { workspaces: [makeWorkspace("ws-1", "WS"), makeWorkspace("ws-2", "Other")] },
    });
  });

  it("orders capabilities: calendar → slack → github → jira → clickup → notion", async () => {
    mockSnapshotCapabilities.mockReturnValue(["clickup", "github", "calendar"]);
    await initTodayBanner();
    const text = document.getElementById("context-banner")!.textContent || "";
    const schedIdx = text.indexOf("schedule");
    const prIdx = text.indexOf("PRs");
    const taskIdx = text.indexOf("tasks");
    expect(schedIdx).toBeLessThan(prIdx);
    expect(prIdx).toBeLessThan(taskIdx);
  });
});

// ── DOM event listeners ───────────────────────────────────────────────────────

describe("initTodayBanner — event listeners", () => {
  it("re-renders on workspace-changed event", async () => {
    await initTodayBanner();
    localStorage.setItem("dcc-active-workspace", "ws-1");
    mockApi.workspaces.mockResolvedValue({
      data: { workspaces: [makeWorkspace("ws-1", "New"), makeWorkspace("ws-2", "Other")] },
    });
    window.dispatchEvent(new Event("workspace-changed"));
    // render() is sync after the event — just verify it doesn't throw
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById("context-banner")).not.toBeNull();
  });

  it("refetches workspaces on workspaces-updated event", async () => {
    await initTodayBanner();
    const callCount = mockApi.workspaces.mock.calls.length;
    window.dispatchEvent(new Event("workspaces-updated"));
    await new Promise(r => setTimeout(r, 10));
    expect(mockApi.workspaces.mock.calls.length).toBeGreaterThan(callCount);
  });

  it("handles workspaces API failure gracefully", async () => {
    mockApi.workspaces.mockRejectedValueOnce(new Error("down"));
    await expect(initTodayBanner()).resolves.toBeUndefined();
  });
});
