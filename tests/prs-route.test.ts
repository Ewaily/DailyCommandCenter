import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockGithub, mockListWs, mockListOverview, mockGetIdentity, mockGetActiveWs } = vi.hoisted(() => ({
  mockGithub: {
    listBucketWith: vi.fn(),
  },
  mockListWs:       vi.fn(),
  mockListOverview: vi.fn(),
  mockGetIdentity:  vi.fn(),
  mockGetActiveWs:  vi.fn(),
}));

vi.mock("../src/server/integrations/github.js", () => mockGithub);
vi.mock("../src/server/lib/request-context.js", () => ({ getActiveWorkspaceId: mockGetActiveWs }));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  listConnectorsForWorkspace: mockListWs,
  listConnectorsForOverview:  mockListOverview,
  getIdentity:                mockGetIdentity,
}));

import { prsRouter } from "../src/server/routes/prs.js";

const app = express();
app.use(express.json());
app.use(prsRouter);

const ghConnector = (overrides: Record<string, unknown> = {}) => ({
  id: "gh-1", type: "github", enabled: true, identityId: "id-1",
  workspaceId: "ws-1",
  config: { username: "alice", repo: "alice/repo" },
  ...overrides,
});
const identity = { id: "id-1", accessToken: "ghp_token", account: "alice" };

const fakePr = (url: string) => ({ url, title: `PR at ${url}`, number: 1, state: "open" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWs.mockReturnValue("ws-1");
  mockListWs.mockReturnValue([ghConnector()]);
  mockListOverview.mockReturnValue([ghConnector()]);
  mockGetIdentity.mockReturnValue(identity);
  // Default: listBucketWith returns empty array for all buckets
  mockGithub.listBucketWith.mockResolvedValue([]);
});

describe("GET /queue", () => {
  it("returns notConfigured when no GitHub connectors are enabled", async () => {
    mockListWs.mockReturnValue([]);
    const res = await request(app).get("/queue");
    expect(res.status).toBe(200);
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns notConfigured when connector has no token", async () => {
    mockGetIdentity.mockReturnValue({ ...identity, accessToken: "" });
    const res = await request(app).get("/queue");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns notConfigured when connector has no repo", async () => {
    mockListWs.mockReturnValue([ghConnector({ config: { username: "alice", repo: "" } })]);
    const res = await request(app).get("/queue");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns notConfigured when both config.username and identity.account are empty", async () => {
    mockListWs.mockReturnValue([ghConnector({ config: { username: "", repo: "alice/repo" } })]);
    mockGetIdentity.mockReturnValue({ ...identity, accessToken: "ghp_token", account: "" });
    const res = await request(app).get("/queue");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns review bucket by default", async () => {
    const pr = fakePr("https://github.com/alice/repo/pull/1");
    mockGithub.listBucketWith.mockImplementation((_creds: any, bucket: string) =>
      bucket === "review" ? Promise.resolve([pr]) : Promise.resolve([]),
    );
    const res = await request(app).get("/queue");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.bucket).toBe("review");
  });

  it("returns mine bucket when ?bucket=mine", async () => {
    const pr = fakePr("https://github.com/alice/repo/pull/2");
    mockGithub.listBucketWith.mockImplementation((_creds: any, bucket: string) =>
      bucket === "mine" ? Promise.resolve([pr]) : Promise.resolve([]),
    );
    const res = await request(app).get("/queue?bucket=mine");
    expect(res.body.bucket).toBe("mine");
    expect(res.body.data).toHaveLength(1);
  });

  it("falls back to review bucket for unknown bucket param", async () => {
    const res = await request(app).get("/queue?bucket=unknown");
    expect(res.body.bucket).toBe("review");
  });

  it("deduplicates PRs by URL across multiple connectors", async () => {
    const dup = fakePr("https://github.com/alice/repo/pull/1");
    mockListWs.mockReturnValue([ghConnector({ id: "c1" }), ghConnector({ id: "c2" })]);
    mockGithub.listBucketWith.mockResolvedValue([dup]);
    const res = await request(app).get("/queue");
    expect(res.body.data).toHaveLength(1);
  });

  it("continues when one connector's listBucketWith rejects", async () => {
    mockGithub.listBucketWith.mockRejectedValue(new Error("API error"));
    const res = await request(app).get("/queue");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns correct counts per bucket", async () => {
    const pr1 = fakePr("https://github.com/alice/repo/pull/1");
    const pr2 = fakePr("https://github.com/alice/repo/pull/2");
    mockGithub.listBucketWith.mockImplementation((_creds: any, bucket: string) => {
      if (bucket === "review") return Promise.resolve([pr1]);
      if (bucket === "mine")   return Promise.resolve([pr2]);
      return Promise.resolve([]);
    });
    const res = await request(app).get("/queue");
    expect(res.body.counts.review).toBe(1);
    expect(res.body.counts.mine).toBe(1);
    expect(res.body.counts.all).toBe(0);
  });

  it("scopes to connectorId when query param is provided", async () => {
    mockListWs.mockReturnValue([ghConnector({ id: "c1" }), ghConnector({ id: "c2" })]);
    await request(app).get("/queue?connectorId=c1");
    // listBucketWith should only be called for c1 credentials
    expect(mockGithub.listBucketWith).toHaveBeenCalled();
  });

  it("uses overview connectors when no workspace is active", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    await request(app).get("/queue");
    expect(mockListOverview).toHaveBeenCalled();
  });

  it("skips disabled connectors", async () => {
    mockListWs.mockReturnValue([ghConnector({ enabled: false })]);
    const res = await request(app).get("/queue");
    expect(res.body.notConfigured).toBe(true);
  });

  it("uses identity.account as username fallback when config.username is missing", async () => {
    mockListWs.mockReturnValue([ghConnector({ config: { repo: "alice/repo" } })]);
    const pr = fakePr("https://github.com/alice/repo/pull/99");
    mockGithub.listBucketWith.mockImplementation((_c: any, b: string) =>
      b === "review" ? Promise.resolve([pr]) : Promise.resolve([]),
    );
    const res = await request(app).get("/queue");
    expect(res.body.data).toHaveLength(1);
  });
});
