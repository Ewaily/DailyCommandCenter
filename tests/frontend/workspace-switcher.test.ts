import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApiWorkspaces, mockRenderWorkspaceBadge } = vi.hoisted(() => ({
  mockApiWorkspaces: vi.fn(),
  mockRenderWorkspaceBadge: vi.fn().mockReturnValue('<span class="ws-badge">WS</span>'),
}));

vi.mock("../../src/frontend/api.js", () => ({ api: { workspaces: mockApiWorkspaces } }));
vi.mock("../../src/frontend/components/workspace-logo.js", () => ({
  renderWorkspaceBadge: mockRenderWorkspaceBadge,
}));
vi.mock("../../src/frontend/components/util.js", () => ({
  escapeHtml: (s: string) => s,
}));

import {
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  listWorkspaces,
  initWorkspaceSwitcher,
  refreshActiveWorkspace,
} from "../../src/frontend/components/workspace-switcher.js";

const makeWorkspace = (overrides = {}) => ({
  id: "ws-1",
  name: "Alpha",
  icon: "🏢",
  color: "#111",
  website: null,
  logoUrl: null,
  ...overrides,
});

function buildDom() {
  document.body.innerHTML = `<div id="workspace-switcher"></div>`;
}

beforeEach(() => {
  vi.clearAllMocks();
  buildDom();
  // Reset to null by clearing localStorage
  localStorage.clear();
  // Reset module state via setActiveWorkspaceId
  setActiveWorkspaceId(null);
  mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [] } });
});

// ── getActiveWorkspaceId / setActiveWorkspaceId ───────────────────────────────

describe("getActiveWorkspaceId / setActiveWorkspaceId", () => {
  it("starts as null after clear", () => {
    expect(getActiveWorkspaceId()).toBeNull();
  });

  it("set stores the id and returns it", () => {
    setActiveWorkspaceId("ws-abc");
    expect(getActiveWorkspaceId()).toBe("ws-abc");
  });

  it("set null removes from localStorage", () => {
    setActiveWorkspaceId("ws-abc");
    setActiveWorkspaceId(null);
    expect(localStorage.getItem("dcc-active-workspace")).toBeNull();
  });

  it("set non-null persists to localStorage", () => {
    setActiveWorkspaceId("ws-xyz");
    expect(localStorage.getItem("dcc-active-workspace")).toBe("ws-xyz");
  });

  it("dispatches workspace-changed event", () => {
    const handler = vi.fn();
    window.addEventListener("workspace-changed", handler);
    setActiveWorkspaceId("ws-event");
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ workspaceId: "ws-event" });
    window.removeEventListener("workspace-changed", handler);
  });
});

// ── listWorkspaces ────────────────────────────────────────────────────────────

describe("listWorkspaces", () => {
  it("starts empty", async () => {
    expect(listWorkspaces()).toEqual([]);
  });

  it("returns workspaces after init", async () => {
    mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [makeWorkspace()] } });
    await initWorkspaceSwitcher();
    expect(listWorkspaces()).toHaveLength(1);
    expect(listWorkspaces()[0].id).toBe("ws-1");
  });
});

// ── initWorkspaceSwitcher ─────────────────────────────────────────────────────

describe("initWorkspaceSwitcher", () => {
  it("calls api.workspaces", async () => {
    await initWorkspaceSwitcher();
    expect(mockApiWorkspaces).toHaveBeenCalledOnce();
  });

  it("renders single workspace as pill (no dropdown)", async () => {
    mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [makeWorkspace()] } });
    await initWorkspaceSwitcher();
    expect(document.getElementById("workspace-switcher")!.innerHTML).toContain("ws-switcher-pill");
  });

  it("auto-selects single workspace when active is null", async () => {
    mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [makeWorkspace({ id: "ws-auto" })] } });
    await initWorkspaceSwitcher();
    expect(getActiveWorkspaceId()).toBe("ws-auto");
  });

  it("renders dropdown button for multiple workspaces", async () => {
    mockApiWorkspaces.mockResolvedValue({
      data: { workspaces: [makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2", name: "Beta" })] },
    });
    await initWorkspaceSwitcher();
    expect(document.getElementById("workspace-switcher")!.innerHTML).toContain("ws-switcher-btn");
  });

  it("does not crash when API rejects", async () => {
    mockApiWorkspaces.mockRejectedValueOnce(new Error("down"));
    await expect(initWorkspaceSwitcher()).resolves.toBeUndefined();
  });

  it("renders empty switcher on API error", async () => {
    mockApiWorkspaces.mockRejectedValueOnce(new Error("down"));
    await initWorkspaceSwitcher();
    expect(document.getElementById("workspace-switcher")).toBeTruthy();
  });
});

// ── refreshActiveWorkspace ────────────────────────────────────────────────────

describe("refreshActiveWorkspace", () => {
  it("updates workspace list on refresh", async () => {
    mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [makeWorkspace({ id: "ws-new" })] } });
    await refreshActiveWorkspace();
    expect(listWorkspaces()[0].id).toBe("ws-new");
  });

  it("dispatches workspaces-updated event", async () => {
    const handler = vi.fn();
    window.addEventListener("workspaces-updated", handler);
    mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [makeWorkspace()] } });
    await refreshActiveWorkspace();
    expect(handler).toHaveBeenCalled();
    window.removeEventListener("workspaces-updated", handler);
  });

  it("clears active id when active workspace no longer in list", async () => {
    setActiveWorkspaceId("ws-gone");
    mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [makeWorkspace({ id: "ws-other" })] } });
    await refreshActiveWorkspace();
    expect(getActiveWorkspaceId()).not.toBe("ws-gone");
  });

  it("auto-selects when refresh leaves one workspace and active is null", async () => {
    // Start with null active
    setActiveWorkspaceId(null);
    mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [makeWorkspace({ id: "ws-solo" })] } });
    await refreshActiveWorkspace();
    expect(getActiveWorkspaceId()).toBe("ws-solo");
  });

  it("does not crash when API rejects", async () => {
    mockApiWorkspaces.mockRejectedValueOnce(new Error("offline"));
    await expect(refreshActiveWorkspace()).resolves.toBeUndefined();
  });

  it("renders multi-workspace dropdown after refresh", async () => {
    mockApiWorkspaces.mockResolvedValue({
      data: { workspaces: [makeWorkspace({ id: "ws-a" }), makeWorkspace({ id: "ws-b", name: "B" })] },
    });
    await refreshActiveWorkspace();
    expect(document.getElementById("workspace-switcher")!.innerHTML).toContain("ws-switcher-btn");
  });
});

// ── DOM rendering details ─────────────────────────────────────────────────────

describe("render DOM details", () => {
  it("overview state renders ✦ glyph when active is null", async () => {
    setActiveWorkspaceId(null);
    mockApiWorkspaces.mockResolvedValue({
      data: { workspaces: [makeWorkspace({ id: "a" }), makeWorkspace({ id: "b", name: "B" })] },
    });
    await initWorkspaceSwitcher();
    expect(document.getElementById("workspace-switcher")!.innerHTML).toContain("✦");
  });

  it("renders workspace name as label text", async () => {
    setActiveWorkspaceId("ws-1");
    mockApiWorkspaces.mockResolvedValue({
      data: { workspaces: [makeWorkspace(), makeWorkspace({ id: "ws-2", name: "Beta" })] },
    });
    await refreshActiveWorkspace();
    expect(document.getElementById("workspace-switcher")!.innerHTML).toContain("Alpha");
  });

  it("gracefully handles missing #workspace-switcher element", async () => {
    document.body.innerHTML = "";
    mockApiWorkspaces.mockResolvedValue({ data: { workspaces: [] } });
    await expect(initWorkspaceSwitcher()).resolves.toBeUndefined();
  });
});

// ── btn click + menu item selection ──────────────────────────────────────────

describe("workspace switcher menu interactions", () => {
  async function setupMultiWs() {
    mockApiWorkspaces.mockResolvedValue({
      data: { workspaces: [makeWorkspace({ id: "ws-1" }), makeWorkspace({ id: "ws-2", name: "Beta" })] },
    });
    await initWorkspaceSwitcher();
    return {
      btn: document.getElementById("ws-switcher-btn") as HTMLButtonElement,
      menu: document.getElementById("ws-switcher-menu") as HTMLElement,
    };
  }

  it("clicking btn opens the menu", async () => {
    const { btn, menu } = await setupMultiWs();
    btn.click();
    expect(menu.hasAttribute("hidden")).toBe(false);
  });

  it("clicking btn twice closes the menu", async () => {
    const { btn, menu } = await setupMultiWs();
    btn.click(); // open
    btn.click(); // close
    expect(menu.hasAttribute("hidden")).toBe(true);
  });

  it("clicking a workspace menu item switches the active workspace", async () => {
    const { btn, menu } = await setupMultiWs();
    btn.click(); // open
    const item = menu.querySelector<HTMLElement>('[data-ws-id="ws-2"]')!;
    item.click();
    expect(getActiveWorkspaceId()).toBe("ws-2");
  });

  it("clicking the overview menu item sets active to null", async () => {
    setActiveWorkspaceId("ws-1");
    const { btn, menu } = await setupMultiWs();
    btn.click();
    const item = menu.querySelector<HTMLElement>('[data-ws-id=""]')!;
    item.click();
    expect(getActiveWorkspaceId()).toBeNull();
  });
});
