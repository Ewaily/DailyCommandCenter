import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetClickUpConfig, mockGetActiveWorkspaceId, mockMemo, mockFetch } = vi.hoisted(() => ({
  mockGetClickUpConfig:     vi.fn().mockReturnValue(null),
  mockGetActiveWorkspaceId: vi.fn().mockReturnValue(null),
  mockMemo:                 vi.fn().mockImplementation((_k, _t, fn) => fn()),
  mockFetch:                vi.fn(),
}));

vi.mock("../src/server/lib/workspace-config.js", () => ({
  getClickUpConfig: mockGetClickUpConfig,
}));
vi.mock("../src/server/lib/request-context.js", () => ({
  getActiveWorkspaceId: mockGetActiveWorkspaceId,
}));
vi.mock("../src/server/config.js", () => ({
  config: { clickup: { token: "", teamId: "", spaceIds: [] } },
}));
vi.mock("../src/server/lib/cache.js", () => ({ memo: mockMemo }));

import {
  isConfigured,
  whoAmI,
  listMyTasks,
  getWatchedUsers,
  listWatchedMemberTasks,
} from "../src/server/integrations/clickup.js";

const CREDS = { token: "pk_ext_tok", teamId: "TEAMEXT", spaceIds: [], watchedUsers: [] };

function stubCreds(overrides = {}) {
  mockGetClickUpConfig.mockReturnValue({ ...CREDS, ...overrides });
}

function stubFetch(responses: Array<{ ok?: boolean; status?: number; json?: any; text?: string }>) {
  let i = 0;
  mockFetch.mockImplementation(() => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve({
      ok: r.ok !== false,
      status: r.status ?? 200,
      text: () => Promise.resolve(r.text ?? "error"),
      json: () => Promise.resolve(r.json ?? {}),
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockGetClickUpConfig.mockReturnValue(null);
  mockGetActiveWorkspaceId.mockReturnValue(null);
  mockMemo.mockImplementation((_k: string, _t: number, fn: () => any) => fn());
});

afterEach(() => vi.unstubAllGlobals());

// ── isConfigured ──────────────────────────────────────────────────────────────

describe("isConfigured", () => {
  it("returns false when no DB config and no env config", () => {
    expect(isConfigured()).toBe(false);
  });

  it("returns false when token is missing", () => {
    mockGetClickUpConfig.mockReturnValue({ token: "", teamId: "T1", spaceIds: [] });
    expect(isConfigured()).toBe(false);
  });

  it("returns false when teamId is missing", () => {
    mockGetClickUpConfig.mockReturnValue({ token: "tok", teamId: "", spaceIds: [] });
    expect(isConfigured()).toBe(false);
  });

  it("returns true with both token and teamId", () => {
    stubCreds();
    expect(isConfigured()).toBe(true);
  });

  it("uses workspaceId when provided", () => {
    mockGetClickUpConfig.mockImplementation((id: string | undefined) =>
      id === "ws-ext" ? { ...CREDS } : null,
    );
    expect(isConfigured("ws-ext")).toBe(true);
    expect(isConfigured("ws-other")).toBe(false);
  });
});

// ── whoAmI ────────────────────────────────────────────────────────────────────

describe("whoAmI", () => {
  it("returns null when token is empty", async () => {
    mockGetClickUpConfig.mockReturnValue({ token: "", teamId: "T1", spaceIds: [] });
    const result = await whoAmI();
    expect(result).toBeNull();
  });

  it("returns user info on success", async () => {
    stubCreds();
    stubFetch([{ json: { user: { id: 7, username: "dev", email: "dev@co.com" } } }]);
    const result = await whoAmI();
    expect(result?.username).toBe("dev");
    expect(result?.id).toBe(7);
  });

  it("passes Authorization header", async () => {
    stubCreds();
    stubFetch([{ json: { user: { id: 1, username: "x", email: "x@co.com" } } }]);
    await whoAmI();
    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers).toHaveProperty("Authorization", CREDS.token);
  });
});

// ── listMyTasks ───────────────────────────────────────────────────────────────

describe("listMyTasks", () => {
  it("returns empty array when not configured", async () => {
    expect(await listMyTasks()).toEqual([]);
  });

  it("returns empty when whoAmI returns null", async () => {
    mockGetClickUpConfig.mockReturnValue({ token: "", teamId: "T1", spaceIds: [] });
    expect(await listMyTasks()).toEqual([]);
  });

  it("fetches and normalizes tasks", async () => {
    stubCreds();
    stubFetch([
      { json: { user: { id: 10, username: "alice", email: "alice@co.com" } } },
      { json: { tasks: [
        { id: "task-a", name: "Alpha task", url: "https://cu/t/a",
          status: { status: "To Do", type: "open", color: "#000" },
          priority: { priority: "normal" },
          assignees: [{ id: 10, username: "alice", email: null, color: null, profilePicture: null }],
          list: { name: "Sprint 1" },
          due_date: "1700000000000", date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listMyTasks();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Alpha task");
    expect(result[0].priority).toBe("medium");
    expect(result[0].list).toBe("Sprint 1");
  });

  it("maps urgent priority correctly", async () => {
    stubCreds();
    stubFetch([
      { json: { user: { id: 11, username: "bob", email: "bob@co.com" } } },
      { json: { tasks: [
        { id: "t-urg", name: "Urgent", url: "https://cu/t/u",
          status: { status: "Open", type: "open", color: null },
          priority: { priority: "urgent" },
          assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listMyTasks();
    expect(result[0].priority).toBe("urgent");
  });

  it("maps low priority correctly", async () => {
    stubCreds();
    stubFetch([
      { json: { user: { id: 12, username: "carol", email: "carol@co.com" } } },
      { json: { tasks: [
        { id: "t-low", name: "Low pri", url: "https://cu/t/l",
          status: { status: "Open", type: "open", color: null },
          priority: { priority: "low" },
          assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listMyTasks();
    expect(result[0].priority).toBe("low");
  });

  it("includes dueDate as ISO string when present", async () => {
    stubCreds();
    stubFetch([
      { json: { user: { id: 13, username: "dave", email: "dave@co.com" } } },
      { json: { tasks: [
        { id: "t-due", name: "Has due date", url: "https://cu/t/d",
          status: { status: "Open", type: "open", color: null },
          priority: null, assignees: [], list: null,
          due_date: "1700000000000", date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listMyTasks();
    expect(result[0].dueDate).toBeTruthy();
  });
});

// ── getWatchedUsers ───────────────────────────────────────────────────────────

describe("getWatchedUsers", () => {
  it("returns empty when no config", () => {
    expect(getWatchedUsers()).toEqual([]);
  });

  it("returns empty when watchedUsers is undefined", () => {
    mockGetClickUpConfig.mockReturnValue({ ...CREDS });
    expect(getWatchedUsers()).toEqual([]);
  });

  it("returns watchedUsers from config", () => {
    mockGetClickUpConfig.mockReturnValue({
      ...CREDS,
      watchedUsers: [{ id: "wu1", label: "Lead", query: "lead@co.com" }],
    });
    const users = getWatchedUsers();
    expect(users).toHaveLength(1);
    expect(users[0].label).toBe("Lead");
  });
});

// ── listWatchedMemberTasks ────────────────────────────────────────────────────

describe("listWatchedMemberTasks", () => {
  it("returns empty when not configured", async () => {
    const result = await listWatchedMemberTasks({ id: "wu", label: "X", query: "x@co.com" });
    expect(result).toEqual([]);
  });

  it("resolves member by numeric query directly (no team fetch)", async () => {
    stubCreds();
    stubFetch([
      { json: { tasks: [
        { id: "wt1", name: "Numeric task", url: "https://cu/wt/1",
          status: { status: "Open", type: "open", color: null },
          priority: null, assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listWatchedMemberTasks({ id: "wu", label: "User 42", query: "42" });
    expect(result).toHaveLength(1);
  });

  it("returns empty when query is blank", async () => {
    stubCreds();
    const result = await listWatchedMemberTasks({ id: "wu", label: "X", query: "   " });
    expect(result).toEqual([]);
  });

  it("resolves member by email match from team roster", async () => {
    stubCreds();
    stubFetch([
      { json: { teams: [{ id: "TEAMEXT", members: [
        { user: { id: 88, email: "eve@co.com", username: "eve" } },
      ] }] } },
      { json: { tasks: [] } },
    ]);
    const result = await listWatchedMemberTasks({ id: "wu", label: "Eve", query: "eve@co.com" });
    expect(result).toEqual([]);
  });

  it("resolves member by username match", async () => {
    stubCreds();
    stubFetch([
      { json: { teams: [{ id: "TEAMEXT", members: [
        { user: { id: 99, email: null, username: "frank" } },
      ] }] } },
      { json: { tasks: [
        { id: "ft1", name: "Frank task", url: "https://cu/ft/1",
          status: { status: "Open", type: "open", color: null },
          priority: null, assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listWatchedMemberTasks({ id: "wu", label: "Frank", query: "frank" });
    expect(result).toHaveLength(1);
  });

  it("includes done tasks when hideClosed is false", async () => {
    stubCreds();
    stubFetch([
      { json: { teams: [{ id: "TEAMEXT", members: [
        { user: { id: 55, email: "grace@co.com", username: "grace" } },
      ] }] } },
      { json: { tasks: [
        { id: "gt-done", name: "Done", url: "https://cu/gt/d",
          status: { status: "Done", type: "done", color: null },
          priority: null, assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listWatchedMemberTasks({ id: "wu", label: "Grace", query: "grace@co.com", hideClosed: false });
    expect(result).toHaveLength(1);
  });

  it("filters done tasks when hideClosed is unset (default)", async () => {
    stubCreds();
    stubFetch([
      { json: { teams: [{ id: "TEAMEXT", members: [
        { user: { id: 66, email: "henry@co.com", username: "henry" } },
      ] }] } },
      { json: { tasks: [
        { id: "ht-open", name: "Open", url: "https://cu/ht/o",
          status: { status: "In Progress", type: "custom", color: null },
          priority: null, assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
        { id: "ht-done", name: "Done", url: "https://cu/ht/d",
          status: { status: "Done", type: "done", color: null },
          priority: null, assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
        { id: "ht-closed", name: "Closed", url: "https://cu/ht/c",
          status: { status: "Closed", type: "closed", color: null },
          priority: null, assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listWatchedMemberTasks({ id: "wu", label: "Henry", query: "henry@co.com" });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Open");
  });

  it("does not expose statusType in output", async () => {
    stubCreds();
    stubFetch([
      { json: { teams: [{ id: "TEAMEXT", members: [
        { user: { id: 77, email: "ivan@co.com", username: "ivan" } },
      ] }] } },
      { json: { tasks: [
        { id: "it1", name: "Ivan task", url: "https://cu/it/1",
          status: { status: "Open", type: "open", color: null },
          priority: null, assignees: [], list: null, due_date: null, date_updated: "1700000000000" },
      ] } },
    ]);
    const result = await listWatchedMemberTasks({ id: "wu", label: "Ivan", query: "ivan@co.com" });
    expect(result[0]).not.toHaveProperty("statusType");
  });
});
