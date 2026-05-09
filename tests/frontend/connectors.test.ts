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
});
