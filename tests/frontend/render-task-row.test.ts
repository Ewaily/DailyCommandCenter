import { describe, it, expect, vi } from "vitest";

// Stub heavy modules that lists.ts / util.ts transitively import so they don't
// add uncovered functions to the denominator and don't attempt real I/O.
vi.mock("../../src/frontend/api.js",   () => ({ api: {}, isAuthError: vi.fn() }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: vi.fn(), saveSetting: vi.fn() }));
vi.mock("../../src/frontend/components/tz.js", () => ({ getPrimaryTz: () => "UTC" }));

import { renderTaskRow, type TaskRow } from "../../src/frontend/components/task-row.js";
import { renderJiraTicket } from "../../src/frontend/components/lists.js";
import type { Ticket } from "../../src/frontend/api.js";

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
    const html = renderTaskRow(baseRow({ cloneSource: "jira", cloneTargetProject: "PROJ" }));
    expect(html).toContain("clone-to-jira-btn");
    expect(html).toContain("schedule-item--cloneable");
    expect(html).toContain('data-target-project="PROJ"');
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
    const html = renderJiraTicket(baseTicket(), true, "MYPROJ");
    expect(html).toContain("clone-to-jira-btn");
    expect(html).toContain('data-clone-source="jira"');
    expect(html).toContain('data-target-project="MYPROJ"');
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
