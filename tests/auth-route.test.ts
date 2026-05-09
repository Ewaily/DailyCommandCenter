import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";

const {
  mockGoogleAuthUrl, mockGoogleHandleCallback, mockGoogleStatus,
  mockSlackAuthUrl, mockSlackHandleCallback, mockSlackStatus,
  mockMicrosoftAuthUrl, mockMicrosoftHandleCallback,
  mockGetWorkspace, mockListIdentities, mockCreateConnectorInstance,
} = vi.hoisted(() => ({
  mockGoogleAuthUrl:            vi.fn().mockReturnValue("https://accounts.google.com/oauth2?state=s"),
  mockGoogleHandleCallback:     vi.fn().mockResolvedValue(undefined),
  mockGoogleStatus:             vi.fn().mockReturnValue({ connected: false }),
  mockSlackAuthUrl:             vi.fn().mockReturnValue("https://slack.com/oauth/v2/authorize?state=s"),
  mockSlackHandleCallback:      vi.fn().mockResolvedValue(undefined),
  mockSlackStatus:              vi.fn().mockReturnValue({ connected: false }),
  mockMicrosoftAuthUrl:         vi.fn().mockReturnValue("https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=s"),
  mockMicrosoftHandleCallback:  vi.fn().mockResolvedValue({ identityId: "new-ms-id" }),
  mockGetWorkspace:             vi.fn().mockReturnValue({ id: "ws-1", name: "My WS" }),
  mockListIdentities:           vi.fn().mockReturnValue([]),
  mockCreateConnectorInstance:  vi.fn(),
}));

vi.mock("../src/server/auth/google.js", () => ({
  googleAuthUrl:         mockGoogleAuthUrl,
  googleHandleCallback:  mockGoogleHandleCallback,
  googleStatus:          mockGoogleStatus,
}));
vi.mock("../src/server/auth/slack.js", () => ({
  slackAuthUrl:         mockSlackAuthUrl,
  slackHandleCallback:  mockSlackHandleCallback,
  slackStatus:          mockSlackStatus,
}));
vi.mock("../src/server/auth/microsoft.js", () => ({
  microsoftAuthUrl:         mockMicrosoftAuthUrl,
  microsoftHandleCallback:  mockMicrosoftHandleCallback,
}));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  createConnectorInstance: mockCreateConnectorInstance,
  getWorkspace:            mockGetWorkspace,
  listIdentities:          mockListIdentities,
}));

let testDb: InstanceType<typeof Database>;
vi.mock("../src/server/db.js", () => ({ getDb: () => testDb }));

import { authRouter } from "../src/server/routes/auth.js";

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();

  testDb = new Database(":memory:");
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS oauth_state (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      code_verifier TEXT,
      created_at INTEGER NOT NULL,
      context TEXT
    )
  `);

  mockGoogleStatus.mockReturnValue({ connected: false });
  mockSlackStatus.mockReturnValue({ connected: false });
  mockListIdentities.mockReturnValue([]);
  mockGetWorkspace.mockReturnValue({ id: "ws-1", name: "My WS" });
  mockGoogleHandleCallback.mockResolvedValue(undefined);
  mockSlackHandleCallback.mockResolvedValue(undefined);
  mockMicrosoftHandleCallback.mockResolvedValue({ identityId: "new-ms-id" });

  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
});

// ── /:provider/start ──────────────────────────────────────────────────────────

describe("GET /:provider/start", () => {
  it("redirects to google auth URL for google provider", async () => {
    const res = await request(app).get("/api/auth/google/start");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("accounts.google.com");
  });

  it("redirects to slack auth URL for slack provider", async () => {
    const res = await request(app).get("/api/auth/slack/start");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("slack.com");
  });

  it("redirects to microsoft auth URL for microsoft provider", async () => {
    const res = await request(app).get("/api/auth/microsoft/start");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("microsoftonline.com");
  });

  it("returns 404 for unknown provider", async () => {
    const res = await request(app).get("/api/auth/notreal/start");
    expect(res.status).toBe(404);
  });

  it("includes workspaceId in context when provided", async () => {
    const res = await request(app).get("/api/auth/google/start?workspaceId=ws-123");
    expect(res.status).toBe(302);
    const row = testDb.prepare("SELECT context FROM oauth_state").get() as any;
    expect(JSON.parse(row.context)).toMatchObject({ workspaceId: "ws-123" });
  });

  it("includes addAnother flag in context when provided", async () => {
    await request(app).get("/api/auth/google/start?addAnother=1");
    const row = testDb.prepare("SELECT context FROM oauth_state").get() as any;
    expect(JSON.parse(row.context)).toMatchObject({ addAnother: true });
  });

  it("stores null context when no query params", async () => {
    await request(app).get("/api/auth/google/start");
    const row = testDb.prepare("SELECT context FROM oauth_state").get() as any;
    expect(row.context).toBeNull();
  });
});

// ── /:provider/callback ───────────────────────────────────────────────────────

function insertState(provider: string, context: string | null = null, createdAt?: number) {
  const state = "test-state-" + Math.random().toString(36).slice(2);
  testDb.prepare("INSERT INTO oauth_state (state, provider, code_verifier, created_at, context) VALUES (?, ?, NULL, ?, ?)")
    .run(state, provider, createdAt ?? Date.now(), context);
  return state;
}

describe("GET /:provider/callback", () => {
  it("returns 400 when error query param is present", async () => {
    const res = await request(app).get("/api/auth/google/callback?error=access_denied");
    expect(res.status).toBe(400);
    expect(res.text).toContain("access_denied");
  });

  it("returns 400 when code or state missing", async () => {
    const res = await request(app).get("/api/auth/google/callback?code=abc");
    expect(res.status).toBe(400);
  });

  it("returns 400 when state is stale (expired)", async () => {
    const staleTs = Date.now() - 15 * 60 * 1000;
    const state = insertState("google", null, staleTs);
    const res = await request(app).get(`/api/auth/google/callback?code=c&state=${state}`);
    expect(res.status).toBe(400);
  });

  it("returns 400 when state not found in DB", async () => {
    const res = await request(app).get("/api/auth/google/callback?code=c&state=not-exist");
    expect(res.status).toBe(400);
  });

  it("handles google callback successfully", async () => {
    const state = insertState("google");
    const res = await request(app).get(`/api/auth/google/callback?code=auth-code&state=${state}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("google connected");
    expect(mockGoogleHandleCallback).toHaveBeenCalledWith("auth-code", null, { addAnother: false });
  });

  it("handles google callback with workspaceId from context", async () => {
    const state = insertState("google", JSON.stringify({ workspaceId: "ws-abc" }));
    const res = await request(app).get(`/api/auth/google/callback?code=auth-code&state=${state}`);
    expect(res.status).toBe(200);
    expect(mockGoogleHandleCallback).toHaveBeenCalledWith("auth-code", "ws-abc", { addAnother: false });
  });

  it("handles slack callback successfully", async () => {
    const state = insertState("slack");
    const res = await request(app).get(`/api/auth/slack/callback?code=sl-code&state=${state}`);
    expect(res.status).toBe(200);
    expect(mockSlackHandleCallback).toHaveBeenCalled();
  });

  it("handles microsoft callback — requires workspaceId", async () => {
    const state = insertState("microsoft", null);
    const res = await request(app).get(`/api/auth/microsoft/callback?code=ms-code&state=${state}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain("workspaceId");
  });

  it("handles microsoft callback with valid workspaceId", async () => {
    const state = insertState("microsoft", JSON.stringify({ workspaceId: "ws-1" }));
    const res = await request(app).get(`/api/auth/microsoft/callback?code=ms-code&state=${state}`);
    expect(res.status).toBe(200);
    expect(mockMicrosoftHandleCallback).toHaveBeenCalledWith("ms-code", "ws-1");
    expect(mockCreateConnectorInstance).toHaveBeenCalled();
  });

  it("returns 404 for unknown provider in callback", async () => {
    const state = insertState("github");
    const res = await request(app).get(`/api/auth/github/callback?code=c&state=${state}`);
    expect(res.status).toBe(404);
  });

  it("returns 500 when handler throws", async () => {
    mockGoogleHandleCallback.mockRejectedValueOnce(new Error("token exchange failed"));
    const state = insertState("google");
    const res = await request(app).get(`/api/auth/google/callback?code=c&state=${state}`);
    expect(res.status).toBe(500);
    expect(res.text).toContain("Auth failed");
  });

  it("handles addAnother flag from context", async () => {
    const state = insertState("google", JSON.stringify({ workspaceId: "ws-1", addAnother: true }));
    await request(app).get(`/api/auth/google/callback?code=c&state=${state}`);
    expect(mockGoogleHandleCallback).toHaveBeenCalledWith("c", "ws-1", { addAnother: true });
  });
});

// ── /:provider/status ─────────────────────────────────────────────────────────

describe("GET /:provider/status", () => {
  it("returns google connected=false status", async () => {
    const res = await request(app).get("/api/auth/google/status");
    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(false);
  });

  it("returns google connected=true status", async () => {
    mockGoogleStatus.mockReturnValue({ connected: true, account: "user@gmail.com" });
    const res = await request(app).get("/api/auth/google/status");
    expect(res.body.data).toEqual({ connected: true, account: "user@gmail.com" });
  });

  it("returns slack status", async () => {
    mockSlackStatus.mockReturnValue({ connected: true, account: "U_SLACK" });
    const res = await request(app).get("/api/auth/slack/status");
    expect(res.body.data.connected).toBe(true);
  });

  it("returns microsoft status based on outlook identities", async () => {
    mockListIdentities.mockReturnValue([{ id: "ol-1", account: "user@outlook.com" }]);
    const res = await request(app).get("/api/auth/microsoft/status");
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.account).toBe("user@outlook.com");
  });

  it("returns microsoft not connected when no identities", async () => {
    mockListIdentities.mockReturnValue([]);
    const res = await request(app).get("/api/auth/microsoft/status");
    expect(res.body.data.connected).toBe(false);
  });

  it("returns 404 for unknown provider status", async () => {
    const res = await request(app).get("/api/auth/unknown/status");
    expect(res.status).toBe(404);
  });
});
