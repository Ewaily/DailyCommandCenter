// Behavioral integration tests for /tickets routes (mine + team).

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockJira, mockListWs, mockListOverview, mockGetIdentity, mockGetActiveWs } = vi.hoisted(() => ({
  mockJira: {
    listMineWith:         vi.fn(),
    listWatchedUserWith:  vi.fn(),
    listTeamIssuesWith:   vi.fn(),
    MINE_BUCKET_ID:       "mine",
  },
  mockListWs:       vi.fn(),
  mockListOverview: vi.fn(),
  mockGetIdentity:  vi.fn(),
  mockGetActiveWs:  vi.fn(),
}));

vi.mock("../src/server/integrations/jira.js", () => mockJira);
vi.mock("../src/server/lib/request-context.js", () => ({
  getActiveWorkspaceId: mockGetActiveWs,
}));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  listConnectorsForWorkspace: mockListWs,
  listConnectorsForOverview:  mockListOverview,
  getIdentity:                mockGetIdentity,
}));

import { ticketsRouter } from "../src/server/routes/tickets.js";

const app = express();
app.use(express.json());
app.use(ticketsRouter);

const jiraConnector = (overrides: Record<string, unknown> = {}) => ({
  id:          "ci-jira-1",
  workspaceId: "ws-1",
  type:        "jira",
  identityId:  "id-1",
  enabled:     true,
  config:      {
    baseUrl: "https://test.atlassian.net",
    email:   "user@test.com",
    cloningEnabled: true,
    cloneTargetProject: "PROJ",
  },
  ...overrides,
});

const identityRow = (overrides: Record<string, unknown> = {}) => ({
  id:          "id-1",
  account:     "user@test.com",
  accessToken: "token-abc",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWs.mockReturnValue("ws-1");
  mockListWs.mockReturnValue([jiraConnector()]);
  mockListOverview.mockReturnValue([jiraConnector()]);
  mockGetIdentity.mockReturnValue(identityRow());
  mockJira.listMineWith.mockResolvedValue([]);
  mockJira.listWatchedUserWith.mockResolvedValue([]);
  mockJira.listTeamIssuesWith.mockResolvedValue([]);
});

// ── GET /mine ─────────────────────────────────────────────────────────────────

describe("GET /mine", () => {
  it("returns notConfigured when no Jira connector is enabled", async () => {
    mockListWs.mockReturnValue([]);
    const res = await request(app).get("/mine");
    expect(res.status).toBe(200);
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns connectorCloningConfig from the primary resolved connector", async () => {
    const res = await request(app).get("/mine");
    expect(res.body.connectorCloningConfig).toMatchObject({
      cloningEnabled:     true,
      cloneTargetProject: "PROJ",
      connectorId:        "ci-jira-1",
    });
  });

  it("returns mine tickets from listMineWith by default", async () => {
    mockJira.listMineWith.mockResolvedValue([
      { url: "https://test.atlassian.net/browse/X-1", key: "X-1", title: "T1" },
    ]);
    const res = await request(app).get("/mine");
    expect(res.body.bucket).toBe("mine");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.counts.mine).toBe(1);
  });

  it("de-dupes tickets by url+key across multiple connectors", async () => {
    mockListWs.mockReturnValue([
      jiraConnector({ id: "c1" }),
      jiraConnector({ id: "c2" }),
    ]);
    const dup = { url: "https://test.atlassian.net/browse/X-1", key: "X-1", title: "T" };
    mockJira.listMineWith.mockResolvedValue([dup]);
    const res = await request(app).get("/mine");
    expect(res.body.data).toHaveLength(1);
  });

  it("includes watched users in buckets", async () => {
    mockListWs.mockReturnValue([
      jiraConnector({
        config: {
          baseUrl: "https://test.atlassian.net",
          email:   "user@test.com",
          watchedUsers: [{ id: "u1", label: "Alice" }],
        },
      }),
    ]);
    const res = await request(app).get("/mine");
    expect(res.body.buckets).toEqual([{ id: "u1", label: "Alice" }]);
  });

  it("falls back to mine bucket when requested bucket is unknown", async () => {
    const res = await request(app).get("/mine?bucket=ghost");
    expect(res.body.bucket).toBe("mine");
  });

  it("returns watched user tickets when bucket is requested", async () => {
    mockListWs.mockReturnValue([
      jiraConnector({
        config: {
          baseUrl: "https://test.atlassian.net",
          email:   "user@test.com",
          watchedUsers: [{ id: "u1", label: "Alice" }],
        },
      }),
    ]);
    mockJira.listWatchedUserWith.mockResolvedValue([
      { url: "https://test.atlassian.net/browse/X-2", key: "X-2", title: "T" },
    ]);
    const res = await request(app).get("/mine?bucket=u1");
    expect(res.body.bucket).toBe("u1");
    expect(res.body.data).toHaveLength(1);
  });

  it("recovers when listMineWith rejects per connector", async () => {
    mockJira.listMineWith.mockRejectedValue(new Error("502"));
    const res = await request(app).get("/mine");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("scopes to a specific connector via ?connectorId", async () => {
    mockListWs.mockReturnValue([
      jiraConnector({ id: "c1", config: { baseUrl: "https://a", email: "a@a", cloningEnabled: false, cloneTargetProject: "A" } }),
      jiraConnector({ id: "c2", config: { baseUrl: "https://b", email: "b@b", cloningEnabled: true, cloneTargetProject: "B" } }),
    ]);
    const res = await request(app).get("/mine?connectorId=c2");
    expect(res.body.connectorCloningConfig.cloneTargetProject).toBe("B");
  });

  it("uses overview connectors when no active workspace is set", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    const res = await request(app).get("/mine");
    expect(res.status).toBe(200);
    expect(mockListOverview).toHaveBeenCalled();
  });

  it("skips connectors missing token/baseUrl/email", async () => {
    mockGetIdentity.mockReturnValue({ ...identityRow(), accessToken: "" });
    const res = await request(app).get("/mine");
    expect(res.body.notConfigured).toBe(true);
  });
});

// ── GET /team ─────────────────────────────────────────────────────────────────

describe("GET /team", () => {
  it("returns notConfigured when no Jira connector is enabled", async () => {
    mockListWs.mockReturnValue([]);
    const res = await request(app).get("/team");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns the team issue list", async () => {
    mockJira.listTeamIssuesWith.mockResolvedValue([
      { url: "https://test.atlassian.net/browse/X-1", key: "X-1", title: "T" },
    ]);
    const res = await request(app).get("/team");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("forwards the project query param to listTeamIssuesWith", async () => {
    await request(app).get("/team?project=PROJ");
    expect(mockJira.listTeamIssuesWith).toHaveBeenCalledWith(expect.anything(), "PROJ");
  });

  it("de-dupes team tickets by url+key", async () => {
    const dup = { url: "https://test.atlassian.net/browse/X-1", key: "X-1", title: "T" };
    mockListWs.mockReturnValue([
      jiraConnector({ id: "c1" }),
      jiraConnector({ id: "c2" }),
    ]);
    mockJira.listTeamIssuesWith.mockResolvedValue([dup]);
    const res = await request(app).get("/team");
    expect(res.body.data).toHaveLength(1);
  });

  it("recovers when listTeamIssuesWith rejects", async () => {
    mockJira.listTeamIssuesWith.mockRejectedValue(new Error("Boom"));
    const res = await request(app).get("/team");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("scopes by ?connectorId query param", async () => {
    mockListWs.mockReturnValue([
      jiraConnector({ id: "c1" }),
      jiraConnector({ id: "c2" }),
    ]);
    const res = await request(app).get("/team?connectorId=c1");
    expect(res.status).toBe(200);
  });
});
