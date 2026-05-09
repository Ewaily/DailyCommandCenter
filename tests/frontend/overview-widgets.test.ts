/**
 * Tests for overview-widgets.ts — per-instance dashboard card management.
 * All heavy dependencies are mocked so this runs in happy-dom without real APIs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockGetLoadedConnectors,
  mockPlaceDynamicItem,
  mockUnregisterDynamicItems,
  mockTriggerRepack,
  mockFindSlotForBox,
  mockGetSavedDynamicBox,
  mockPruneDynamicStore,
  mockBoxCollidesWithLayout,
  mockEnsureLayoutLoaded,
  mockPaintIcons,
  mockGetCustomTitleForScope,
  mockSpecForCap,
  mockSpecForType,
  mockInstantiateSchedule,
  mockInstantiatePRs,
  mockInstantiateTickets,
  mockInstantiateClickUp,
  mockInstantiateMentions,
} = vi.hoisted(() => {
  const mockInstance = () => ({ load: vi.fn().mockResolvedValue(undefined) });
  return {
    mockGetLoadedConnectors:  vi.fn().mockReturnValue([]),
    mockPlaceDynamicItem:     vi.fn(),
    mockUnregisterDynamicItems: vi.fn(),
    mockTriggerRepack:        vi.fn(),
    mockFindSlotForBox:       vi.fn().mockReturnValue({ x: 0, y: 0 }),
    mockGetSavedDynamicBox:   vi.fn().mockReturnValue(null),
    mockPruneDynamicStore:    vi.fn(),
    mockBoxCollidesWithLayout: vi.fn().mockReturnValue(false),
    mockEnsureLayoutLoaded:   vi.fn(),
    mockPaintIcons:           vi.fn(),
    mockGetCustomTitleForScope: vi.fn().mockReturnValue(null),
    mockSpecForCap:           vi.fn().mockReturnValue(null),
    mockSpecForType:          vi.fn().mockReturnValue(null),
    mockInstantiateSchedule:  vi.fn().mockReturnValue(mockInstance()),
    mockInstantiatePRs:       vi.fn().mockReturnValue(mockInstance()),
    mockInstantiateTickets:   vi.fn().mockReturnValue(mockInstance()),
    mockInstantiateClickUp:   vi.fn().mockReturnValue(mockInstance()),
    mockInstantiateMentions:  vi.fn().mockReturnValue(mockInstance()),
  };
});

vi.mock("../../src/frontend/api.js", () => ({ api: {}, isAuthError: vi.fn() }));
vi.mock("../../src/frontend/connectors.js", () => ({ getLoadedConnectors: mockGetLoadedConnectors }));
vi.mock("../../src/frontend/components/dashboard.js", () => ({
  placeDynamicItem:      mockPlaceDynamicItem,
  unregisterDynamicItems: mockUnregisterDynamicItems,
  triggerRepack:         mockTriggerRepack,
  findSlotForBox:        mockFindSlotForBox,
  getSavedDynamicBox:    mockGetSavedDynamicBox,
  pruneDynamicStore:     mockPruneDynamicStore,
  boxCollidesWithLayout: mockBoxCollidesWithLayout,
  ensureLayoutLoaded:    mockEnsureLayoutLoaded,
}));
vi.mock("../../src/frontend/components/icons.js",        () => ({ paintIcons: mockPaintIcons }));
vi.mock("../../src/frontend/components/widget-titles.js", () => ({ getCustomTitleForScope: mockGetCustomTitleForScope }));
vi.mock("../../src/frontend/components/instance-card-registry.js", () => ({
  CAPABILITIES: [],
  specForCap:   mockSpecForCap,
  specForType:  mockSpecForType,
}));
vi.mock("../../src/frontend/components/schedule.js",  () => ({ instantiateSchedule: mockInstantiateSchedule }));
vi.mock("../../src/frontend/components/prs.js",       () => ({ instantiatePRs: mockInstantiatePRs }));
vi.mock("../../src/frontend/components/tickets.js",   () => ({ instantiateTickets: mockInstantiateTickets, bindTicketTabs: vi.fn() }));
vi.mock("../../src/frontend/components/clickup.js",   () => ({ instantiateClickUp: mockInstantiateClickUp }));
vi.mock("../../src/frontend/components/mentions.js",  () => ({ instantiateMentions: mockInstantiateMentions }));
vi.mock("../../src/frontend/components/util.js",      () => ({ escapeHtml: (s: string) => s }));

import { clearOverviewWidgets, initOverviewWidgets } from "../../src/frontend/components/overview-widgets.js";

// ── test helpers ──────────────────────────────────────────────────────────────

function buildGrid() {
  document.body.innerHTML = `<div id="dashboard-grid"></div>`;
}

function makeConnector(overrides: Record<string, unknown> = {}) {
  return {
    id:             "ci-1",
    type:           "gcal",
    enabled:        true,
    shared:         false,
    shareWithOverview: true,
    source:         "owned",
    workspaceId:    "ws-1",
    identityId:     "id-1",
    config:         {},
    position:       0,
    ownerWorkspace: { id: "ws-1", name: "Alpha", icon: null, color: null, logoUrl: null, website: null },
    identity:       { account: "user@example.com", label: null, hasToken: true, accessToken: "tok", refreshToken: null, displayColor: null },
    ...overrides,
  };
}

function makeSpec(overrides: Record<string, unknown> = {}) {
  return {
    cap:          "calendar",
    matchTypes:   ["gcal"],
    staticWidgetId: "schedule",
    defaultDims:  { x: 0, y: 0, w: 5, h: 15, minW: 3, minH: 6 },
    icon:         "calendar",
    defaultTitle: "Schedule",
    fetch:        vi.fn().mockResolvedValue({ items: [] }),
    renderItem:   vi.fn().mockReturnValue("<div></div>"),
    empty:        vi.fn().mockReturnValue({ emoji: "✨", title: "Empty" }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  buildGrid();
  mockFindSlotForBox.mockReturnValue({ x: 0, y: 0 });
  mockGetSavedDynamicBox.mockReturnValue(null);
  mockBoxCollidesWithLayout.mockReturnValue(false);
  mockGetCustomTitleForScope.mockReturnValue(null);
  mockSpecForType.mockReturnValue(null);
  mockSpecForCap.mockReturnValue(null);
  mockGetLoadedConnectors.mockReturnValue([]);
});

// ── clearOverviewWidgets ──────────────────────────────────────────────────────

describe("clearOverviewWidgets", () => {
  it("does not throw when there are no injected widgets", () => {
    expect(() => clearOverviewWidgets()).not.toThrow();
  });

  it("calls unregisterDynamicItems", () => {
    clearOverviewWidgets();
    expect(mockUnregisterDynamicItems).toHaveBeenCalled();
  });

  it("removes has-dynamic-overview class from body", () => {
    document.body.classList.add("has-dynamic-overview");
    clearOverviewWidgets();
    expect(document.body.classList.contains("has-dynamic-overview")).toBe(false);
  });

  it("removes hidden attribute from data-ov-hidden elements", () => {
    const el = document.createElement("div");
    el.setAttribute("data-ov-hidden", "1");
    el.setAttribute("hidden", "");
    document.body.appendChild(el);
    clearOverviewWidgets();
    expect(el.hasAttribute("hidden")).toBe(false);
    expect(el.dataset.ovHidden).toBeUndefined();
  });
});

// ── initOverviewWidgets with no multi-instance caps ───────────────────────────

describe("initOverviewWidgets — no multi-connector caps", () => {
  it("does not mount any cards when all caps have ≤1 connector", async () => {
    const conn = makeConnector({ type: "gcal" });
    mockGetLoadedConnectors.mockReturnValue([conn]);
    // specForType returns a spec but only 1 instance → no per-instance cards
    const spec = makeSpec();
    mockSpecForType.mockReturnValue(spec);
    mockSpecForCap.mockReturnValue(spec);

    await initOverviewWidgets();

    // No cards appended to grid
    const injected = document.querySelectorAll(".overview-instance-card");
    expect(injected.length).toBe(0);
    // triggerRepack not called since hasDynamic is false
    expect(mockTriggerRepack).not.toHaveBeenCalled();
  });

  it("returns early when #dashboard-grid is absent", async () => {
    document.body.innerHTML = "";
    mockGetLoadedConnectors.mockReturnValue([makeConnector()]);
    await expect(initOverviewWidgets()).resolves.toBeUndefined();
  });

  it("skips connectors whose type has no registry spec", async () => {
    mockGetLoadedConnectors.mockReturnValue([makeConnector({ type: "unknown-type" })]);
    mockSpecForType.mockReturnValue(null);
    await initOverviewWidgets();
    expect(document.querySelectorAll(".overview-instance-card").length).toBe(0);
  });
});

// ── initOverviewWidgets with 2+ connectors of the same cap ────────────────────

describe("initOverviewWidgets — multi-instance cap", () => {
  function setupTwoCalendarConnectors() {
    const conn1 = makeConnector({ id: "ci-1", type: "gcal" });
    const conn2 = makeConnector({ id: "ci-2", type: "gcal", ownerWorkspace: { id: "ws-2", name: "Beta", icon: null, color: null, logoUrl: null, website: null } });
    mockGetLoadedConnectors.mockReturnValue([conn1, conn2]);
    const spec = makeSpec();
    mockSpecForType.mockReturnValue(spec);
    mockSpecForCap.mockReturnValue(spec);
    return { conn1, conn2, spec };
  }

  it("hides the static widget card", async () => {
    const el = document.createElement("div");
    el.dataset.dashboardItem = "schedule";
    document.getElementById("dashboard-grid")!.appendChild(el);
    setupTwoCalendarConnectors();
    await initOverviewWidgets();
    expect(el.hasAttribute("hidden")).toBe(true);
    expect(el.dataset.ovHidden).toBe("1");
  });

  it("creates one .overview-instance-card per connector", async () => {
    setupTwoCalendarConnectors();
    await initOverviewWidgets();
    expect(document.querySelectorAll(".overview-instance-card").length).toBe(2);
  });

  it("calls the mounter (instantiateSchedule) with the connector id", async () => {
    setupTwoCalendarConnectors();
    await initOverviewWidgets();
    expect(mockInstantiateSchedule).toHaveBeenCalledTimes(2);
    expect(mockInstantiateSchedule).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ci-1",
      expect.objectContaining({ wsName: expect.any(String) }),
    );
  });

  it("calls placeDynamicItem for each instance", async () => {
    setupTwoCalendarConnectors();
    await initOverviewWidgets();
    expect(mockPlaceDynamicItem).toHaveBeenCalledTimes(2);
  });

  it("adds has-dynamic-overview class to body", async () => {
    setupTwoCalendarConnectors();
    await initOverviewWidgets();
    expect(document.body.classList.contains("has-dynamic-overview")).toBe(true);
  });

  it("calls triggerRepack and paintIcons after mounting", async () => {
    setupTwoCalendarConnectors();
    await initOverviewWidgets();
    expect(mockTriggerRepack).toHaveBeenCalled();
    expect(mockPaintIcons).toHaveBeenCalled();
  });

  it("uses saved box position when one exists and does not collide", async () => {
    setupTwoCalendarConnectors();
    mockGetSavedDynamicBox.mockReturnValue({ x: 3, y: 5, w: 5, h: 15 });
    mockBoxCollidesWithLayout.mockReturnValue(false);
    await initOverviewWidgets();
    // placeDynamicItem called with the saved x,y
    expect(mockPlaceDynamicItem).toHaveBeenCalledWith(
      "ov-ci-1",
      expect.objectContaining({ x: 3, y: 5 }),
    );
  });

  it("falls back to findSlotForBox when saved box collides", async () => {
    setupTwoCalendarConnectors();
    mockGetSavedDynamicBox.mockReturnValue({ x: 0, y: 0, w: 5, h: 15 });
    mockBoxCollidesWithLayout.mockReturnValue(true); // collision!
    mockFindSlotForBox.mockReturnValue({ x: 7, y: 0 });
    await initOverviewWidgets();
    // Should use slot from findSlotForBox
    expect(mockPlaceDynamicItem).toHaveBeenCalledWith(
      "ov-ci-1",
      expect.objectContaining({ x: 7, y: 0 }),
    );
  });

  it("clearOverviewWidgets removes the injected cards", async () => {
    setupTwoCalendarConnectors();
    await initOverviewWidgets();
    expect(document.querySelectorAll(".overview-instance-card").length).toBe(2);
    clearOverviewWidgets();
    expect(document.querySelectorAll(".overview-instance-card").length).toBe(0);
  });

  it("pruneDynamicStore is called with the set of live item ids", async () => {
    setupTwoCalendarConnectors();
    await initOverviewWidgets();
    expect(mockPruneDynamicStore).toHaveBeenCalledWith(["ov-ci-1", "ov-ci-2"]);
  });
});

// ── buildSourceLabel helper paths (via wsName in mounter call) ────────────────

describe("buildSourceLabel via initOverviewWidgets", () => {
  function setupTwoWithIdentity(conn1Overrides: Record<string, unknown>, conn2Overrides: Record<string, unknown>) {
    mockGetLoadedConnectors.mockReturnValue([
      makeConnector({ id: "ci-1", type: "gcal", ...conn1Overrides }),
      makeConnector({ id: "ci-2", type: "gcal", ...conn2Overrides }),
    ]);
    const spec = makeSpec();
    mockSpecForType.mockReturnValue(spec);
    mockSpecForCap.mockReturnValue(spec);
  }

  it("uses 'workspace · account' format when both differ", async () => {
    setupTwoWithIdentity(
      { ownerWorkspace: { id: "ws-1", name: "Alpha", icon: null, color: null, logoUrl: null, website: null }, identity: { account: "user@alpha.com", label: null, hasToken: true, accessToken: "", refreshToken: null, displayColor: null } },
      { ownerWorkspace: { id: "ws-2", name: "Beta",  icon: null, color: null, logoUrl: null, website: null }, identity: { account: "user@beta.com",  label: null, hasToken: true, accessToken: "", refreshToken: null, displayColor: null } },
    );
    await initOverviewWidgets();
    // Mounter should have been called with wsName "Alpha · user@alpha.com"
    expect(mockInstantiateSchedule).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ci-1",
      expect.objectContaining({ wsName: "Alpha · user@alpha.com" }),
    );
  });

  it("uses workspace name alone when account matches workspace name (case-insensitive)", async () => {
    setupTwoWithIdentity(
      { ownerWorkspace: { id: "ws-1", name: "Alpha", icon: null, color: null, logoUrl: null, website: null }, identity: { account: "Alpha", label: null, hasToken: true, accessToken: "", refreshToken: null, displayColor: null } },
      { ownerWorkspace: { id: "ws-2", name: "Beta",  icon: null, color: null, logoUrl: null, website: null }, identity: { account: "beta@test.com",  label: null, hasToken: true, accessToken: "", refreshToken: null, displayColor: null } },
    );
    await initOverviewWidgets();
    expect(mockInstantiateSchedule).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ci-1",
      expect.objectContaining({ wsName: "Alpha" }),
    );
  });

  it("falls back to '—' when both owner and account are missing", async () => {
    setupTwoWithIdentity(
      { ownerWorkspace: null, identity: { account: "", label: null, hasToken: true, accessToken: "", refreshToken: null, displayColor: null } },
      { ownerWorkspace: null, identity: { account: "", label: null, hasToken: true, accessToken: "", refreshToken: null, displayColor: null } },
    );
    await initOverviewWidgets();
    expect(mockInstantiateSchedule).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ci-1",
      expect.objectContaining({ wsName: "—" }),
    );
  });
});

// ── resolveInstanceTitle helper ───────────────────────────────────────────────

describe("resolveInstanceTitle via initOverviewWidgets", () => {
  it("returns custom title from owner workspace when one exists", async () => {
    mockGetLoadedConnectors.mockReturnValue([
      makeConnector({ id: "ci-1", type: "gcal" }),
      makeConnector({ id: "ci-2", type: "gcal" }),
    ]);
    const spec = makeSpec({ defaultTitle: "Schedule" });
    mockSpecForType.mockReturnValue(spec);
    mockSpecForCap.mockReturnValue(spec);
    mockGetCustomTitleForScope.mockReturnValue("My Custom Schedule");

    await initOverviewWidgets();
    expect(mockInstantiateSchedule).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ci-1",
      expect.objectContaining({ title: "My Custom Schedule" }),
    );
  });

  it("returns defaultTitle when no custom title exists", async () => {
    mockGetLoadedConnectors.mockReturnValue([
      makeConnector({ id: "ci-1", type: "gcal" }),
      makeConnector({ id: "ci-2", type: "gcal" }),
    ]);
    const spec = makeSpec({ defaultTitle: "Schedule" });
    mockSpecForType.mockReturnValue(spec);
    mockSpecForCap.mockReturnValue(spec);
    mockGetCustomTitleForScope.mockReturnValue(null);

    await initOverviewWidgets();
    expect(mockInstantiateSchedule).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      "ci-1",
      expect.objectContaining({ title: "Schedule" }),
    );
  });
});

// ── CAPABILITIES re-export ────────────────────────────────────────────────────

describe("CAPABILITIES re-export", () => {
  it("is an array (from instance-card-registry mock)", async () => {
    const { CAPABILITIES } = await import("../../src/frontend/components/overview-widgets.js");
    expect(Array.isArray(CAPABILITIES)).toBe(true);
  });
});
