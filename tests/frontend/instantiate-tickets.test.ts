import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockIsAuthError, mockGetSetting, mockSaveSetting, mockRenderJiraTicket } =
  vi.hoisted(() => ({
    mockApi: {
      ticketsMine: vi.fn(),
      settingsPut: vi.fn().mockResolvedValue({}),
      cloneHistory: vi.fn().mockResolvedValue({ data: {} }),
    },
    mockIsAuthError: vi.fn().mockReturnValue(false),
    mockGetSetting: vi.fn().mockReturnValue(undefined),
    mockSaveSetting: vi.fn(),
    mockRenderJiraTicket: vi.fn((t: { key: string }) => `<div class="ticket-row">${t.key}</div>`),
  }));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi, isAuthError: mockIsAuthError }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: mockGetSetting, saveSetting: mockSaveSetting }));
vi.mock("../../src/frontend/components/lists.js", () => ({
  renderJiraTicket: mockRenderJiraTicket,
  loadTeamBoard: vi.fn(),
}));
// util helpers used by tickets.ts — let them run naturally in happy-dom
vi.mock("../../src/frontend/components/util.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/frontend/components/util.js")>();
  return { ...actual, animateNumber: vi.fn() };
});

import { instantiateTickets } from "../../src/frontend/components/tickets.js";

function makeContainer() { return document.createElement("div"); }

const ticket = (overrides = {}) => ({
  source: "jira" as const,
  id: "t1", key: "PROJ-1", title: "Fix login bug",
  status: "In Progress", statusBucket: "in_progress" as const,
  statusColor: null, priority: null, assignee: null,
  project: "Project", projectKey: "PROJ",
  url: "https://jira.example/PROJ-1",
  dueDate: null, updatedAt: "2026-05-06T00:00:00Z",
  ...overrides,
});

const watched = [{ id: "u1", label: "Alice", query: "", status: "active" }];

const okResp = (items = [ticket()], buckets = watched, counts: Record<string, number> = { mine: 1, u1: 0 }, bucket = "mine") =>
  Promise.resolve({ data: items, buckets, counts, notConfigured: false, bucket });

const notConfiguredResp = () =>
  Promise.resolve({ data: [], buckets: [], counts: {}, notConfigured: true, bucket: "mine" });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockGetSetting.mockReturnValue(undefined);
  mockRenderJiraTicket.mockImplementation((t: { key: string }) => `<div class="ticket-row">${t.key}</div>`);
});

// ── structure ─────────────────────────────────────────────────────────────
describe("instantiateTickets — HTML structure", () => {
  it("renders title-source and title-text", () => {
    mockApi.ticketsMine.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateTickets(c, "conn-1", { wsName: "Acme · carol", title: "My Tickets" });
    expect(c.querySelector(".title-source")?.textContent).toBe("Acme · carol");
    expect(c.querySelector(".title-text")?.textContent?.trim()).toContain("My Tickets");
  });

  it("renders the tabs container", () => {
    mockApi.ticketsMine.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    expect(c.querySelector("[data-ov-tabs]")).toBeTruthy();
  });

  it("renders the card-body container", () => {
    mockApi.ticketsMine.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    expect(c.querySelector("[data-ov-body]")).toBeTruthy();
  });

  it("seeds initial 'Mine' tab before first load", () => {
    mockApi.ticketsMine.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    const tabs = c.querySelectorAll("[data-ov-bucket]");
    expect(tabs.length).toBe(1);
    expect((tabs[0] as HTMLElement).dataset.ovBucket).toBe("mine");
  });
});

// ── load() ────────────────────────────────────────────────────────────────
describe("instantiateTickets — load()", () => {
  it("passes connectorId to api.ticketsMine", async () => {
    mockApi.ticketsMine.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-xyz", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(mockApi.ticketsMine).toHaveBeenCalledWith("mine", "conn-xyz");
  });

  it("renders notConfigured state", async () => {
    mockApi.ticketsMine.mockResolvedValue(notConfiguredResp());
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(c.querySelector("[data-ov-body] .not-connected")).toBeTruthy();
  });

  it("expands tabs from response buckets (Mine + watched users)", async () => {
    mockApi.ticketsMine.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    const tabs = Array.from(c.querySelectorAll<HTMLElement>("[data-ov-bucket]"))
      .map(b => b.dataset.ovBucket);
    expect(tabs).toContain("mine");
    expect(tabs).toContain("u1");
  });

  it("renders ticket rows via renderJiraTicket", async () => {
    mockApi.ticketsMine.mockResolvedValue(okResp([ticket(), ticket({ id: "t2", key: "PROJ-2" })]));
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(c.querySelectorAll("[data-ov-body] .ticket-row").length).toBe(2);
  });

  it("renders empty state when no tickets", async () => {
    mockApi.ticketsMine.mockResolvedValue(okResp([]));
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(c.querySelector("[data-ov-body] .empty")).toBeTruthy();
  });

  it("updates count badges on each tab", async () => {
    mockApi.ticketsMine.mockResolvedValue(okResp([ticket()], watched, { mine: 3, u1: 1 }));
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(c.querySelector("[data-ov-count='mine']")?.textContent).toBe("3");
  });

  it("renders error message on failure", async () => {
    mockApi.ticketsMine.mockRejectedValue(new Error("jira down"));
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.textContent).toContain("jira down");
  });

  it("falls back to mine if active bucket disappears from buckets", async () => {
    mockGetSetting.mockImplementation((k: string) => k === "jiraTab" ? "u1" : undefined);
    // first load has u1, second load drops it
    mockApi.ticketsMine
      .mockResolvedValueOnce(okResp([ticket()], watched, { mine: 1, u1: 0 }))
      .mockResolvedValueOnce(okResp([ticket()], [], { mine: 1 }));
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    await inst.load();
    expect(mockSaveSetting).toHaveBeenCalledWith("jiraTab", "mine");
  });
});

// ── tab switching ─────────────────────────────────────────────────────────
describe("instantiateTickets — tab switching", () => {
  it("clicking a watched-user tab reloads with that bucket", async () => {
    mockApi.ticketsMine.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();

    const aliceTab = c.querySelector<HTMLElement>("[data-ov-bucket='u1']")!;
    aliceTab.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockSaveSetting).toHaveBeenCalledWith("jiraTab", "u1");
    expect(mockApi.ticketsMine).toHaveBeenLastCalledWith("u1", "conn-1");
  });

  it("clicked tab becomes the only active tab", async () => {
    mockApi.ticketsMine
      .mockResolvedValueOnce(okResp())                           // initial load → mine
      .mockResolvedValueOnce(okResp([ticket()], watched, { mine: 0, u1: 1 }, "u1")); // tab click → u1
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-1", { wsName: "WS", title: "Tickets" });
    await inst.load();

    c.querySelector<HTMLElement>("[data-ov-bucket='u1']")!.click();
    await new Promise(r => setTimeout(r, 0));

    const active = c.querySelectorAll(".tab.active[data-ov-bucket]");
    expect(active.length).toBe(1);
    expect((active[0] as HTMLElement).dataset.ovBucket).toBe("u1");
  });
});

// ── instance isolation ────────────────────────────────────────────────────
describe("instantiateTickets — instance isolation", () => {
  it("two instances pass their own connectorIds", async () => {
    mockApi.ticketsMine.mockResolvedValue(okResp());
    const c1 = makeContainer();
    const c2 = makeContainer();
    const i1 = instantiateTickets(c1, "conn-A", { wsName: "WS-A", title: "Tickets" });
    const i2 = instantiateTickets(c2, "conn-B", { wsName: "WS-B", title: "Tickets" });
    await Promise.all([i1.load(), i2.load()]);
    const ids = (mockApi.ticketsMine as ReturnType<typeof vi.fn>).mock.calls.map(([, id]) => id);
    expect(ids).toContain("conn-A");
    expect(ids).toContain("conn-B");
  });
});

// ── applyCloneHistory ─────────────────────────────────────────────────────────
describe("instantiateTickets — applyCloneHistory", () => {
  it("replaces clone button with cloned-badge when history entry exists", async () => {
    mockApi.ticketsMine.mockResolvedValue({
      ...await okResp(),
      connectorCloningConfig: { cloningEnabled: true, cloneTargetProject: "P", connectorId: "ci-1" },
    });
    mockRenderJiraTicket.mockReturnValue(
      `<div class="schedule-item"><button class="clone-to-jira-btn" data-clone-url="https://jira/T-1"></button></div>`,
    );
    mockApi.cloneHistory.mockResolvedValue({
      data: { "https://jira/T-1": { key: "DEST-5", url: "https://target/DEST-5", title: "T", clonedAt: 1 } },
    });

    const c = makeContainer();
    const inst = instantiateTickets(c, "ci-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    await new Promise(r => setTimeout(r, 10));

    expect(c.querySelector(".clone-to-jira-btn")).toBeNull();
    const badge = c.querySelector<HTMLAnchorElement>(".cloned-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("DEST-5");
    expect(badge!.href).toContain("DEST-5");
  });

  it("skips rows already marked is-cloned", async () => {
    mockApi.ticketsMine.mockResolvedValue({
      ...await okResp(),
      connectorCloningConfig: { cloningEnabled: true, cloneTargetProject: "P", connectorId: "ci-1" },
    });
    mockRenderJiraTicket.mockReturnValue(
      `<div class="schedule-item is-cloned"><button class="clone-to-jira-btn" data-clone-url="https://jira/T-1"></button></div>`,
    );
    mockApi.cloneHistory.mockResolvedValue({
      data: { "https://jira/T-1": { key: "DEST-5", url: "https://target/DEST-5", title: "T", clonedAt: 1 } },
    });

    const c = makeContainer();
    const inst = instantiateTickets(c, "ci-1", { wsName: "WS", title: "Tickets" });
    await inst.load();
    await new Promise(r => setTimeout(r, 10));

    // Button should remain because the row was already is-cloned
    expect(c.querySelector(".clone-to-jira-btn")).not.toBeNull();
  });

  it("does not throw when cloneHistory API call fails", async () => {
    mockApi.ticketsMine.mockResolvedValue(okResp());
    mockApi.cloneHistory.mockRejectedValue(new Error("network"));

    const c = makeContainer();
    const inst = instantiateTickets(c, "ci-1", { wsName: "WS", title: "Tickets" });
    await expect(inst.load()).resolves.not.toThrow();
  });
});
