import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockApi, mockIsAuthError, mockGetSetting, mockSaveSetting, mockAnimateNumber, mockToast } =
  vi.hoisted(() => ({
    mockApi: {
      clickupTasks: vi.fn(),
      ticketsMine:  vi.fn(),
      ticketsTeam:  vi.fn(),
      mentions:     vi.fn(),
      slackDigest:  vi.fn(),
    },
    mockIsAuthError: vi.fn().mockReturnValue(false),
    mockGetSetting:  vi.fn().mockReturnValue(undefined),
    mockSaveSetting: vi.fn(),
    mockAnimateNumber: vi.fn(),
    mockToast:       vi.fn().mockReturnValue(() => {}),
  }));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi, isAuthError: mockIsAuthError }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: mockGetSetting, saveSetting: mockSaveSetting }));
vi.mock("../../src/frontend/components/tz.js", () => ({ getPrimaryTz: () => "UTC" }));
vi.mock("../../src/frontend/components/util.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/frontend/components/util.js")>();
  return { ...actual, animateNumber: mockAnimateNumber, toast: mockToast };
});

import { loadTickets } from "../../src/frontend/components/tickets.js";
import { loadClickUp } from "../../src/frontend/components/clickup.js";
import { loadTeamBoard } from "../../src/frontend/components/lists.js";
import { loadMentions, bindMentionsTabs, navMentions } from "../../src/frontend/components/mentions.js";

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
  project:       "Project Alpha",
  projectKey:    "PROJ",
  url:           "https://jira.example.com/browse/PROJ-1",
  dueDate:       null,
  updatedAt:     "2026-05-06T00:00:00Z",
  ...overrides,
});

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

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockGetSetting.mockReturnValue(undefined);
});

// ── loadTickets (module-level, uses global DOM elements) ──────────────────────

describe("loadTickets (global DOM)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="jira-tabs"></div>
      <div id="my-tickets-body"></div>
      <span id="kpi-tickets"></span>
      <span id="kpi-tickets-detail"></span>
      <span id="tickets-title"></span>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders tickets when data is returned", async () => {
    mockApi.ticketsMine.mockResolvedValue({
      data: [jiraTicket()],
      buckets: [],
      counts: { mine: 1 },
      notConfigured: false,
      bucket: "mine",
      connectorCloningConfig: { cloningEnabled: false, defaultTargetProject: "" },
    });
    await loadTickets();
    const body = document.getElementById("my-tickets-body")!;
    expect(body.innerHTML).toContain("PROJ-1");
  });

  it("calls animateNumber with mine count on data load", async () => {
    mockApi.ticketsMine.mockResolvedValue({
      data: [jiraTicket()],
      buckets: [],
      counts: { mine: 3 },
      notConfigured: false,
      bucket: "mine",
      connectorCloningConfig: { cloningEnabled: false, defaultTargetProject: "" },
    });
    await loadTickets();
    expect(mockAnimateNumber).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it("renders renderTabs and resets counts when notConfigured", async () => {
    mockApi.ticketsMine.mockResolvedValue({
      data: [],
      notConfigured: true,
      buckets: [],
      counts: {},
    });
    await loadTickets();
    const body = document.getElementById("my-tickets-body")!;
    expect(body.innerHTML).toContain("not connected");
    const kpi = document.getElementById("kpi-tickets");
    expect(kpi!.textContent).toBe("—");
  });

  it("renders empty state when no tickets returned", async () => {
    mockApi.ticketsMine.mockResolvedValue({
      data: [],
      buckets: [],
      counts: { mine: 0 },
      notConfigured: false,
      bucket: "mine",
      connectorCloningConfig: { cloningEnabled: false, defaultTargetProject: "" },
    });
    await loadTickets();
    const body = document.getElementById("my-tickets-body")!;
    expect(body.innerHTML).toContain("empty");
  });

  it("renders watched user tabs when buckets are present", async () => {
    mockApi.ticketsMine.mockResolvedValue({
      data: [],
      buckets: [{ id: "user-1", label: "Alice" }],
      counts: { mine: 0, "user-1": 2 },
      notConfigured: false,
      bucket: "mine",
      connectorCloningConfig: { cloningEnabled: false, defaultTargetProject: "" },
    });
    await loadTickets();
    const tabs = document.getElementById("jira-tabs")!;
    expect(tabs.innerHTML).toContain("Alice");
  });

  it("renders error state on API failure", async () => {
    mockApi.ticketsMine.mockRejectedValue(new Error("Network error"));
    await loadTickets();
    const body = document.getElementById("my-tickets-body")!;
    expect(body.innerHTML).toContain("Network error");
  });

  it("renders notConnected on auth error", async () => {
    mockIsAuthError.mockReturnValue(true);
    mockApi.ticketsMine.mockRejectedValue(new Error("401 Unauthorized"));
    await loadTickets();
    const body = document.getElementById("my-tickets-body")!;
    expect(body.innerHTML).toContain("not connected");
  });
});

// ── loadClickUp (module-level, uses global DOM elements) ─────────────────────

describe("loadClickUp (global DOM)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="clickup-body"></div>
      <div id="clickup-tabs"></div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders tasks when data is returned", async () => {
    mockApi.clickupTasks.mockResolvedValue({
      data: [clickupTask()],
      buckets: [],
      counts: { mine: 1 },
      notConfigured: false,
      bucket: "mine",
      connectorCloningConfig: { cloningEnabled: false, defaultTargetProject: "" },
    });
    await loadClickUp();
    const body = document.getElementById("clickup-body")!;
    expect(body.innerHTML).toContain("Build feature");
  });

  it("renders notConfigured state when ClickUp is not connected", async () => {
    mockApi.clickupTasks.mockResolvedValue({ data: [], notConfigured: true, buckets: [], counts: {} });
    await loadClickUp();
    const body = document.getElementById("clickup-body")!;
    expect(body.innerHTML).toContain("ClickUp");
  });

  it("renders empty state when no tasks", async () => {
    mockApi.clickupTasks.mockResolvedValue({
      data: [],
      buckets: [],
      counts: { mine: 0 },
      notConfigured: false,
      bucket: "mine",
      connectorCloningConfig: { cloningEnabled: false, defaultTargetProject: "" },
    });
    await loadClickUp();
    const body = document.getElementById("clickup-body")!;
    expect(body.innerHTML).toContain("All caught up");
  });

  it("renders watched user tabs when buckets are present", async () => {
    mockApi.clickupTasks.mockResolvedValue({
      data: [],
      buckets: [{ id: "user-1", label: "Bob" }],
      counts: { mine: 0, "user-1": 1 },
      notConfigured: false,
      bucket: "mine",
      connectorCloningConfig: { cloningEnabled: false, defaultTargetProject: "" },
    });
    await loadClickUp();
    const tabs = document.getElementById("clickup-tabs")!;
    expect(tabs.innerHTML).toContain("Bob");
  });

  it("renders error state on API failure", async () => {
    mockApi.clickupTasks.mockRejectedValue(new Error("Timeout"));
    await loadClickUp();
    const body = document.getElementById("clickup-body")!;
    expect(body.innerHTML).toContain("Timeout");
  });

  it("renders clone button when cloningEnabled is true", async () => {
    mockApi.clickupTasks.mockResolvedValue({
      data: [clickupTask()],
      buckets: [],
      counts: { mine: 1 },
      notConfigured: false,
      bucket: "mine",
      connectorCloningConfig: { cloningEnabled: true, defaultTargetProject: "TARGET" },
    });
    await loadClickUp();
    const body = document.getElementById("clickup-body")!;
    expect(body.innerHTML).toContain("clone-to-jira-btn");
  });
});

// ── loadTeamBoard (lists.ts renderList + loadTeamBoard) ───────────────────────

describe("loadTeamBoard (global DOM)", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="team-board-body"></div>`;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders team tickets when data is returned", async () => {
    mockApi.ticketsTeam.mockResolvedValue({
      data: [jiraTicket()],
      notConfigured: false,
    });
    await loadTeamBoard();
    const body = document.getElementById("team-board-body")!;
    expect(body.innerHTML).toContain("PROJ-1");
  });

  it("renders notConnected state when not configured", async () => {
    mockApi.ticketsTeam.mockResolvedValue({ data: [], notConfigured: true });
    await loadTeamBoard();
    const body = document.getElementById("team-board-body")!;
    expect(body.innerHTML).toContain("not connected");
  });

  it("renders empty state when no tickets", async () => {
    mockApi.ticketsTeam.mockResolvedValue({ data: [], notConfigured: false });
    await loadTeamBoard();
    const body = document.getElementById("team-board-body")!;
    expect(body.innerHTML).toContain("empty");
  });
});

// ── loadMentions + navMentions + bindMentionsTabs (module-level) ──────────────

const NOW_SEC = Math.floor(Date.now() / 1000);

const mention = (overrides = {}) => ({
  channelId: "C1", channelName: "general", isDm: false,
  ts: String(NOW_SEC), tsHuman: "12:00 PM",
  authorId: "U1", authorName: "Alice", authorAvatar: null,
  text: "Hello world", html: "<p>Hello world</p>",
  permalink: "https://slack.com/archives/C1/p1",
  urgent: false, ...overrides,
});

describe("loadMentions (global DOM)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="mentions-body"></div>
      <span id="kpi-slack"></span>
      <span id="mentions-day-label">Today</span>
      <button id="mentions-nav-prev">prev</button>
      <button id="mentions-nav-next">next</button>
      <button id="mentions-nav-today">today</button>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders mentions when data is returned", async () => {
    mockApi.mentions.mockResolvedValue({ data: [mention()], notConfigured: false });
    await loadMentions();
    const body = document.getElementById("mentions-body")!;
    expect(body.innerHTML).toContain("Alice");
  });

  it("renders notConfigured state when Slack is not connected", async () => {
    mockApi.mentions.mockResolvedValue({ data: [], notConfigured: true });
    await loadMentions();
    const body = document.getElementById("mentions-body")!;
    expect(body.innerHTML).toContain("Slack");
  });

  it("renders empty state when no mentions for the day", async () => {
    mockApi.mentions.mockResolvedValue({ data: [], notConfigured: false });
    await loadMentions();
    const body = document.getElementById("mentions-body")!;
    expect(body.innerHTML).toContain("empty");
  });

  it("bindMentionsTabs attaches nav listeners without throwing", async () => {
    mockApi.mentions.mockResolvedValue({ data: [], notConfigured: false });
    await loadMentions();
    expect(() => bindMentionsTabs()).not.toThrow();
  });

  it("navMentions(-1) navigates to yesterday", async () => {
    mockApi.mentions.mockResolvedValue({ data: [], notConfigured: false });
    await loadMentions();
    navMentions(-1);
    const label = document.getElementById("mentions-day-label")!;
    expect(label.textContent).toBe("Yesterday");
  });

  it("navMentions('today') resets label to Today", async () => {
    mockApi.mentions.mockResolvedValue({ data: [], notConfigured: false });
    await loadMentions();
    navMentions(-1);
    navMentions("today");
    const label = document.getElementById("mentions-day-label")!;
    expect(label.textContent).toBe("Today");
  });
});
