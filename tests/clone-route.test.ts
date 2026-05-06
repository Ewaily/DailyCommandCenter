// Behavioral integration tests for the clone Express router. Mounts the real
// router on an Express app, mocks the integration + workspace-config layers,
// and asserts on real HTTP responses via supertest.
//
// The new clone flow reads the TARGET Jira credentials from the source
// connector's config (`cloneTargetUrl/Email/Token/Project`) — NOT from the
// host workspace's primary Jira creds. This lets a clone cross workspace
// boundaries by storing per-connector destination auth.

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

const fullCloneCfg = {
  cloningEnabled:     true,
  cloneTargetUrl:     "https://target.atlassian.net",
  cloneTargetEmail:   "user@target.com",
  cloneTargetToken:   "TOKEN-XYZ",
  cloneTargetProject: "PROJ",
};

const sourceConnector = (overrides: Record<string, unknown> = {}) => ({
  id:          "ci-source-1",
  workspaceId: "ws-1",
  type:        "clickup",
  identityId:  "id-cu",
  enabled:     true,
  config:      fullCloneCfg,
  ...overrides,
});

const jiraConnector = (overrides: Record<string, unknown> = {}) => ({
  id:          "ci-jira-1",
  workspaceId: "ws-1",
  type:        "jira",
  identityId:  "id-jira",
  enabled:     true,
  config:      { baseUrl: "https://test.atlassian.net", email: "user@test.com" },
  ...overrides,
});

const identityRow = (overrides: Record<string, unknown> = {}) => ({
  id:          "id-jira",
  account:     "user@test.com",
  accessToken: "host-token",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWorkspaceId.mockReturnValue("ws-1");
  mockListConnectorsForWorkspace.mockReturnValue([sourceConnector(), jiraConnector()]);
  mockListConnectorsForOverview.mockReturnValue([sourceConnector(), jiraConnector()]);
  mockGetIdentity.mockReturnValue(identityRow());
});

// ── GET /projects ─────────────────────────────────────────────────────────────

describe("GET /projects", () => {
  it("returns the project list from the host workspace's Jira connector", async () => {
    mockJira.listProjectsWith.mockResolvedValue([{ id: "10000", key: "PROJ", name: "Project Alpha" }]);
    const res = await request(app).get("/projects");
    expect(res.status).toBe(200);
    expect(res.body.data[0].key).toBe("PROJ");
  });

  it("returns notConfigured when no Jira connector is enabled in the workspace", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([sourceConnector()]); // no Jira
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns notConfigured when Jira connector has no token", async () => {
    mockGetIdentity.mockReturnValue({ ...identityRow(), accessToken: "" });
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns notConfigured when Jira connector config has no baseUrl", async () => {
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

  it("filters by ?connectorId", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([
      jiraConnector({ id: "ci-jira-a" }),
      jiraConnector({ id: "ci-jira-b" }),
    ]);
    mockJira.listProjectsWith.mockResolvedValue([]);
    const res = await request(app).get("/projects?connectorId=ci-jira-b");
    expect(res.status).toBe(200);
  });

  it("returns 502 when listProjectsWith throws", async () => {
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

  it("skips disabled Jira connectors", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([jiraConnector({ enabled: false })]);
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });

  it("skips non-jira connector types", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([sourceConnector()]); // clickup only
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });

  it("treats null identityId as no token", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([jiraConnector({ identityId: null })]);
    const res = await request(app).get("/projects");
    expect(res.body.notConfigured).toBe(true);
  });
});

// ── POST /clone-ticket ────────────────────────────────────────────────────────

describe("POST /clone-ticket", () => {
  it("creates a Jira issue using the SOURCE connector's stored target credentials", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "PROJ-42", id: "10042" });
    const res = await request(app)
      .post("/clone-ticket")
      .send({
        sourceProvider: "clickup",
        title:          "Fix bug",
        description:    "details",
        originalLink:   "https://app.clickup.com/t/abc",
        connectorId:    "ci-source-1",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe("PROJ-42");
    expect(res.body.data.url).toBe("https://target.atlassian.net/browse/PROJ-42");

    // Verify createIssue was called with the TARGET creds — NOT the host Jira's creds
    const [creds, payload] = mockJira.createIssue.mock.calls[0];
    expect(creds).toEqual({
      baseUrl:  "https://target.atlassian.net",
      email:    "user@target.com",
      apiToken: "TOKEN-XYZ",
    });
    expect(payload.projectKey).toBe("PROJ");
    expect(payload.summary).toBe("Fix bug");
  });

  it("uses the 'ClickUp' provider label in the ADF builder for clickup source", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("ClickUp", "https://x", "");
  });

  it("uses the 'Jira' provider label for jira source", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([
      jiraConnector({ id: "ci-jira-source", config: fullCloneCfg }),
    ]);
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app).post("/clone-ticket").send({
      sourceProvider: "jira",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-jira-source",
    });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("Jira", "https://x", "");
  });

  it("forwards a non-empty description to the ADF builder", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      description:    "more detail",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("ClickUp", "https://x", "more detail");
  });

  it("forwards an empty description as empty string", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("ClickUp", "https://x", "");
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("required");
  });

  it("returns 400 when originalLink is missing", async () => {
    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      connectorId:    "ci-source-1",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when sourceProvider is missing", async () => {
    const res = await request(app).post("/clone-ticket").send({
      title:        "X",
      originalLink: "https://x",
      connectorId:  "ci-source-1",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when connectorId is missing", async () => {
    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the connectorId does not match any connector in the workspace", async () => {
    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-does-not-exist",
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Connector not found");
  });

  it("returns 503 when the source connector has cloning disabled", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([
      sourceConnector({ config: { ...fullCloneCfg, cloningEnabled: false } }),
    ]);
    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("not fully configured");
  });

  it("returns 503 when any of the four target credentials is empty", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([
      sourceConnector({ config: { ...fullCloneCfg, cloneTargetToken: "" } }),
    ]);
    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(res.status).toBe(503);
  });

  it("returns 502 when createIssue rejects", async () => {
    mockJira.createIssue.mockRejectedValue(new Error("API timeout"));
    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("API timeout");
  });

  it("uses overview connectors when no active workspace is set", async () => {
    mockGetActiveWorkspaceId.mockReturnValue(undefined);
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(res.status).toBe(200);
    expect(mockListConnectorsForOverview).toHaveBeenCalled();
  });
});
