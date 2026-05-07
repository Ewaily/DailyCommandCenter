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

const mockStmt = { run: vi.fn() };
const mockDb   = { prepare: vi.fn().mockReturnValue(mockStmt) };

const { mockJira, mockClickup, mockListConnectorsForWorkspace, mockListConnectorsForOverview, mockGetIdentity, mockGetActiveWorkspaceId } =
  vi.hoisted(() => ({
    mockJira: {
      listProjectsWith:      vi.fn(),
      createIssue:           vi.fn(),
      buildCloneAdf:         vi.fn().mockReturnValue({ type: "doc", version: 1, content: [] }),
      getIssueDescription:   vi.fn().mockResolvedValue(null),
      getIssueDetails:       vi.fn().mockResolvedValue({ description: null, attachments: [] }),
      getIssueAttachments:   vi.fn().mockResolvedValue([]),
      downloadJiraFile:      vi.fn().mockResolvedValue(null),
      uploadAttachment:      vi.fn().mockResolvedValue(undefined),
    },
    mockClickup: {
      getTaskDescription:   vi.fn().mockResolvedValue(null),
      getTaskAttachments:   vi.fn().mockResolvedValue([]),
      downloadClickUpFile:  vi.fn().mockResolvedValue(null),
    },
    mockListConnectorsForWorkspace: vi.fn(),
    mockListConnectorsForOverview:  vi.fn(),
    mockGetIdentity:                vi.fn(),
    mockGetActiveWorkspaceId:       vi.fn(),
  }));

vi.mock("../src/server/integrations/jira.js",    () => mockJira);
vi.mock("../src/server/integrations/clickup.js", () => mockClickup);
vi.mock("../src/server/db.js", () => ({ getDb: () => mockDb }));
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

// ── GET /clone-history ────────────────────────────────────────────────────────

describe("GET /clone-history", () => {
  it("returns an empty data object when no rows exist", async () => {
    mockDb.prepare.mockReturnValue({ all: vi.fn().mockReturnValue([]) });
    const res = await request(app).get("/clone-history");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({});
  });

  it("groups rows by source_url keeping only the most recent per URL", async () => {
    mockDb.prepare.mockReturnValue({
      all: vi.fn().mockReturnValue([
        { source_url: "https://cu/t/1", source_title: "Bug fix", cloned_key: "P-2", cloned_url: "https://jira/P-2", cloned_at: 2000 },
        { source_url: "https://cu/t/1", source_title: "Bug fix", cloned_key: "P-1", cloned_url: "https://jira/P-1", cloned_at: 1000 },
        { source_url: "https://cu/t/2", source_title: "Feature", cloned_key: "P-3", cloned_url: "https://jira/P-3", cloned_at: 3000 },
      ]),
      run: vi.fn(),
    });
    const res = await request(app).get("/clone-history");
    expect(res.status).toBe(200);
    // First occurrence wins (rows already ordered DESC by cloned_at)
    expect(res.body.data["https://cu/t/1"].key).toBe("P-2");
    expect(res.body.data["https://cu/t/2"].key).toBe("P-3");
    expect(Object.keys(res.body.data)).toHaveLength(2);
  });

  it("includes key, url, title, and clonedAt in each entry", async () => {
    mockDb.prepare.mockReturnValue({
      all: vi.fn().mockReturnValue([
        { source_url: "https://cu/t/abc", source_title: "My task", cloned_key: "PROJ-7", cloned_url: "https://jira/PROJ-7", cloned_at: 9999 },
      ]),
      run: vi.fn(),
    });
    const res = await request(app).get("/clone-history");
    const entry = res.body.data["https://cu/t/abc"];
    expect(entry.key).toBe("PROJ-7");
    expect(entry.url).toBe("https://jira/PROJ-7");
    expect(entry.title).toBe("My task");
    expect(entry.clonedAt).toBe(9999);
  });
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

  it("uses ?url/email/token directly without consulting workspace connectors", async () => {
    mockJira.listProjectsWith.mockResolvedValue([{ id: "20000", key: "TGT", name: "Target Project" }]);
    const res = await request(app)
      .get("/projects?url=https%3A%2F%2Ftarget.atlassian.net&email=me%40example.com&token=secret");
    expect(res.status).toBe(200);
    expect(res.body.data[0].key).toBe("TGT");
    const [calledCreds] = mockJira.listProjectsWith.mock.calls.at(-1)!;
    expect(calledCreds.baseUrl).toBe("https://target.atlassian.net");
    expect(calledCreds.email).toBe("me@example.com");
    expect(calledCreds.apiToken).toBe("secret");
    expect(mockListConnectorsForWorkspace).not.toHaveBeenCalled();
  });

  it("returns notConfigured when only some of url/email/token are provided", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([]);
    const res = await request(app).get("/projects?url=https%3A%2F%2Ftarget.atlassian.net&email=me%40example.com");
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
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("ClickUp", "https://x", null);
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
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("Jira", "https://x", null);
  });

  it("fetches ClickUp task description when URL contains a valid task ID", async () => {
    mockClickup.getTaskDescription.mockResolvedValue("Full task details here");
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://app.clickup.com/t/abc123",
      connectorId:    "ci-source-1",
    });
    expect(mockClickup.getTaskDescription).toHaveBeenCalledWith("abc123", expect.anything());
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("ClickUp", "https://app.clickup.com/t/abc123", "Full task details here");
  });

  it("fetches Jira issue description when URL contains a valid issue key", async () => {
    mockListConnectorsForWorkspace.mockReturnValue([
      jiraConnector({ id: "ci-jira-src", config: { baseUrl: "https://src.atlassian.net", ...fullCloneCfg }, identityId: "id-j" }),
    ]);
    mockGetIdentity.mockReturnValue({ accessToken: "tok", account: "u@j.com" });
    mockJira.getIssueDetails.mockResolvedValue({ description: { type: "doc", version: 1, content: [] }, attachments: [] });
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app).post("/clone-ticket").send({
      sourceProvider: "jira",
      title:          "Fix bug",
      originalLink:   "https://src.atlassian.net/browse/PROJ-42",
      connectorId:    "ci-jira-src",
    });
    expect(mockJira.getIssueDetails).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: expect.any(String) }),
      "PROJ-42",
    );
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith(
      "Jira",
      "https://src.atlassian.net/browse/PROJ-42",
      { type: "doc", version: 1, content: [] },
    );
  });

  it("passes null description when URL does not contain a parseable ID", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://x",
      connectorId:    "ci-source-1",
    });
    expect(mockJira.buildCloneAdf).toHaveBeenCalledWith("ClickUp", "https://x", null);
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

  it("uploads ClickUp image attachments to the new Jira issue", async () => {
    const imgBuf = Buffer.from("fake-png-bytes");
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    mockClickup.getTaskAttachments.mockResolvedValue([
      { id: "a1", title: "screenshot.png", url: "https://cdn.clickup.com/screenshot.png", size: 1024 },
    ]);
    mockClickup.downloadClickUpFile.mockResolvedValue({ buffer: imgBuf, mimeType: "image/png" });

    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://app.clickup.com/t/abc123",
      connectorId:    "ci-source-1",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.attachmentsCloned).toBe(1);
    expect(mockJira.uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://target.atlassian.net" }),
      "P-1",
      "screenshot.png",
      imgBuf,
      "image/png",
    );
  });

  it("skips ClickUp attachments whose download returns a non-media mimeType", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    mockClickup.getTaskAttachments.mockResolvedValue([
      { id: "a1", title: "screenshot.png", url: "https://cdn.clickup.com/x.png", size: 100 },
    ]);
    mockClickup.downloadClickUpFile.mockResolvedValue({ buffer: Buffer.from("x"), mimeType: "text/plain" });

    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://app.clickup.com/t/abc123",
      connectorId:    "ci-source-1",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.attachmentsCloned).toBe(0);
    expect(mockJira.uploadAttachment).not.toHaveBeenCalled();
  });

  it("skips ClickUp attachments that exceed 25 MB size limit", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    mockClickup.getTaskAttachments.mockResolvedValue([
      { id: "a1", title: "huge.mp4", url: "https://cdn.clickup.com/huge.mp4", size: 30 * 1024 * 1024 },
    ]);

    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://app.clickup.com/t/abc123",
      connectorId:    "ci-source-1",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.attachmentsCloned).toBe(0);
    expect(mockClickup.downloadClickUpFile).not.toHaveBeenCalled();
  });

  it("uploads Jira source image attachments to the target Jira issue", async () => {
    const imgBuf = Buffer.from("fake-jpg-bytes");
    mockListConnectorsForWorkspace.mockReturnValue([
      jiraConnector({ id: "ci-jira-src", config: { baseUrl: "https://src.atlassian.net", ...fullCloneCfg }, identityId: "id-j" }),
    ]);
    mockGetIdentity.mockReturnValue({ accessToken: "tok", account: "u@j.com" });
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    mockJira.getIssueDetails.mockResolvedValue({
      description: { type: "doc", version: 1, content: [] },
      attachments: [
        { filename: "design.jpg", url: "https://src.atlassian.net/secure/attachment/1/design.jpg", mimeType: "image/jpeg", size: 2048 },
      ],
    });
    mockJira.downloadJiraFile.mockResolvedValue({ buffer: imgBuf, mimeType: "application/octet-stream" }); // CDN returns generic type

    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "jira",
      title:          "Fix bug",
      originalLink:   "https://src.atlassian.net/browse/PROJ-42",
      connectorId:    "ci-jira-src",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.attachmentsCloned).toBe(1);
    // mimeType must come from the Jira API (att.mimeType), not the CDN Content-Type header
    expect(mockJira.uploadAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://target.atlassian.net" }),
      "P-1",
      "design.jpg",
      imgBuf,
      "image/jpeg",
    );
  });

  it("still returns 200 when attachment upload throws (best-effort)", async () => {
    mockJira.createIssue.mockResolvedValue({ key: "P-1", id: "1" });
    mockClickup.getTaskAttachments.mockResolvedValue([
      { id: "a1", title: "img.png", url: "https://cdn.clickup.com/img.png", size: 100 },
    ]);
    mockClickup.downloadClickUpFile.mockResolvedValue({ buffer: Buffer.from("x"), mimeType: "image/png" });
    mockJira.uploadAttachment.mockRejectedValue(new Error("Jira attachment limit exceeded"));

    const res = await request(app).post("/clone-ticket").send({
      sourceProvider: "clickup",
      title:          "X",
      originalLink:   "https://app.clickup.com/t/abc123",
      connectorId:    "ci-source-1",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.key).toBe("P-1");
  });
});
