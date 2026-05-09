import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockIsAuthError, mockHasCapability } = vi.hoisted(() => ({
  mockApi: {
    calendarEvents: vi.fn(),
    mentions:       vi.fn(),
  },
  mockIsAuthError:    vi.fn().mockReturnValue(false),
  mockHasCapability:  vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/frontend/api.js",        () => ({ api: mockApi, isAuthError: mockIsAuthError }));
vi.mock("../../src/frontend/connectors.js", () => ({ hasCapability: mockHasCapability }));
vi.mock("../../src/frontend/components/util.js", () => ({
  escapeHtml:    (s: string) => s,
  fmtDateTime:   (s: string) => s,
  stripFwdPrefix: (s: string) => s,
}));

import {
  openSidebar,
  closeSidebar,
  toggleSidebar,
  initSidebar,
  loadSidebar,
} from "../../src/frontend/components/sidebar.js";

function buildDom() {
  document.body.className = "";
  document.body.innerHTML = `
    <div id="universal-sidebar">
      <button data-action="sidebar-close">✕</button>
    </div>
    <div id="sidebar-events"></div>
    <div id="sidebar-mentions"></div>
  `;
}

const makeEvent = (overrides = {}) => ({
  id: "evt-1", title: "Standup", start: new Date(Date.now() + 3600000).toISOString(),
  end: new Date(Date.now() + 5400000).toISOString(), htmlLink: "https://cal.example.com",
  responseStatus: "accepted", isAllDay: false, sourceColor: "#0066cc",
  ...overrides,
});

const makeMention = (overrides = {}) => ({
  channelId: "C1", channelName: "general", ts: "1000.000",
  authorName: "Alice", text: "Hello @me", permalink: "https://slack.com/archives/C1/p1000",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  buildDom();
  localStorage.removeItem("dcc-sidebar-open");
  mockApi.calendarEvents.mockResolvedValue({ data: [] });
  mockApi.mentions.mockResolvedValue({ data: [] });
});

// ── open / close / toggle ─────────────────────────────────────────────────────

describe("openSidebar / closeSidebar / toggleSidebar", () => {
  it("openSidebar adds sidebar-open class to body", async () => {
    await openSidebar();
    expect(document.body.classList.contains("sidebar-open")).toBe(true);
  });

  it("openSidebar sets localStorage key", async () => {
    await openSidebar();
    expect(localStorage.getItem("dcc-sidebar-open")).toBe("1");
  });

  it("closeSidebar removes sidebar-open class", async () => {
    await openSidebar();
    closeSidebar();
    expect(document.body.classList.contains("sidebar-open")).toBe(false);
  });

  it("closeSidebar removes localStorage key", async () => {
    await openSidebar();
    closeSidebar();
    expect(localStorage.getItem("dcc-sidebar-open")).toBeNull();
  });

  it("toggleSidebar opens when closed", async () => {
    await toggleSidebar();
    expect(document.body.classList.contains("sidebar-open")).toBe(true);
  });

  it("toggleSidebar closes when open", async () => {
    await openSidebar();
    closeSidebar();
    // Now it's closed; toggle should open
    await toggleSidebar();
    expect(document.body.classList.contains("sidebar-open")).toBe(true);
  });
});

// ── initSidebar ───────────────────────────────────────────────────────────────

describe("initSidebar", () => {
  it("opens sidebar automatically when localStorage key is set", async () => {
    localStorage.setItem("dcc-sidebar-open", "1");
    await initSidebar();
    expect(document.body.classList.contains("sidebar-open")).toBe(true);
  });

  it("does NOT open sidebar when localStorage key is absent", async () => {
    await initSidebar();
    expect(document.body.classList.contains("sidebar-open")).toBe(false);
  });

  it("sidebar-close button calls closeSidebar on click", async () => {
    localStorage.setItem("dcc-sidebar-open", "1");
    await initSidebar();
    document.querySelector<HTMLElement>("[data-action='sidebar-close']")!.click();
    expect(document.body.classList.contains("sidebar-open")).toBe(false);
  });

  it("calls loadSidebar on workspace-changed event when open", async () => {
    await openSidebar();
    mockHasCapability.mockReturnValue(true);
    mockApi.calendarEvents.mockResolvedValue({ data: [makeEvent()] });
    await initSidebar();
    window.dispatchEvent(new Event("workspace-changed"));
    await new Promise(r => setTimeout(r, 10));
    expect(mockApi.calendarEvents).toHaveBeenCalled();
  });
});

// ── loadSidebar / calendar slot ───────────────────────────────────────────────

describe("loadSidebar — calendar", () => {
  beforeEach(() => { document.body.classList.add("sidebar-open"); });

  it("does not load when sidebar is closed", async () => {
    document.body.classList.remove("sidebar-open");
    await loadSidebar();
    expect(mockApi.calendarEvents).not.toHaveBeenCalled();
  });

  it("renders upcoming events when calendar is connected", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    mockApi.calendarEvents.mockResolvedValue({ data: [makeEvent()] });
    await loadSidebar();
    expect(document.getElementById("sidebar-events")!.innerHTML).toContain("Standup");
  });

  it("shows empty state when no upcoming events", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    mockApi.calendarEvents.mockResolvedValue({ data: [] });
    await loadSidebar();
    expect(document.getElementById("sidebar-events")!.textContent).toContain("Nothing upcoming");
  });

  it("filters out declined events", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    mockApi.calendarEvents.mockResolvedValue({ data: [makeEvent({ responseStatus: "declined" })] });
    await loadSidebar();
    expect(document.getElementById("sidebar-events")!.textContent).toContain("Nothing upcoming");
  });

  it("filters out past events", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    mockApi.calendarEvents.mockResolvedValue({
      data: [makeEvent({ end: new Date(Date.now() - 3600000).toISOString() })],
    });
    await loadSidebar();
    expect(document.getElementById("sidebar-events")!.textContent).toContain("Nothing upcoming");
  });

  it("limits to 3 events", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    const events = Array.from({ length: 5 }, (_, i) => makeEvent({ id: `e${i}`, title: `Event ${i}` }));
    mockApi.calendarEvents.mockResolvedValue({ data: events });
    await loadSidebar();
    const links = document.querySelectorAll("#sidebar-events .sidebar-event");
    expect(links.length).toBe(3);
  });

  it("shows auth error message when isAuthError returns true", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    mockApi.calendarEvents.mockRejectedValueOnce(new Error("Unauthorized"));
    mockIsAuthError.mockReturnValue(true);
    await loadSidebar();
    expect(document.getElementById("sidebar-events")!.textContent).toContain("not connected");
  });

  it("shows generic error message on non-auth failure", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    mockApi.calendarEvents.mockRejectedValueOnce(new Error("Timeout"));
    mockIsAuthError.mockReturnValue(false);
    await loadSidebar();
    expect(document.getElementById("sidebar-events")!.textContent).toContain("Timeout");
  });

  it("renders source-color stripe when event has sourceColor", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    mockApi.calendarEvents.mockResolvedValue({ data: [makeEvent({ sourceColor: "#abc" })] });
    await loadSidebar();
    expect(document.getElementById("sidebar-events")!.innerHTML).toContain("has-source-stripe");
  });

  it("renders All day for all-day events", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "calendar");
    mockApi.calendarEvents.mockResolvedValue({ data: [makeEvent({ isAllDay: true })] });
    await loadSidebar();
    expect(document.getElementById("sidebar-events")!.innerHTML).toContain("All day");
  });
});

// ── loadSidebar / mentions slot ───────────────────────────────────────────────

describe("loadSidebar — mentions", () => {
  beforeEach(() => { document.body.classList.add("sidebar-open"); });

  it("renders recent mentions when slack is connected", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "slack");
    mockApi.mentions.mockResolvedValue({ data: [makeMention()] });
    await loadSidebar();
    expect(document.getElementById("sidebar-mentions")!.innerHTML).toContain("Alice");
  });

  it("shows empty state when no mentions", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "slack");
    mockApi.mentions.mockResolvedValue({ data: [] });
    await loadSidebar();
    expect(document.getElementById("sidebar-mentions")!.textContent).toContain("No recent mentions");
  });

  it("limits to 5 mentions", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "slack");
    const mentions = Array.from({ length: 8 }, (_, i) => makeMention({ ts: `${i}000.000` }));
    mockApi.mentions.mockResolvedValue({ data: mentions });
    await loadSidebar();
    const links = document.querySelectorAll("#sidebar-mentions .sidebar-mention");
    expect(links.length).toBe(5);
  });

  it("shows auth error message on auth failure", async () => {
    mockHasCapability.mockImplementation((cap: string) => cap === "slack");
    mockApi.mentions.mockRejectedValueOnce(new Error("auth"));
    mockIsAuthError.mockReturnValue(true);
    await loadSidebar();
    expect(document.getElementById("sidebar-mentions")!.textContent).toContain("not connected");
  });
});
