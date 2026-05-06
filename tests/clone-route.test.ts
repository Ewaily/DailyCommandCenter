// Behavioral integration tests for the clone Express router. Mounts the
// real router on an Express app, mocks the integration + workspace-config
// dependencies, and asserts on real HTTP responses via supertest.

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockJira, mockListConnectorsForWorkspace, mockListConnectorsForOverview, mockGetIdentity, mockGetActiveWorkspaceId } =
  vi.hoisted(() => ({
    mockJira: {
      listProjectsWith: vi.fn(),
      createIssue:      vi.fn(),
      buildCloneAdf:    vi.fn().mockReturnValue({ type: "doc", version: 1, content: [] }),
    },
    mockListConnectorsForWorkspace: vi.fn(),
    mockListConnectorsForOverview:  vi.fn(),
    mockGetIdentity:                vi.fn(),
    mockGetActiveWorkspaceId:       vi.fn(),
  }));

vi.mock("../src/server/integrations/jira.js", () => mockJira);
vi.mock("../src/server/lib/request-context.js", () => ({
  getActiveWorkspaceId: mockGetActiveWorkspaceId,
}));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  listConnectorsForWorkspace: mockListConnectorsForWorkspace,
  listConnectorsForOverview:  mockListConnectorsForOverview,
  getIdentity:                mockGetIdentity,
}));

import { cloneRouter } from "../src/server/routes/clone.js";

const app = express();
app.use(express.json());
app.use(cloneRouter);

const jiraConnector = (overrides: Record<string, unknown> = {}) => ({
  id:          "ci-jira-1",
  workspaceId: "ws-1",
  type:        "jira",
  identityId:  "id-1",
  enabled:     true,
  config:      { baseUrl: "https://test.atlassian.net", email: "user@test.com" },
  ...overrides,
});

const identityRow = (overrides: Record<string, unknown> = {}) => ({
  id:           "id-1",
  account:      "user@test.com",
  accessToken:  "token-abc",
  refreshToken: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWorkspaceId.mockReturnValue("ws-1");
  mockListConnectorsForWorkspace.mockReturnValue([jiraConnector()]);
  mockListConnectorsForOverview.mockReturnValue([jiraConnector()]);
  mockGetIdentity.mockReturnValue(identityRow());
});

// ── GET /projects ─────────────────────────────────────────────────────────────

describe("GET /projects", () => {
  it("returns the project list when Jira is configured", async () => {
    mockJira.listProjectsWith.mockResolvedValue([
      { id: "10000", key: "PROJ", name: "Project Alpha" },
    ]);
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].key).toBe("PROJ");
  });

  it("returns notConfigured when no Jira connector is enabled", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([]);
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    expect(res.body.notConfigured).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("returns notConfigured when connector has no token", async () => {
    mockGetIdentity.mockReturnValue({ ...identityRow(), accessToken: "" });
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns notConfigured when connector config has no baseUrl", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([
      jiraConnector({ config: { email: "user@test.com" } }),
    ]);
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });

  it("falls back to identity account when config.email is missing", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([
      jiraConnector({ config: { baseUrl: "https://test.atlassian.net" } }),
    ]);
    mockJira.listProjectsWith.mockResolvedValue([]);
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
  });

  it("filters by connectorId when scopeId is given via ?connectorId=", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([
      jiraConnector({ id: "ci-jira-1" }),
      jiraConnector({ id: "ci-jira-2" }),
    ]);
    mockJira.listProjectsWith.mockResolvedValue([]);
    const res = await request(app).get("/projects?connectorId=ci-jira-2");
    expect(res.status).toBe(200);
  });

  it("returns 502 when Jira API throws", async () => {
    mockJira.listProjectsWith.mockRejectedValue(new Error("Jira down"));
    const res = await request(app).get("/projects");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("Jira down");
  });

  it("uses overview connectors when no active workspace is set", async () => {
    mockGetActiveWorkspaceId.mockReturnValue(undefined);
    mockJira.listProjectsWith.mockResolvedValue([]);
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    expect(mockListConnectorsForOverview).toHaveBeenCalled();
  });

  it("skips disabled connectors", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([jiraConnector({ enabled: false })]);
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });

  it("skips non-jira connector types", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([jiraConnector({ type: "github" })]);
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });

  it("handles connector with null identityId gracefully", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([jiraConnector({ identityId: null })]);
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });
});

// ── POST /clone-ticket ────────────────────────────────────────────────────────

describe("POST /clone-ticket", () => {
  it("creates a Jira issue and returns key+id+url", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "PROJ-42", id: "10042" });
    const res = await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "clickup",
        title:               "Fix bug",
        description:         "details",
        originalLink:        "https://app.clickup.com/t/abc",
        targetJiraProjectId: "PROJ",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe("PROJ-42");
    expect(res.body.data.id).toBe("10042");
    expect(res.body.data.url).toBe("https://test.atlassian.net/browse/PROJ-42");
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "clickup",
        originalLink:        "https://app.clickup.com/t/abc",
        targetJiraProjectId: "PROJ",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("required");
  });

  it("returns 400 when originalLink is missing", async () => {
    const res = await request(app)
      .post("/clone-ticket")
      .send({ sourceProvider: "jira", title: "X", targetJiraProjectId: "PROJ" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when targetJiraProjectId is missing", async () => {
    const res = await request(app)
      .post("/clone-ticket")
      .send({ sourceProvider: "jira", title: "X", originalLink: "https://x" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when sourceProvider is missing", async () => {
    const res = await request(app)
      .post("/clone-ticket")
      .send({ title: "X", originalLink: "https://x", targetJiraProjectId: "PROJ" });
    expect(res.status).toBe(400);
  });

  it("returns 503 when no Jira connector is configured", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([]);
    const res = await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "jira",
        title:               "X",
        originalLink:        "https://x",
        targetJiraProjectId: "PROJ",
      });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("No Jira connector");
  });

  it("returns 502 when createIssue rejects", async () => {
    mockJira.createIssue.mockRejectedValue(new Error("API timeout"));
    const res = await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "clickup",
        title:               "X",
        originalLink:        "https://x",
        targetJiraProjectId: "PROJ",
      });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("API timeout");
  });

  it("uses 'ClickUp' label in ADF builder for clickup source", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "clickup",
        title:               "X",
        originalLink:        "https://x",
        targetJiraProjectId: "PROJ",
      });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("ClickUp", "https://x", "");
  });

  it("uses 'Jira' label in ADF builder for jira source", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "jira",
        title:               "X",
        originalLink:        "https://x",
        targetJiraProjectId: "PROJ",
      });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("Jira", "https://x", "");
  });

  it("passes connectorId scope to resolveFirstJira", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    mockListConnectorsForWorkspace.mockReturnValue([
      jiraConnector({ id: "ci-jira-1" }),
      jiraConnector({ id: "ci-jira-2" }),
    ]);
    const res = await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "jira",
        title:               "X",
        originalLink:        "https://x",
        targetJiraProjectId: "PROJ",
        connectorId:         "ci-jira-2",
      });
    expect(res.status).toBe(200);
  });

  it("forwards an empty description as empty string to ADF", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "jira",
        title:               "X",
        originalLink:        "https://x",
        targetJiraProjectId: "PROJ",
      });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("Jira", "https://x", "");
  });

  it("forwards a non-empty description through to ADF builder", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider:      "jira",
        title:               "X",
        description:         "more detail",
        originalLink:        "https://x",
        targetJiraProjectId: "PROJ",
      });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("Jira", "https://x", "more detail");
  });
});
