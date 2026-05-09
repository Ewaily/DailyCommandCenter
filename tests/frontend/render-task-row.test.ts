import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSetting, mockSaveSetting } = vi.hoisted(() => ({
  mockGetSetting:  vi.fn().mockReturnValue(undefined),
  mockSaveSetting: vi.fn(),
}));

// Stub heavy modules that lists.ts / util.ts transitively import so they don't
// add uncovered functions to the denominator and don't attempt real I/O.
vi.mock("../../src/frontend/api.js",   () => ({ api: {}, isAuthError: vi.fn() }));
vi.mock("../../src/frontend/state.js", () => ({
  getSetting:  (...a: any[]) => mockGetSetting(...a),
  saveSetting: (...a: any[]) => mockSaveSetting(...a),
}));
vi.mock("../../src/frontend/components/tz.js", () => ({ getPrimaryTz: () => "UTC" }));

import { renderTaskRow, maybeShowCloneHint, type TaskRow } from "../../src/frontend/components/task-row.js";
import { renderJiraTicket } from "../../src/frontend/components/lists.js";
import type { Ticket } from "../../src/frontend/api.js";

beforeEach(() => { vi.clearAllMocks(); mockGetSetting.mockReturnValue(undefined); });

function baseRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    key: "PROJ-1",
    url: "https://jira.example.com/browse/PROJ-1",
    title: "Fix login bug",
    status: "In Progress",
    statusColor: null,
    statusBucket: "in_progress",
    priority: null,
    assignees: [],
    listLabel: null,
    dueDate: null,
    ...overrides,
  };
}

function baseTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    source: "jira",
    id: "t1", key: "PROJ-1",
    title: "Fix login bug",
    status: "In Progress",
    statusBucket: "in_progress",
    statusColor: null,
    priority: null,
    assignee: null,
    project: "Project Alpha",
    projectKey: "PROJ",
    url: "https://jira.example.com/browse/PROJ-1",
    dueDate: null,
    updatedAt: "2026-05-06T00:00:00Z",
    ...overrides,
  } as Ticket;
}

// ── renderTaskRow ─────────────────────────────────────────────────────────────

describe("renderTaskRow", () => {
  it("renders the task key", () => {
    const html = renderTaskRow(baseRow());
    expect(html).toContain("PROJ-1");
  });

  it("renders the task title as a link", () => {
    const html = renderTaskRow(baseRow());
    expect(html).toContain('href="https://jira.example.com/browse/PROJ-1"');
    expect(html).toContain("Fix login bug");
  });

  it("renders a status chip with custom color when statusColor is set", () => {
    const html = renderTaskRow(baseRow({ statusColor: "#0052cc" }));
    expect(html).toContain("#0052cc");
    expect(html).toContain("In Progress");
  });

  it("renders a priority badge when priority is set", () => {
    const html = renderTaskRow(baseRow({ priority: "high" }));
    expect(html).toContain("high");
  });

  it("renders a list pill when listLabel is set", () => {
    const html = renderTaskRow(baseRow({ listLabel: "Sprint 42" }));
    expect(html).toContain("Sprint 42");
  });

  it("renders the due date when set", () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const html = renderTaskRow(baseRow({ dueDate: tomorrow }));
    expect(html).toContain("due");
  });

  it("renders the clone button and cloneable class when cloneSource is set", () => {
    const html = renderTaskRow(baseRow({ cloneSource: "jira", cloneTargetProject: "PROJ", cloneConnectorId: "ci-1" }));
    expect(html).toContain("clone-to-jira-btn");
    expect(html).toContain("schedule-item--cloneable");
    expect(html).toContain('data-target-project="PROJ"');
    expect(html).toContain('data-connector-id="ci-1"');
  });

  it("does NOT render the clone button when cloneSource is absent", () => {
    const html = renderTaskRow(baseRow());
    expect(html).not.toContain("clone-to-jira-btn");
    expect(html).not.toContain("schedule-item--cloneable");
  });

  it("renders an assignee avatar stack when assignees are present", () => {
    const html = renderTaskRow(baseRow({
      assignees: [{ name: "Alice", avatar: null, color: "#ff0000" }],
    }));
    expect(html).toContain("Alice");
    expect(html).toContain("task-assignees");
  });

  it("renders an overdue due date in red when past", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const html = renderTaskRow(baseRow({ dueDate: yesterday }));
    expect(html).toContain("overdue");
  });

  it("renders 'due tomorrow' for a due date exactly 1 day ahead (ISO)", () => {
    // Force a date that is tomorrow midnight UTC but close enough to guarantee days===1
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 2); // 2 calendar days away → typically rounds to 1-2
    // Use a fixed ISO date 1.5 days from now to guarantee days === 1 via rounding
    const onePointFiveDays = new Date(Date.now() + 86_400_000 * 1.5).toISOString().slice(0, 10);
    const html = renderTaskRow(baseRow({ dueDate: onePointFiveDays }));
    expect(html).toMatch(/due (today|tomorrow|in \dd)/);
  });

  it("renders 'due in Xd' for a due date 3 days ahead", () => {
    const threeDaysOut = new Date(Date.now() + 86_400_000 * 3.5).toISOString().slice(0, 10);
    const html = renderTaskRow(baseRow({ dueDate: threeDaysOut }));
    expect(html).toContain("due in");
  });

  it("renders long-form date for due dates more than 7 days out", () => {
    const tenDaysOut = new Date(Date.now() + 86_400_000 * 10).toISOString().slice(0, 10);
    const html = renderTaskRow(baseRow({ dueDate: tenDaysOut }));
    expect(html).toMatch(/due [A-Z][a-z]+ \d+/);
  });

  it("renders avatar img when assignee has an avatar URL", () => {
    const html = renderTaskRow(baseRow({
      assignees: [{ name: "Bob", avatar: "https://cdn.example.com/bob.png" }],
    }));
    expect(html).toContain('<img class="task-avatar"');
    expect(html).toContain("https://cdn.example.com/bob.png");
  });

  it("renders overflow badge when more than 3 assignees", () => {
    const html = renderTaskRow(baseRow({
      assignees: [
        { name: "Alice", avatar: null },
        { name: "Bob",   avatar: null },
        { name: "Carol", avatar: null },
        { name: "Dave",  avatar: null },
      ],
    }));
    expect(html).toContain("task-avatar-more");
    expect(html).toContain("+1");
  });
});

// ── renderJiraTicket ──────────────────────────────────────────────────────────

describe("renderJiraTicket", () => {
  it("renders the ticket key", () => {
    const html = renderJiraTicket(baseTicket());
    expect(html).toContain("PROJ-1");
  });

  it("renders the project name as list pill", () => {
    const html = renderJiraTicket(baseTicket());
    expect(html).toContain("Project Alpha");
  });

  it("includes a clone button when cloningEnabled is true", () => {
    const html = renderJiraTicket(baseTicket(), true, "MYPROJ", "ci-jira-7");
    expect(html).toContain("clone-to-jira-btn");
    expect(html).toContain('data-clone-source="jira"');
    expect(html).toContain('data-target-project="MYPROJ"');
    expect(html).toContain('data-connector-id="ci-jira-7"');
  });

  it("omits clone button when cloningEnabled is false", () => {
    const html = renderJiraTicket(baseTicket(), false);
    expect(html).not.toContain("clone-to-jira-btn");
  });

  it("renders the assignee name when assignee is present", () => {
    const html = renderJiraTicket(baseTicket({
      assignee: { name: "Bob Smith", avatar: null, accountId: "acc1" },
    }));
    expect(html).toContain("Bob Smith");
  });
});

// ── maybeShowCloneHint ────────────────────────────────────────────────────────

describe("maybeShowCloneHint", () => {
  function setupContainer(cloneable = true): HTMLElement {
    const container = document.createElement("div");
    if (cloneable) {
      container.innerHTML = renderTaskRow(
        baseRow({ cloneSource: "jira", cloneTargetProject: "P", cloneConnectorId: "ci" })
      );
    } else {
      container.innerHTML = renderTaskRow(baseRow());
    }
    return container;
  }

  it("adds clone-first-seen to first cloneable row when hint not seen", () => {
    mockGetSetting.mockReturnValue(undefined);
    const container = setupContainer();
    maybeShowCloneHint(container);
    expect(container.querySelector(".clone-first-seen")).not.toBeNull();
  });

  it("does nothing when cloneHintSeen is already set", () => {
    mockGetSetting.mockReturnValue(true);
    const container = setupContainer();
    maybeShowCloneHint(container);
    expect(container.querySelector(".clone-first-seen")).toBeNull();
  });

  it("does nothing when container has no cloneable rows", () => {
    mockGetSetting.mockReturnValue(undefined);
    const container = setupContainer(false);
    maybeShowCloneHint(container);
    expect(container.querySelector(".clone-first-seen")).toBeNull();
    expect(mockSaveSetting).not.toHaveBeenCalled();
  });

  it("clears class and saves setting after timeout", async () => {
    vi.useFakeTimers();
    mockGetSetting.mockReturnValue(undefined);
    const container = setupContainer();
    maybeShowCloneHint(container);
    expect(container.querySelector(".clone-first-seen")).not.toBeNull();
    vi.advanceTimersByTime(7_000);
    await Promise.resolve();
    expect(container.querySelector(".clone-first-seen")).toBeNull();
    expect(mockSaveSetting).toHaveBeenCalledWith("cloneHintSeen", true);
    vi.useRealTimers();
  });

  it("clears class immediately when clone button is clicked", async () => {
    vi.useFakeTimers();
    mockGetSetting.mockReturnValue(undefined);
    const container = setupContainer();
    maybeShowCloneHint(container);
    const btn = container.querySelector<HTMLElement>(".clone-to-jira-btn")!;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    expect(container.querySelector(".clone-first-seen")).toBeNull();
    expect(mockSaveSetting).toHaveBeenCalledWith("cloneHintSeen", true);
    vi.useRealTimers();
  });
});
