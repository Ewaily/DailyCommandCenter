import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockFetch, mockGetIdentity, mockUpdateIdentity, mockListIdentities, mockCreateIdentity,
  mockListConnectorInstances, mockCreateConnectorInstance, mockGetWorkspace,
  mockGetAppSetting, mockDbStmt, mockDb,
} = vi.hoisted(() => {
  const dbStmt = { get: vi.fn().mockReturnValue(null), run: vi.fn(), all: vi.fn().mockReturnValue([]) };
  const db     = { prepare: vi.fn().mockReturnValue(dbStmt) };
  return {
    mockFetch:                   vi.fn(),
    mockGetIdentity:             vi.fn().mockReturnValue(null),
    mockUpdateIdentity:          vi.fn(),
    mockListIdentities:          vi.fn().mockReturnValue([]),
    mockCreateIdentity:          vi.fn().mockReturnValue({ id: "new-sl-id" }),
    mockListConnectorInstances:  vi.fn().mockReturnValue([]),
    mockCreateConnectorInstance: vi.fn(),
    mockGetWorkspace:            vi.fn().mockReturnValue({ id: "ws-1", name: "My WS" }),
    mockGetAppSetting:           vi.fn().mockImplementation((_k, def) => def),
    mockDbStmt:                  dbStmt,
    mockDb:                      db,
  };
});

vi.mock("../src/server/config.js", () => ({
  config: {
    slack: {
      clientId:     "sl-cid",
      clientSecret: "sl-cs",
      redirectUri:  "http://localhost:3000/api/auth/slack/callback",
      userScopes:   ["channels:history", "search:read"],
      userId:       "U_ENV",
      userToken:    "",
    },
  },
}));
vi.mock("../src/server/db.js", () => ({ getDb: vi.fn().mockReturnValue(mockDb) }));
vi.mock("../src/server/lib/app-settings.js",  () => ({ getAppSetting: mockGetAppSetting }));
vi.mock("../src/server/lib/errors.js",         () => ({ NotConnectedError: class NotConnectedError extends Error {} }));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  getIdentity:             mockGetIdentity,
  updateIdentity:          mockUpdateIdentity,
  listIdentities:          mockListIdentities,
  createIdentity:          mockCreateIdentity,
  listConnectorInstances:  mockListConnectorInstances,
  createConnectorInstance: mockCreateConnectorInstance,
  getWorkspace:            mockGetWorkspace,
}));

import {
  slackAuthUrl,
  slackHandleCallback,
  getSlackToken,
  getSlackUserId,
  slackStatus,
} from "../src/server/auth/slack.js";

function stubOauthResponse(json: any) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(json),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAppSetting.mockImplementation((_k: string, def: string) => def);
  mockGetIdentity.mockReturnValue(null);
  mockListIdentities.mockReturnValue([]);
  mockCreateIdentity.mockReturnValue({ id: "new-sl-id" });
  mockGetWorkspace.mockReturnValue({ id: "ws-1", name: "My WS" });
  mockListConnectorInstances.mockReturnValue([]);
  mockDbStmt.get.mockReturnValue(null);
  mockDb.prepare.mockReturnValue(mockDbStmt);
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => vi.unstubAllGlobals());

// ── slackAuthUrl ──────────────────────────────────────────────────────────────

describe("slackAuthUrl", () => {
  it("returns slack OAuth authorize URL", () => {
    const url = slackAuthUrl("test-state");
    expect(url).toContain("slack.com/oauth/v2/authorize");
  });

  it("includes state parameter", () => {
    const url = slackAuthUrl("my-state");
    expect(url).toContain("state=my-state");
  });

  it("includes client_id", () => {
    const url = slackAuthUrl("s");
    expect(url).toContain("client_id=sl-cid");
  });

  it("includes user_scope", () => {
    const url = slackAuthUrl("s");
    expect(url).toContain("user_scope=");
  });
});

// ── slackHandleCallback — workspace path ──────────────────────────────────────

describe("slackHandleCallback — workspace path", () => {
  it("throws when Slack API returns error", async () => {
    stubOauthResponse({ ok: false, error: "invalid_code" });
    await expect(slackHandleCallback("bad-code", "ws-1")).rejects.toThrow(/invalid_code/);
  });

  it("throws when authed_user.access_token is missing", async () => {
    stubOauthResponse({ ok: true, authed_user: { id: "U1", access_token: "" } });
    await expect(slackHandleCallback("code", "ws-1")).rejects.toThrow(/missing user token/);
  });

  it("creates a new identity on first connect", async () => {
    stubOauthResponse({ ok: true, authed_user: { id: "U_NEW", access_token: "xoxp-tok", scope: "channels:history" } });
    await slackHandleCallback("code", "ws-1");
    expect(mockCreateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "slack", accessToken: "xoxp-tok", account: "U_NEW" }),
    );
  });

  it("reuses existing identity when same userId", async () => {
    mockListIdentities.mockReturnValue([{ id: "sl-existing", account: "U_EXIST" }]);
    stubOauthResponse({ ok: true, authed_user: { id: "U_EXIST", access_token: "xoxp-new", scope: "" } });
    await slackHandleCallback("code", "ws-1");
    expect(mockUpdateIdentity).toHaveBeenCalledWith("sl-existing", { accessToken: "xoxp-new" });
    expect(mockCreateIdentity).not.toHaveBeenCalled();
  });

  it("creates slack connector when none exists", async () => {
    stubOauthResponse({ ok: true, authed_user: { id: "U2", access_token: "xoxp-tok", scope: "" } });
    await slackHandleCallback("code", "ws-1");
    expect(mockCreateConnectorInstance).toHaveBeenCalledWith(
      expect.objectContaining({ type: "slack", workspaceId: "ws-1" }),
    );
  });

  it("updates existing connector when one already exists", async () => {
    mockListConnectorInstances.mockReturnValue([{ id: "ci-sl", type: "slack" }]);
    stubOauthResponse({ ok: true, authed_user: { id: "U3", access_token: "xoxp-tok", scope: "" } });
    await slackHandleCallback("code", "ws-1");
    expect(mockCreateConnectorInstance).not.toHaveBeenCalled();
    expect(mockDbStmt.run).toHaveBeenCalled();
  });

  it("addAnother always creates new identity and connector", async () => {
    mockListIdentities.mockReturnValue([{ id: "sl-existing", account: "U_EXIST" }]);
    mockListConnectorInstances.mockReturnValue([{ id: "ci-sl", type: "slack" }]);
    stubOauthResponse({ ok: true, authed_user: { id: "U_EXIST", access_token: "xoxp-new", scope: "" } });
    await slackHandleCallback("code", "ws-1", { addAnother: true });
    expect(mockCreateIdentity).toHaveBeenCalled();
    expect(mockCreateConnectorInstance).toHaveBeenCalled();
  });
});

// ── slackHandleCallback — legacy null path ────────────────────────────────────

describe("slackHandleCallback — legacy null path", () => {
  it("writes to tokens table when workspaceId is null", async () => {
    stubOauthResponse({ ok: true, authed_user: { id: "U_LEG", access_token: "xoxp-leg", scope: "" } });
    await slackHandleCallback("code", null);
    expect(mockDbStmt.run).toHaveBeenCalled();
    expect(mockCreateIdentity).not.toHaveBeenCalled();
  });

  it("writes to tokens table when workspace not found", async () => {
    mockGetWorkspace.mockReturnValue(null);
    stubOauthResponse({ ok: true, authed_user: { id: "U_BAD", access_token: "xoxp-bad", scope: "" } });
    await slackHandleCallback("code", "ws-bad");
    expect(mockDbStmt.run).toHaveBeenCalled();
    expect(mockCreateIdentity).not.toHaveBeenCalled();
  });
});

// ── getSlackToken ─────────────────────────────────────────────────────────────

describe("getSlackToken", () => {
  it("returns identity token when identity has accessToken", () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "xoxp-identity" });
    expect(getSlackToken("id-1")).toBe("xoxp-identity");
  });

  it("falls back to tokens DB row when identity missing", () => {
    mockGetIdentity.mockReturnValue(null);
    mockDbStmt.get.mockReturnValue({ access_token: "xoxp-db" });
    expect(getSlackToken(null)).toBe("xoxp-db");
  });

  it("falls back to DB row when identityId provided but no token", () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: null });
    mockDbStmt.get.mockReturnValue({ access_token: "xoxp-db2" });
    expect(getSlackToken("id-1")).toBe("xoxp-db2");
  });

  it("throws NotConnectedError when no token anywhere", () => {
    mockGetIdentity.mockReturnValue(null);
    mockDbStmt.get.mockReturnValue(null);
    expect(() => getSlackToken(null)).toThrow();
  });
});

// ── getSlackUserId ────────────────────────────────────────────────────────────

describe("getSlackUserId", () => {
  it("returns identity account when available", () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", account: "U_IDENT" });
    expect(getSlackUserId("id-1")).toBe("U_IDENT");
  });

  it("falls back to tokens DB row account", () => {
    mockGetIdentity.mockReturnValue(null);
    mockDbStmt.get.mockReturnValue({ account: "U_DB" });
    expect(getSlackUserId(null)).toBe("U_DB");
  });

  it("falls back to env userId when no DB row", () => {
    mockGetIdentity.mockReturnValue(null);
    mockDbStmt.get.mockReturnValue(null);
    expect(getSlackUserId(null)).toBe("U_ENV");
  });
});

// ── slackStatus ───────────────────────────────────────────────────────────────

describe("slackStatus", () => {
  it("returns connected=false when no identities, no tokens, no env token", () => {
    mockListIdentities.mockReturnValue([]);
    mockDbStmt.get.mockReturnValue(null);
    expect(slackStatus()).toEqual({ connected: false });
  });

  it("returns connected=true from identities", () => {
    mockListIdentities.mockReturnValue([{ id: "id-1", account: "U_SLACK" }]);
    expect(slackStatus()).toEqual({ connected: true, account: "U_SLACK" });
  });

  it("returns connected=true from tokens DB row", () => {
    mockListIdentities.mockReturnValue([]);
    mockDbStmt.get.mockReturnValue({ account: "U_TOKENS" });
    expect(slackStatus()).toEqual({ connected: true, account: "U_TOKENS" });
  });

  it("returns connected=true when identity account is undefined", () => {
    mockListIdentities.mockReturnValue([{ id: "id-1", account: null }]);
    expect(slackStatus().connected).toBe(true);
    expect(slackStatus().account).toBeUndefined();
  });
});
