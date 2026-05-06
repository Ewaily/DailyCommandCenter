// Behavioral integration tests for /clickup/tasks route handler.
// Mounts the real Express router, mocks integrations + workspace-config,
// asserts on real HTTP responses via supertest.

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockClickup, mockListWs, mockListOverview, mockGetActiveWs } = vi.hoisted(() => ({
  mockClickup: {
    isConfigured:           vi.fn(),
    getWatchedUsers:        vi.fn(),
    listMyTasks:            vi.fn(),
    listWatchedMemberTasks: vi.fn(),
    MINE_BUCKET_ID:         "mine",
  },
  mockListWs:       vi.fn(),
  mockListOverview: vi.fn(),
  mockGetActiveWs:  vi.fn(),
}));

vi.mock("../src/server/integrations/clickup.js", () => mockClickup);
vi.mock("../src/server/lib/request-context.js", () => ({
  getActiveWorkspaceId: mockGetActiveWs,
}));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  listConnectorsForWorkspace: mockListWs,
  listConnectorsForOverview:  mockListOverview,
  getIdentity:                vi.fn(),
}));

import { clickupRouter } from "../src/server/routes/clickup.js";

const app = express();
app.use(express.json());
app.use(clickupRouter);

const clickupConnector = (overrides: Record<string, unknown> = {}) => ({
  id:          "ci-cu-1",
  workspaceId: "ws-1",
  type:        "clickup",
  identityId:  "id-cu",
  enabled:     true,
  config:      { teamId: "12345", cloningEnabled: true, defaultTargetProject: "PROJ" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWs.mockReturnValue("ws-1");
  mockListWs.mockReturnValue([clickupConnector()]);
  mockListOverview.mockReturnValue([clickupConnector()]);
  mockClickup.isConfigured.mockReturnValue(true);
  mockClickup.getWatchedUsers.mockReturnValue([]);
  mockClickup.listMyTasks.mockResolvedValue([]);
  mockClickup.listWatchedMemberTasks.mockResolvedValue([]);
});

describe("GET /tasks (clickup)", () => {
  it("returns notConfigured when no clickup connector is enabled", async () => {
    mockListWs.mockReturnValue([]);
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    expect(res.body.notConfigured).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.buckets).toEqual([]);
  });

  it("returns notConfigured when isConfigured returns false", async () => {
    mockClickup.isConfigured.mockReturnValue(false);
    const res = await request(app).get("/tasks");
    expect(res.body.notConfigured).toBe(true);
  });

  it("skips disabled connectors", async () => {
    mockListWs.mockReturnValue([clickupConnector({ enabled: false })]);
    const res = await request(app).get("/tasks");
    expect(res.body.notConfigured).toBe(true);
  });

  it("skips non-clickup connector types", async () => {
    mockListWs.mockReturnValue([clickupConnector({ type: "jira" })]);
    const res = await request(app).get("/tasks");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns tasks from listMyTasks for the mine bucket by default", async () => {
    mockClickup.listMyTasks.mockResolvedValue([
      { id: "t1", title: "Task 1", url: "https://app.clickup.com/t/t1" },
    ]);
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe("mine");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.counts.mine).toBe(1);
  });

  it("returns connectorCloningConfig from the connector's config", async () => {
    const res = await request(app).get("/tasks");
    expect(res.body.connectorCloningConfig).toEqual({
      cloningEnabled:       true,
      defaultTargetProject: "PROJ",
    });
  });

  it("returns disabled cloning config when connector has none", async () => {
    mockListWs.mockReturnValue([clickupConnector({ config: { teamId: "1" } })]);
    const res = await request(app).get("/tasks");
    expect(res.body.connectorCloningConfig).toEqual({
      cloningEnabled:       false,
      defaultTargetProject: "",
    });
  });

  it("filters by connectorId query param", async () => {
    mockListWs.mockReturnValue([
      clickupConnector({ id: "ci-cu-1" }),
      clickupConnector({ id: "ci-cu-2", config: { teamId: "2", cloningEnabled: false, defaultTargetProject: "OTHER" } }),
    ]);
    const res = await request(app).get("/tasks?connectorId=ci-cu-2");
    expect(res.body.connectorCloningConfig.defaultTargetProject).toBe("OTHER");
  });

  it("includes watched users in buckets and unions across connectors", async () => {
    mockClickup.getWatchedUsers.mockReturnValue([{ id: "u1", label: "Alice" }]);
    const res = await request(app).get("/tasks");
    expect(res.body.buckets).toEqual([{ id: "u1", label: "Alice" }]);
  });

  it("de-dupes watched users by id", async () => {
    mockClickup.getWatchedUsers.mockReturnValue([
      { id: "u1", label: "Alice" },
      { id: "u1", label: "Alice (dup)" },
      { id: "u2", label: "Bob" },
    ]);
    const res = await request(app).get("/tasks");
    expect(res.body.buckets).toHaveLength(2);
  });

  it("falls back to mine bucket when requested bucket is unknown", async () => {
    const res = await request(app).get("/tasks?bucket=ghost");
    expect(res.body.bucket).toBe("mine");
  });

  it("honors a valid watched-user bucket request", async () => {
    mockClickup.getWatchedUsers.mockReturnValue([{ id: "u1", label: "Alice" }]);
    mockClickup.listWatchedMemberTasks.mockResolvedValue([
      { id: "t2", title: "T2", url: "https://app.clickup.com/t/t2" },
    ]);
    const res = await request(app).get("/tasks?bucket=u1");
    expect(res.body.bucket).toBe("u1");
    expect(res.body.data).toHaveLength(1);
  });

  it("de-dupes tasks across workspaces by url", async () => {
    mockClickup.listMyTasks.mockResolvedValueOnce([
      { id: "t1", title: "T1", url: "https://app.clickup.com/t/t1" },
      { id: "t1", title: "T1 dup", url: "https://app.clickup.com/t/t1" },
    ]);
    const res = await request(app).get("/tasks");
    expect(res.body.data).toHaveLength(1);
  });

  it("recovers gracefully when listMyTasks rejects (per workspace)", async () => {
    mockClickup.listMyTasks.mockRejectedValueOnce(new Error("CU 500"));
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("uses overview connectors when no active workspace is set", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(200);
    expect(mockListOverview).toHaveBeenCalled();
  });

  it("returns 502 when getWatchedUsers throws synchronously", async () => {
    mockClickup.getWatchedUsers.mockImplementation(() => { throw new Error("DB exploded"); });
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("DB exploded");
  });

  it("returns 502 with default message when caught error has no message", async () => {
    mockClickup.getWatchedUsers.mockImplementation(() => { throw {}; });
    const res = await request(app).get("/tasks");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("ClickUp API error");
  });
});
