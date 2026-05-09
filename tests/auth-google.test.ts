import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockGenerateAuthUrl, mockGetToken, mockSetCredentials, mockOn,
  mockGetIdentity, mockUpdateIdentity, mockListIdentities, mockCreateIdentity,
  mockListConnectorInstances, mockCreateConnectorInstance, mockGetWorkspace,
  mockGetAppSetting, mockUserinfoGet, mockDbStmt, mockDbGet,
} = vi.hoisted(() => {
  const dbStmt = { get: vi.fn().mockReturnValue(null), run: vi.fn(), all: vi.fn().mockReturnValue([]) };
  return {
    mockGenerateAuthUrl:         vi.fn().mockReturnValue("https://accounts.google.com/oauth2"),
    mockGetToken:                vi.fn().mockResolvedValue({ tokens: { access_token: "at", refresh_token: "rt", expiry_date: 9999, scope: "email" } }),
    mockSetCredentials:          vi.fn(),
    mockOn:                      vi.fn(),
    mockGetIdentity:             vi.fn().mockReturnValue(null),
    mockUpdateIdentity:          vi.fn(),
    mockListIdentities:          vi.fn().mockReturnValue([]),
    mockCreateIdentity:          vi.fn().mockReturnValue({ id: "new-id" }),
    mockListConnectorInstances:  vi.fn().mockReturnValue([]),
    mockCreateConnectorInstance: vi.fn(),
    mockGetWorkspace:            vi.fn().mockReturnValue({ id: "ws-1", name: "My WS" }),
    mockGetAppSetting:           vi.fn().mockImplementation((_k, def) => def),
    mockUserinfoGet:             vi.fn().mockResolvedValue({ data: { email: "user@test.com" } }),
    mockDbStmt:                  dbStmt,
    mockDbGet:                   dbStmt.get,
  };
});

vi.mock("googleapis", () => ({
  google: {
    // Use a plain function that delegates to hoisted mocks — avoids vi.fn() inside factory
    auth: {
      OAuth2: function OAuth2Mock() {
        return {
          generateAuthUrl: (...a: any[]) => mockGenerateAuthUrl(...a),
          getToken:        (...a: any[]) => mockGetToken(...a),
          setCredentials:  (...a: any[]) => mockSetCredentials(...a),
          on:              (...a: any[]) => mockOn(...a),
        };
      },
    },
    oauth2: () => ({ userinfo: { get: (...a: any[]) => mockUserinfoGet(...a) } }),
  },
}));

vi.mock("../src/server/config.js", () => ({
  config: {
    google: {
      clientId: "cid", clientSecret: "cs",
      redirectUri: "http://localhost:3000/api/auth/google/callback",
      scopes: ["email"],
    },
  },
}));

vi.mock("../src/server/db.js", () => ({
  getDb: () => ({ prepare: () => mockDbStmt }),
}));

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
  googleAuthUrl,
  getGoogleAuth,
  googleHandleCallback,
  googleStatus,
} from "../src/server/auth/google.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAppSetting.mockImplementation((_k: string, def: string) => def);
  mockGetIdentity.mockReturnValue(null);
  mockListIdentities.mockReturnValue([]);
  mockCreateIdentity.mockReturnValue({ id: "new-id" });
  mockGetWorkspace.mockReturnValue({ id: "ws-1", name: "My WS" });
  mockListConnectorInstances.mockReturnValue([]);
  mockDbGet.mockReturnValue(null);
  mockGenerateAuthUrl.mockReturnValue("https://accounts.google.com/oauth2");
  mockGetToken.mockResolvedValue({ tokens: { access_token: "at", refresh_token: "rt", expiry_date: 9999, scope: "email" } });
  mockUserinfoGet.mockResolvedValue({ data: { email: "user@test.com" } });
});

afterEach(() => vi.restoreAllMocks());

// ── googleAuthUrl ─────────────────────────────────────────────────────────────

describe("googleAuthUrl", () => {
  it("returns a URL string", () => {
    const url = googleAuthUrl("state-123");
    expect(typeof url).toBe("string");
  });

  it("passes state to generateAuthUrl", () => {
    googleAuthUrl("my-state");
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ state: "my-state" }),
    );
  });

  it("requests offline access", () => {
    googleAuthUrl("x");
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ access_type: "offline" }),
    );
  });
});

// ── getGoogleAuth — identity path ─────────────────────────────────────────────

describe("getGoogleAuth — identity path", () => {
  it("throws when identity has no accessToken", async () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: null });
    await expect(getGoogleAuth("id-1")).rejects.toThrow();
  });

  it("calls setCredentials when identity has accessToken", async () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "tok", refreshToken: "rt", expiresAt: 9999 });
    await getGoogleAuth("id-1");
    expect(mockSetCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "tok" }),
    );
  });

  it("registers token refresh listener", async () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "tok" });
    await getGoogleAuth("id-1");
    expect(mockOn).toHaveBeenCalledWith("tokens", expect.any(Function));
  });

  it("updates identity when token refresh event fires", async () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "tok" });
    await getGoogleAuth("id-1");
    const [, listener] = mockOn.mock.calls[0];
    listener({ access_token: "new-at", refresh_token: "new-rt", expiry_date: 99999 });
    expect(mockUpdateIdentity).toHaveBeenCalledWith("id-1", expect.objectContaining({ accessToken: "new-at" }));
  });
});

// ── getGoogleAuth — legacy null path ─────────────────────────────────────────

describe("getGoogleAuth — legacy null path", () => {
  it("throws when no tokens row in DB", async () => {
    mockDbGet.mockReturnValue(null);
    await expect(getGoogleAuth(null)).rejects.toThrow();
  });

  it("uses tokens DB row credentials", async () => {
    mockDbGet.mockReturnValue({ access_token: "legacy-at", refresh_token: "legacy-rt", expires_at: 9999 });
    await getGoogleAuth(null);
    expect(mockSetCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "legacy-at" }),
    );
  });

  it("registers token refresh listener for legacy path", async () => {
    mockDbGet.mockReturnValue({ access_token: "legacy-at", refresh_token: "rt", expires_at: 9999 });
    await getGoogleAuth(null);
    expect(mockOn).toHaveBeenCalledWith("tokens", expect.any(Function));
  });
});

// ── googleHandleCallback — workspace path ─────────────────────────────────────

describe("googleHandleCallback — workspace path", () => {
  it("creates a new identity when no existing one matches", async () => {
    mockListIdentities.mockReturnValue([]);
    await googleHandleCallback("auth-code", "ws-1");
    expect(mockCreateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "google", accessToken: "at" }),
    );
  });

  it("reuses existing identity when same account", async () => {
    mockListIdentities.mockReturnValue([{ id: "existing-id", account: "user@test.com" }]);
    await googleHandleCallback("auth-code", "ws-1");
    expect(mockUpdateIdentity).toHaveBeenCalledWith("existing-id", expect.objectContaining({ accessToken: "at" }));
    expect(mockCreateIdentity).not.toHaveBeenCalled();
  });

  it("creates connector when no gcal connector exists", async () => {
    mockListConnectorInstances.mockReturnValue([]);
    await googleHandleCallback("auth-code", "ws-1");
    expect(mockCreateConnectorInstance).toHaveBeenCalledWith(
      expect.objectContaining({ type: "gcal", workspaceId: "ws-1" }),
    );
  });

  it("updates existing connector when gcal connector already exists", async () => {
    mockListConnectorInstances.mockReturnValue([{ id: "ci-1", type: "gcal" }]);
    await googleHandleCallback("auth-code", "ws-1");
    expect(mockCreateConnectorInstance).not.toHaveBeenCalled();
    expect(mockDbStmt.run).toHaveBeenCalled();
  });

  it("creates fresh identity and connector with addAnother=true", async () => {
    mockListIdentities.mockReturnValue([{ id: "existing-id", account: "user@test.com" }]);
    mockListConnectorInstances.mockReturnValue([{ id: "ci-1", type: "gcal" }]);
    await googleHandleCallback("auth-code", "ws-1", { addAnother: true });
    expect(mockCreateIdentity).toHaveBeenCalled();
    expect(mockCreateConnectorInstance).toHaveBeenCalled();
  });

  it("uses fallback label when account email is empty", async () => {
    mockUserinfoGet.mockResolvedValue({ data: { email: "" } });
    mockListIdentities.mockReturnValue([]);
    await googleHandleCallback("auth-code", "ws-1");
    expect(mockCreateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Google Calendar" }),
    );
  });

  it("handles userinfo fetch failure gracefully", async () => {
    mockUserinfoGet.mockRejectedValueOnce(new Error("scope missing"));
    await expect(googleHandleCallback("auth-code", "ws-1")).resolves.toBeUndefined();
  });
});

// ── googleHandleCallback — legacy null path ───────────────────────────────────

describe("googleHandleCallback — legacy null path", () => {
  it("writes to tokens table when workspaceId is null", async () => {
    await googleHandleCallback("auth-code", null);
    expect(mockDbStmt.run).toHaveBeenCalled();
    expect(mockCreateIdentity).not.toHaveBeenCalled();
  });

  it("writes to tokens table when workspace not found", async () => {
    mockGetWorkspace.mockReturnValue(null);
    await googleHandleCallback("auth-code", "ws-bad");
    expect(mockDbStmt.run).toHaveBeenCalled();
    expect(mockCreateIdentity).not.toHaveBeenCalled();
  });
});

// ── googleStatus ──────────────────────────────────────────────────────────────

describe("googleStatus", () => {
  it("returns connected=false when no identities and no tokens row", () => {
    mockListIdentities.mockReturnValue([]);
    mockDbGet.mockReturnValue(null);
    expect(googleStatus()).toEqual({ connected: false });
  });

  it("returns connected=true with account from identity", () => {
    mockListIdentities.mockReturnValue([{ id: "id-1", account: "user@test.com" }]);
    expect(googleStatus()).toEqual({ connected: true, account: "user@test.com" });
  });

  it("returns connected=true from legacy tokens row", () => {
    mockListIdentities.mockReturnValue([]);
    mockDbGet.mockReturnValue({ account: "legacy@test.com" });
    expect(googleStatus()).toEqual({ connected: true, account: "legacy@test.com" });
  });

  it("returns undefined account when identity account is null", () => {
    mockListIdentities.mockReturnValue([{ id: "id-1", account: null }]);
    const result = googleStatus();
    expect(result.connected).toBe(true);
    expect(result.account).toBeUndefined();
  });
});
