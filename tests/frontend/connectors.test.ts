import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockGetActiveWs, mockRenderCluster } = vi.hoisted(() => ({
  mockApi: {
    workspace:  vi.fn(),
    connectors: vi.fn(),
  },
  mockGetActiveWs:  vi.fn(),
  mockRenderCluster: vi.fn().mockReturnValue("<span></span>"),
}));

vi.mock("../../src/frontend/api.js",                               () => ({ api: mockApi }));
vi.mock("../../src/frontend/components/workspace-switcher.js",     () => ({ getActiveWorkspaceId: mockGetActiveWs }));
vi.mock("../../src/frontend/components/workspace-logo.js",         () => ({ renderWorkspaceCluster: mockRenderCluster }));

import {
  hasCapability,
  hasAnyCapability,
  loadConnectors,
  applyConnectorVisibility,
  isConnectorsLoaded,
  getLoadedConnectors,
  snapshotCapabilities,
  getContributors,
  getContributorEntries,
  hasSharedContributor,
} from "../../src/frontend/connectors.js";

const ownerWs = { id: "ws-1", name: "Workspace 1", icon: null, color: null, logoUrl: null, website: null };

const connector = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  type: "gcal",
  enabled: true,
  identityId: "id-1",
  workspaceId: "ws-1",
  source: "owned",
  shareWithOverview: false,
  enabledForThisWorkspace: true,
  ownerWorkspace: ownerWs,
  config: {},
  identity: { hasToken: true, account: "me@test.com", label: null, displayColor: null },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWs.mockReturnValue("ws-1");
  mockApi.workspace.mockResolvedValue({ data: { connectors: [] } });
  mockApi.connectors.mockResolvedValue({ data: [] });
  window.dispatchEvent = vi.fn();
});

describe("hasCapability / hasAnyCapability", () => {
  it("returns false before any connectors are loaded", () => {
    expect(hasCapability("calendar")).toBe(false);
    expect(hasAnyCapability(["calendar", "slack"])).toBe(false);
  });

  it("returns true after loading a connector with matching type", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ type: "gcal" })] } });
    await loadConnectors();
    expect(hasCapability("calendar")).toBe(true);
  });

  it("hasAnyCapability returns true when at least one cap matches", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ type: "slack" })] } });
    await loadConnectors();
    expect(hasAnyCapability(["calendar", "slack"])).toBe(true);
    expect(hasAnyCapability(["github"])).toBe(false);
  });
});

describe("loadConnectors", () => {
  it("uses workspace API when workspace is active", async () => {
    mockGetActiveWs.mockReturnValue("ws-1");
    await loadConnectors();
    expect(mockApi.workspace).toHaveBeenCalledWith("ws-1");
  });

  it("uses connectors API when no workspace is active (overview)", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    await loadConnectors();
    expect(mockApi.connectors).toHaveBeenCalled();
    expect(mockApi.workspace).not.toHaveBeenCalled();
  });

  it("excludes disabled connectors", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ enabled: false })] } });
    await loadConnectors();
    expect(hasCapability("calendar")).toBe(false);
  });

  it("excludes connectors without hasToken", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ identity: { hasToken: false } })] } });
    await loadConnectors();
    expect(hasCapability("calendar")).toBe(false);
  });

  it("excludes overview connectors that don't have shareWithOverview", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    mockApi.connectors.mockResolvedValue({ data: [connector({ shareWithOverview: false })] });
    await loadConnectors();
    expect(hasCapability("calendar")).toBe(false);
  });

  it("includes overview connectors that have shareWithOverview=true", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    mockApi.connectors.mockResolvedValue({ data: [connector({ shareWithOverview: true })] });
    await loadConnectors();
    expect(hasCapability("calendar")).toBe(true);
  });

  it("excludes shared connectors not enabled for this workspace", async () => {
    mockApi.workspace.mockResolvedValue({
      data: { connectors: [connector({ source: "shared", enabledForThisWorkspace: false })] },
    });
    await loadConnectors();
    expect(hasCapability("calendar")).toBe(false);
  });

  it("does not crash and keeps prior state when API rejects", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ type: "slack" })] } });
    await loadConnectors();
    expect(hasCapability("slack")).toBe(true);

    mockApi.workspace.mockRejectedValueOnce(new Error("network"));
    await loadConnectors();
    expect(hasCapability("slack")).toBe(true); // preserved
  });

  it("sets isConnectorsLoaded to true after first successful load", async () => {
    await loadConnectors();
    expect(isConnectorsLoaded()).toBe(true);
  });

  it("dispatches connectors-changed event after load", async () => {
    await loadConnectors();
    expect(window.dispatchEvent).toHaveBeenCalled();
  });

  it("populates getLoadedConnectors with usable connectors", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ id: "c99", type: "github" })] } });
    await loadConnectors();
    const loaded = getLoadedConnectors();
    expect(loaded.some(c => c.id === "c99")).toBe(true);
  });

  it("snapshotCapabilities returns current caps as array", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ type: "jira" })] } });
    await loadConnectors();
    expect(snapshotCapabilities()).toContain("jira");
  });
});

describe("applyConnectorVisibility", () => {
  it("hides elements whose required capability is not connected", async () => {
    await loadConnectors(); // no connectors → calendar not connected
    document.body.innerHTML = `<div data-requires-connector="calendar">card</div>`;
    applyConnectorVisibility();
    const el = document.querySelector("[data-requires-connector]")!;
    expect(el.hasAttribute("hidden")).toBe(true);
  });

  it("shows elements whose required capability is connected", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ type: "gcal" })] } });
    await loadConnectors();
    document.body.innerHTML = `<div data-requires-connector="calendar">card</div>`;
    applyConnectorVisibility();
    const el = document.querySelector("[data-requires-connector]")!;
    expect(el.hasAttribute("hidden")).toBe(false);
  });

  it("shows elements with no data-requires-connector value", async () => {
    document.body.innerHTML = `<div data-requires-connector="">always</div>`;
    applyConnectorVisibility();
    const el = document.querySelector("[data-requires-connector]")!;
    expect(el.hasAttribute("hidden")).toBe(false);
  });

  it("shows workspace empty state when no connectors in workspace mode", async () => {
    mockGetActiveWs.mockReturnValue("ws-1");
    mockApi.workspace.mockResolvedValue({ data: { connectors: [] } });
    await loadConnectors();
    document.body.innerHTML = `
      <div id="workspace-empty" hidden>
        <span class="workspace-empty-title"></span>
        <span class="workspace-empty-desc"></span>
        <button class="btn-primary"></button>
      </div>
    `;
    applyConnectorVisibility();
    const el = document.getElementById("workspace-empty")!;
    expect(el.hasAttribute("hidden")).toBe(false);
    expect(el.querySelector(".workspace-empty-title")!.textContent).toBe("No tools connected yet");
    expect(el.querySelector(".btn-primary")!.textContent).toBe("Open Settings → Workspaces");
  });

  it("shows overview empty state when no connectors in overview mode", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    mockApi.connectors.mockResolvedValue({ data: [] });
    await loadConnectors();
    document.body.innerHTML = `
      <div id="workspace-empty" hidden>
        <span class="workspace-empty-title"></span>
        <span class="workspace-empty-desc"></span>
        <button class="btn-primary"></button>
      </div>
    `;
    applyConnectorVisibility();
    const el = document.getElementById("workspace-empty")!;
    expect(el.hasAttribute("hidden")).toBe(false);
    expect(el.classList.contains("workspace-empty--overview")).toBe(true);
    expect(el.querySelector(".workspace-empty-title")!.textContent).toBe("Overview is empty");
  });

  it("hides empty state when connectors are present", async () => {
    mockApi.workspace.mockResolvedValue({ data: { connectors: [connector({ type: "gcal" })] } });
    await loadConnectors();
    document.body.innerHTML = `
      <div id="workspace-empty">
        <span class="workspace-empty-title"></span>
        <span class="workspace-empty-desc"></span>
        <button class="btn-primary"></button>
      </div>
    `;
    applyConnectorVisibility();
    expect(document.getElementById("workspace-empty")!.hasAttribute("hidden")).toBe(true);
  });

  it("hides/shows grid elements alongside the empty state", async () => {
    mockGetActiveWs.mockReturnValue("ws-1");
    mockApi.workspace.mockResolvedValue({ data: { connectors: [] } });
    await loadConnectors();
    document.body.innerHTML = `
      <div id="workspace-empty" hidden></div>
      <div class="dashboard-grid"></div>
    `;
    applyConnectorVisibility();
    expect(document.querySelector(".dashboard-grid")!.hasAttribute("hidden")).toBe(true);
  });
});

describe("applyProvenance (via applyConnectorVisibility)", () => {
  function makeCardDOM(cap: string) {
    document.body.innerHTML = `
      <div data-requires-connector="${cap}">
        <div class="card-header">
          <div class="title-row"></div>
        </div>
      </div>
    `;
  }

  it("appends workspace cluster to card header in overview mode when connector has ownerWorkspace", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    mockRenderCluster.mockReturnValue('<span class="ws-logo-cluster">cluster</span>');
    mockApi.connectors.mockResolvedValue({
      data: [connector({ type: "gcal", shareWithOverview: true, source: "owned" })],
    });
    await loadConnectors();
    makeCardDOM("calendar");
    applyConnectorVisibility();
    expect(mockRenderCluster).toHaveBeenCalled();
    expect(document.querySelector(".title-row")!.innerHTML).toContain("ws-logo-cluster");
  });

  it("appends shared-only badge in workspace mode for shared connectors", async () => {
    mockGetActiveWs.mockReturnValue("ws-1");
    mockRenderCluster.mockReturnValue('<span class="ws-logo-cluster">cluster</span>');
    mockApi.workspace.mockResolvedValue({
      data: {
        connectors: [connector({ type: "gcal", source: "shared", enabledForThisWorkspace: true })],
      },
    });
    await loadConnectors();
    makeCardDOM("calendar");
    applyConnectorVisibility();
    expect(mockRenderCluster).toHaveBeenCalled();
    const cluster = document.querySelector(".ws-logo-cluster") as HTMLElement | null;
    expect(cluster).not.toBeNull();
    expect(cluster!.classList.contains("ws-logo-cluster--shared")).toBe(true);
  });

  it("does not append badge in workspace mode for owned-only contributors", async () => {
    mockGetActiveWs.mockReturnValue("ws-1");
    mockApi.workspace.mockResolvedValue({
      data: { connectors: [connector({ type: "gcal", source: "owned" })] },
    });
    await loadConnectors();
    makeCardDOM("calendar");
    applyConnectorVisibility();
    expect(document.querySelector(".ws-logo-cluster")).toBeNull();
  });

  it("skips card if .card-header .title-row is absent", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    mockApi.connectors.mockResolvedValue({
      data: [connector({ type: "gcal", shareWithOverview: true })],
    });
    await loadConnectors();
    document.body.innerHTML = `<div data-requires-connector="calendar"></div>`;
    expect(() => applyConnectorVisibility()).not.toThrow();
  });
});

// ── getContributors / getContributorEntries / hasSharedContributor ─────────────

describe("getContributors / getContributorEntries / hasSharedContributor", () => {
  const ownerWsObj = { id: "ws-owner", name: "Owner WS", icon: null, color: "#111", logoUrl: null, website: null };

  beforeEach(async () => {
    mockGetActiveWs.mockReturnValue("ws-1");
    mockApi.workspace.mockResolvedValue({
      data: {
        connectors: [
          connector({
            type: "gcal",
            source: "owned",
            ownerWorkspace: ownerWsObj,
          }),
        ],
      },
    });
    await loadConnectors();
  });

  it("getContributors returns workspace list for a capability", () => {
    const ws = getContributors("calendar");
    expect(ws).toHaveLength(1);
    expect(ws[0].id).toBe("ws-owner");
  });

  it("getContributors returns [] for unconfigured capability", () => {
    expect(getContributors("slack")).toEqual([]);
  });

  it("getContributorEntries returns entries with source field", () => {
    const entries = getContributorEntries("calendar");
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("owned");
    expect(entries[0].ws.id).toBe("ws-owner");
  });

  it("hasSharedContributor returns false when all owned", () => {
    expect(hasSharedContributor("calendar")).toBe(false);
  });

  it("hasSharedContributor returns true when a shared connector contributes", async () => {
    mockApi.workspace.mockResolvedValue({
      data: {
        connectors: [
          connector({
            type: "slack",
            source: "shared",
            enabledForThisWorkspace: true,
            ownerWorkspace: ownerWsObj,
          }),
        ],
      },
    });
    await loadConnectors();
    expect(hasSharedContributor("slack")).toBe(true);
  });
});
