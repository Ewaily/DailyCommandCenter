import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    prs:          vi.fn(),
    ticketsMine:  vi.fn(),
    clickupTasks: vi.fn(),
    calendarEvents: vi.fn(),
    mentions:     vi.fn(),
  },
}));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi }));
vi.mock("../../src/frontend/components/util.js", () => ({
  escapeHtml: (s: string) => s,
}));

import {
  CAPABILITIES,
  specForType,
  specForCap,
  readWatchedUsers,
} from "../../src/frontend/components/instance-card-registry.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.prs.mockResolvedValue({ data: [], counts: {}, notConfigured: false });
  mockApi.ticketsMine.mockResolvedValue({ data: [], counts: {}, buckets: [], notConfigured: false, bucket: "mine" });
  mockApi.clickupTasks.mockResolvedValue({ data: [], counts: {}, buckets: [], notConfigured: false, bucket: "mine" });
  mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
  mockApi.mentions.mockResolvedValue({ data: [], notConfigured: false });
});

// ── Lookup helpers ─────────────────────────────────────────────────────────────

describe("specForType", () => {
  it("returns github spec for 'github' type", () => {
    expect(specForType("github")?.cap).toBe("github");
  });

  it("returns calendar spec for 'gcal' type", () => {
    expect(specForType("gcal")?.cap).toBe("calendar");
  });

  it("returns calendar spec for 'outlook' type", () => {
    expect(specForType("outlook")?.cap).toBe("calendar");
  });

  it("returns jira spec for 'jira' type", () => {
    expect(specForType("jira")?.cap).toBe("jira");
  });

  it("returns clickup spec for 'clickup' type", () => {
    expect(specForType("clickup")?.cap).toBe("clickup");
  });

  it("returns slack spec for 'slack' type", () => {
    expect(specForType("slack")?.cap).toBe("slack");
  });

  it("returns undefined for unknown type", () => {
    expect(specForType("unknown")).toBeUndefined();
  });
});

describe("specForCap", () => {
  it("returns spec by capability name", () => {
    expect(specForCap("github")?.cap).toBe("github");
    expect(specForCap("calendar")?.cap).toBe("calendar");
    expect(specForCap("jira")?.cap).toBe("jira");
  });

  it("returns undefined for unknown capability", () => {
    expect(specForCap("nonexistent")).toBeUndefined();
  });
});

// ── readWatchedUsers ──────────────────────────────────────────────────────────

describe("readWatchedUsers", () => {
  it("returns empty array when config has no watchedUsers", () => {
    const conn = { config: {} } as any;
    expect(readWatchedUsers(conn)).toEqual([]);
  });

  it("returns watchedUsers array when present in config", () => {
    const conn = { config: { watchedUsers: [{ id: "user1", label: "Alice" }] } } as any;
    expect(readWatchedUsers(conn)).toEqual([{ id: "user1", label: "Alice" }]);
  });

  it("returns empty array when watchedUsers is not an array", () => {
    const conn = { config: { watchedUsers: "bad" } } as any;
    expect(readWatchedUsers(conn)).toEqual([]);
  });

  it("returns empty array when config is undefined", () => {
    const conn = { config: undefined } as any;
    expect(readWatchedUsers(conn)).toEqual([]);
  });
});

// ── GitHub spec ───────────────────────────────────────────────────────────────

describe("github spec", () => {
  const spec = CAPABILITIES.find(c => c.cap === "github")!;

  it("has correct matchTypes", () => {
    expect(spec.matchTypes).toContain("github");
  });

  it("has fixed tabs with 4 entries", () => {
    expect(spec.tabs?.kind).toBe("fixed");
    if (spec.tabs?.kind === "fixed") expect(spec.tabs.entries).toHaveLength(4);
  });

  it("fetch calls api.prs with bucket and connectorId", async () => {
    await spec.fetch("c1", "mine");
    expect(mockApi.prs).toHaveBeenCalledWith("mine", "c1");
  });

  it("fetch falls back to 'review' bucket when null", async () => {
    await spec.fetch("c1", null);
    expect(mockApi.prs).toHaveBeenCalledWith("review", "c1");
  });

  it("renderItem produces row with PR number and title", () => {
    const html = spec.renderItem({ number: 42, title: "Fix bug", url: "https://github.com/pr/42", repo: "alice/repo", ageHuman: "2h ago" });
    expect(html).toContain("#42");
    expect(html).toContain("Fix bug");
    expect(html).toContain("alice/repo");
  });

  it("empty review bucket returns 'Review queue is clear'", () => {
    expect(spec.empty("review").title).toBe("Review queue is clear");
  });

  it("empty mine bucket returns 'No open PRs'", () => {
    expect(spec.empty("mine").title).toBe("No open PRs");
  });

  it("empty all bucket returns 'Repo is quiet'", () => {
    expect(spec.empty("all").title).toContain("quiet");
  });

  it("empty closed bucket returns closed PRs message", () => {
    expect(spec.empty("closed").title).toContain("closed");
  });
});

// ── Jira spec ─────────────────────────────────────────────────────────────────

describe("jira spec", () => {
  const spec = CAPABILITIES.find(c => c.cap === "jira")!;

  it("has dynamic tabs", () => {
    expect(spec.tabs?.kind).toBe("dynamic");
  });

  it("fetch calls api.ticketsMine", async () => {
    await spec.fetch("c1", "mine");
    expect(mockApi.ticketsMine).toHaveBeenCalledWith("mine", "c1");
  });

  it("renderItem includes ticket key and title", () => {
    const html = spec.renderItem({ key: "PROJ-1", title: "Bug fix", url: "https://jira.example.com/PROJ-1", status: "In Progress" });
    expect(html).toContain("PROJ-1");
    expect(html).toContain("Bug fix");
  });

  it("empty mine bucket returns personal message", () => {
    expect(spec.empty("mine").emoji).toBe("🎉");
  });
});

// ── ClickUp spec ──────────────────────────────────────────────────────────────

describe("clickup spec", () => {
  const spec = CAPABILITIES.find(c => c.cap === "clickup")!;

  it("fetch calls api.clickupTasks", async () => {
    await spec.fetch("c1", "mine");
    expect(mockApi.clickupTasks).toHaveBeenCalledWith("mine", "c1");
  });

  it("renderItem includes task title", () => {
    const html = spec.renderItem({ title: "Build feature", url: "https://clickup.com/t/1", status: "In Progress" });
    expect(html).toContain("Build feature");
  });

  it("empty mine bucket shows correct message", () => {
    expect(spec.empty("mine").title).toContain("No tasks assigned");
  });
});

// ── Calendar spec ─────────────────────────────────────────────────────────────

describe("calendar spec", () => {
  const spec = CAPABILITIES.find(c => c.cap === "calendar")!;

  it("has no tabs (tab-less card)", () => {
    expect(spec.tabs).toBeUndefined();
  });

  it("matchTypes includes both gcal and outlook", () => {
    expect(spec.matchTypes).toContain("gcal");
    expect(spec.matchTypes).toContain("outlook");
  });

  it("fetch calls api.calendarEvents", async () => {
    await spec.fetch("c1", null);
    expect(mockApi.calendarEvents).toHaveBeenCalled();
  });

  it("renderItem formats time and title", () => {
    const html = spec.renderItem({ start: "2026-05-09T09:00:00Z", title: "Team sync" });
    expect(html).toContain("Team sync");
  });

  it("empty always returns Nothing today", () => {
    expect(spec.empty("any").title).toBe("Nothing today");
  });
});

// ── Slack spec ────────────────────────────────────────────────────────────────

describe("slack spec", () => {
  const spec = CAPABILITIES.find(c => c.cap === "slack")!;

  it("has no tabs", () => {
    expect(spec.tabs).toBeUndefined();
  });

  it("fetch calls api.mentions", async () => {
    await spec.fetch("c1", null);
    expect(mockApi.mentions).toHaveBeenCalled();
  });

  it("fetch limits items to 10", async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ ts: String(i) }));
    mockApi.mentions.mockResolvedValue({ data: items });
    const result = await spec.fetch("c1", null);
    expect(result.items).toHaveLength(10);
  });

  it("renderItem includes text and channel info", () => {
    const html = spec.renderItem({ text: "Hello @me", channelName: "general", authorName: "Alice" });
    expect(html).toContain("Hello @me");
    expect(html).toContain("general");
    expect(html).toContain("Alice");
  });

  it("empty always returns No mentions", () => {
    expect(spec.empty("any").title).toBe("No mentions");
  });
});

// ── CAPABILITIES array completeness ──────────────────────────────────────────

describe("CAPABILITIES array", () => {
  it("has 5 capability entries", () => {
    expect(CAPABILITIES).toHaveLength(5);
  });

  it("all specs have required fields", () => {
    for (const spec of CAPABILITIES) {
      expect(spec.cap).toBeTruthy();
      expect(spec.matchTypes.length).toBeGreaterThan(0);
      expect(spec.staticWidgetId).toBeTruthy();
      expect(typeof spec.fetch).toBe("function");
      expect(typeof spec.renderItem).toBe("function");
      expect(typeof spec.empty).toBe("function");
    }
  });
});
