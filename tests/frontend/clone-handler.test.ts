import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockApi, mockIsAuthError, mockGetSetting, mockSaveSetting, mockToast } =
  vi.hoisted(() => ({
    mockApi: {
      clickupTasks: vi.fn(),
      ticketsMine:  vi.fn(),
      cloneTicket:  vi.fn(),
    },
    mockIsAuthError: vi.fn().mockReturnValue(false),
    mockGetSetting:  vi.fn().mockReturnValue(undefined),
    mockSaveSetting: vi.fn(),
    mockToast:       vi.fn().mockReturnValue(() => {}),
  }));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi, isAuthError: mockIsAuthError }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: mockGetSetting, saveSetting: mockSaveSetting }));
vi.mock("../../src/frontend/components/util.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/frontend/components/util.js")>();
  return { ...actual, animateNumber: vi.fn(), toast: mockToast };
});

import { instantiateClickUp, bindClickUpClone } from "../../src/frontend/components/clickup.js";
import { instantiateTickets, bindTicketTabs }   from "../../src/frontend/components/tickets.js";

function makeContainer() { return document.createElement("div"); }

const clickupTask = (overrides = {}) => ({
  source:        "clickup" as const,
  id:            "task1",
  customId:      "CU-1",
  title:         "Build feature",
  status:        "In Progress",
  statusColor:   "#abc",
  statusBucket:  "in_progress" as const,
  priority:      null,
  assignees:     [],
  list:          "Sprint",
  url:           "https://app.clickup.com/t/task1",
  dueDate:       null,
  updatedAt:     "2026-05-06T00:00:00Z",
  ...overrides,
});

const jiraTicket = (overrides = {}) => ({
  source:        "jira" as const,
  id:            "t1",
  key:           "PROJ-1",
  title:         "Fix login bug",
  status:        "In Progress",
  statusBucket:  "in_progress" as const,
  statusColor:   null,
  priority:      null,
  assignee:      null,
  project:       "Project",
  projectKey:    "PROJ",
  url:           "https://jira.example.com/browse/PROJ-1",
  dueDate:       null,
  updatedAt:     "2026-05-06T00:00:00Z",
  ...overrides,
});

// connectorCloningConfig is now part of the server response — no global state needed.
const okClickup = (items = [clickupTask()], project?: string, connectorId = "conn-1") =>
  Promise.resolve({
    data: items,
    buckets: [],
    counts: { mine: items.length },
    notConfigured: false,
    bucket: "mine",
    connectorCloningConfig: project
      ? { cloningEnabled: true,  cloneTargetProject: project, connectorId }
      : { cloningEnabled: false, cloneTargetProject: "", connectorId },
  });

const okJira = (items = [jiraTicket()], project?: string, connectorId = "conn-2") =>
  Promise.resolve({
    data: items,
    buckets: [],
    counts: { mine: items.length },
    notConfigured: false,
    bucket: "mine",
    connectorCloningConfig: project
      ? { cloningEnabled: true,  cloneTargetProject: project, connectorId }
      : { cloningEnabled: false, cloneTargetProject: "", connectorId },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockGetSetting.mockReturnValue(undefined);
  mockToast.mockReturnValue(() => {});
});

// ── ClickUp clone button ──────────────────────────────────────────────────────

describe("ClickUp clone button", () => {
  it("renders a .clone-to-jira-btn when connectorCloningConfig.cloningEnabled is true", async () => {
    mockApi.clickupTasks.mockResolvedValue(okClickup([clickupTask()], "PROJ"));
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    expect(c.querySelector(".clone-to-jira-btn")).toBeTruthy();
  });

  it("does NOT render .clone-to-jira-btn when cloningEnabled is false", async () => {
    mockApi.clickupTasks.mockResolvedValue(okClickup());
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    expect(c.querySelector(".clone-to-jira-btn")).toBeNull();
  });

  it("sets data-target-project on the clone button from connectorCloningConfig", async () => {
    mockApi.clickupTasks.mockResolvedValue(okClickup([clickupTask()], "TARGET"));
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    const btn = c.querySelector<HTMLElement>(".clone-to-jira-btn");
    expect(btn?.dataset.targetProject).toBe("TARGET");
  });

  it("calls api.cloneTicket with correct payload when clone button is clicked", async () => {
    mockApi.clickupTasks.mockResolvedValue(okClickup([clickupTask()], "TARGET", "conn-1"));
    mockApi.cloneTicket.mockResolvedValue({ data: { key: "TARGET-99", id: "99", url: "https://jira.example.com/browse/TARGET-99" } });
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();

    const btn = c.querySelector<HTMLElement>(".clone-to-jira-btn");
    expect(btn).toBeTruthy();
    btn!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockApi.cloneTicket).toHaveBeenCalledWith(expect.objectContaining({
      sourceProvider: "clickup",
      title:          "Build feature",
      originalLink:   "https://app.clickup.com/t/task1",
      connectorId:    "conn-1",
    }));
  });

  it("encodes the connectorId on the clone button so the click handler can send it", async () => {
    mockApi.clickupTasks.mockResolvedValue(okClickup([clickupTask()], "TARGET", "conn-cu-77"));
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-cu-77", { wsName: "WS", title: "Tasks" });
    await inst.load();
    const btn = c.querySelector<HTMLElement>(".clone-to-jira-btn");
    expect(btn?.dataset.connectorId).toBe("conn-cu-77");
  });

  it("shows error toast when no target project is on the button", async () => {
    // cloningEnabled true but targetProject empty — simulates misconfigured state
    mockApi.clickupTasks.mockResolvedValue(
      Promise.resolve({ data: [clickupTask()], buckets: [], counts: {}, notConfigured: false, bucket: "mine",
        connectorCloningConfig: { cloningEnabled: true, cloneTargetProject: "", connectorId: "conn-1" } }),
    );
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();

    const btn = c.querySelector<HTMLElement>(".clone-to-jira-btn");
    btn?.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Configure 1-Click Cloning"), "error");
    expect(mockApi.cloneTicket).not.toHaveBeenCalled();
  });

  it("shows error toast when api.cloneTicket rejects", async () => {
    mockApi.clickupTasks.mockResolvedValue(okClickup([clickupTask()], "PROJ"));
    mockApi.cloneTicket.mockRejectedValue(new Error("Jira 403 Forbidden"));
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();

    c.querySelector<HTMLElement>(".clone-to-jira-btn")?.click();
    await new Promise(r => setTimeout(r, 10));

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"), "error");
  });

  it("shows notConfigured state when ClickUp is not connected", async () => {
    mockApi.clickupTasks.mockResolvedValue({ data: [], notConfigured: true, buckets: [], counts: {} });
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    expect(c.querySelector(".clone-to-jira-btn")).toBeNull();
  });
});

// ── bindClickUpClone ──────────────────────────────────────────────────────────

describe("bindClickUpClone", () => {
  it("attaches click listener to #clickup-body when the element exists", () => {
    const body = document.createElement("div");
    body.id = "clickup-body";
    document.body.appendChild(body);

    expect(() => bindClickUpClone()).not.toThrow();

    document.body.removeChild(body);
  });

  it("does not throw when #clickup-body is absent", () => {
    expect(() => bindClickUpClone()).not.toThrow();
  });

  it("delegates clicks on .clone-to-jira-btn inside #clickup-body to handleClone", async () => {
    const body = document.createElement("div");
    body.id = "clickup-body";
    body.innerHTML = `
      <button class="clone-to-jira-btn"
        data-clone-source="clickup"
        data-clone-title="Build feature"
        data-clone-url="https://app.clickup.com/t/abc"
        data-target-project="PROJ"
        data-connector-id="ci-cu-1">Clone</button>`;
    document.body.appendChild(body);
    bindClickUpClone();
    mockApi.cloneTicket.mockResolvedValue({ data: { key: "PROJ-1", id: "1", url: "https://j.example.com/browse/PROJ-1" } });
    body.querySelector<HTMLButtonElement>(".clone-to-jira-btn")!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.cloneTicket).toHaveBeenCalled();
    document.body.removeChild(body);
  });

  it("ignores clicks on non-clone elements inside #clickup-body", async () => {
    const body = document.createElement("div");
    body.id = "clickup-body";
    body.innerHTML = `<span class="not-a-clone">x</span>`;
    document.body.appendChild(body);
    bindClickUpClone();
    body.querySelector<HTMLElement>(".not-a-clone")!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(mockApi.cloneTicket).not.toHaveBeenCalled();
    document.body.removeChild(body);
  });
});

// ── Jira tickets clone button ─────────────────────────────────────────────────

describe("Jira tickets clone button (instantiateTickets)", () => {
  it("renders a .clone-to-jira-btn when connectorCloningConfig.cloningEnabled is true", async () => {
    mockApi.ticketsMine.mockResolvedValue(okJira([jiraTicket()], "PROJ"));
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-2", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(c.querySelector(".clone-to-jira-btn")).toBeTruthy();
  });

  it("does NOT render .clone-to-jira-btn when cloningEnabled is false", async () => {
    mockApi.ticketsMine.mockResolvedValue(okJira());
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-2", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(c.querySelector(".clone-to-jira-btn")).toBeNull();
  });

  it("sets data-target-project on the button from connectorCloningConfig", async () => {
    mockApi.ticketsMine.mockResolvedValue(okJira([jiraTicket()], "TARGET"));
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-2", { wsName: "WS", title: "Tickets" });
    await inst.load();
    const btn = c.querySelector<HTMLElement>(".clone-to-jira-btn");
    expect(btn?.dataset.targetProject).toBe("TARGET");
  });

  it("calls api.cloneTicket when clone button is clicked on a Jira ticket", async () => {
    mockApi.ticketsMine.mockResolvedValue(okJira([jiraTicket()], "TARGET", "conn-2"));
    mockApi.cloneTicket.mockResolvedValue({ data: { key: "TARGET-55", id: "55", url: "https://jira.example.com/browse/TARGET-55" } });
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-2", { wsName: "WS", title: "Tickets" });
    await inst.load();

    const btn = c.querySelector<HTMLElement>(".clone-to-jira-btn");
    btn?.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockApi.cloneTicket).toHaveBeenCalledWith(expect.objectContaining({
      sourceProvider: "jira",
      title:          "Fix login bug",
      connectorId:    "conn-2",
    }));
  });

  it("encodes the connectorId on the clone button so the click handler can send it", async () => {
    mockApi.ticketsMine.mockResolvedValue(okJira([jiraTicket()], "TARGET", "conn-jira-99"));
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-jira-99", { wsName: "WS", title: "Tickets" });
    await inst.load();
    const btn = c.querySelector<HTMLElement>(".clone-to-jira-btn");
    expect(btn?.dataset.connectorId).toBe("conn-jira-99");
  });

  it("shows error toast when data-target-project is empty", async () => {
    mockApi.ticketsMine.mockResolvedValue(
      Promise.resolve({ data: [jiraTicket()], buckets: [], counts: {}, notConfigured: false, bucket: "mine",
        connectorCloningConfig: { cloningEnabled: true, cloneTargetProject: "", connectorId: "conn-2" } }),
    );
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-2", { wsName: "WS", title: "Tickets" });
    await inst.load();

    const btn = c.querySelector<HTMLElement>(".clone-to-jira-btn");
    btn?.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Configure 1-Click Cloning"), "error");
    expect(mockApi.cloneTicket).not.toHaveBeenCalled();
  });

  it("shows notConfigured state when Jira is not connected", async () => {
    mockApi.ticketsMine.mockResolvedValue({ data: [], notConfigured: true, buckets: [], counts: {} });
    const c = makeContainer();
    const inst = instantiateTickets(c, "conn-2", { wsName: "WS", title: "Tickets" });
    await inst.load();
    expect(c.querySelector(".clone-to-jira-btn")).toBeNull();
  });
});

// ── bindTicketTabs ────────────────────────────────────────────────────────────

describe("bindTicketTabs — clone delegation", () => {
  it("attaches clone listener to #my-tickets-body when element exists", () => {
    const body = document.createElement("div");
    body.id = "my-tickets-body";
    document.body.appendChild(body);

    expect(() => bindTicketTabs()).not.toThrow();

    document.body.removeChild(body);
  });
});
