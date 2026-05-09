import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockFetch, mockGetIdentity, mockUpdateIdentity, mockListIdentities, mockCreateIdentity,
  mockGetAppSetting, mockDbStmt, mockDb,
} = vi.hoisted(() => {
  const dbStmt = { get: vi.fn().mockReturnValue(null), run: vi.fn() };
  const db     = { prepare: vi.fn().mockReturnValue(dbStmt) };
  return {
    mockFetch:          vi.fn(),
    mockGetIdentity:    vi.fn().mockReturnValue(null),
    mockUpdateIdentity: vi.fn(),
    mockListIdentities: vi.fn().mockReturnValue([]),
    mockCreateIdentity: vi.fn().mockReturnValue({ id: "new-ms-id" }),
    mockGetAppSetting:  vi.fn().mockImplementation((_k, def) => def),
    mockDbStmt:         dbStmt,
    mockDb:             db,
  };
});

vi.mock("../src/server/config.js", () => ({
  config: {
    microsoft: {
      clientId:     "ms-cid",
      clientSecret: "ms-cs",
      redirectUri:  "http://localhost:3000/api/auth/microsoft/callback",
      tenantId:     "common",
      scopes:       ["openid", "email", "Calendars.Read"],
    },
  },
}));

vi.mock("../src/server/db.js", () => ({ getDb: vi.fn().mockReturnValue(mockDb) }));
vi.mock("../src/server/lib/app-settings.js",  () => ({ getAppSetting: mockGetAppSetting }));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  getIdentity:    mockGetIdentity,
  updateIdentity: mockUpdateIdentity,
  listIdentities: mockListIdentities,
  createIdentity: mockCreateIdentity,
}));

import {
  microsoftAuthUrl,
  microsoftHandleCallback,
  getMicrosoftToken,
  listOutlookIdentities,
  microsoftStatus,
} from "../src/server/auth/microsoft.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAppSetting.mockImplementation((_k: string, def: string) => def);
  mockGetIdentity.mockReturnValue(null);
  mockListIdentities.mockReturnValue([]);
  mockCreateIdentity.mockReturnValue({ id: "new-ms-id" });
  mockDbStmt.get.mockReturnValue(null);
  mockDb.prepare.mockReturnValue(mockDbStmt);
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => vi.unstubAllGlobals());

// ── microsoftAuthUrl ──────────────────────────────────────────────────────────

describe("microsoftAuthUrl", () => {
  it("returns a URL string containing the auth endpoint", () => {
    const url = microsoftAuthUrl("state-xyz");
    expect(url).toContain("login.microsoftonline.com");
    expect(url).toContain("authorize");
  });

  it("includes state in the URL", () => {
    const url = microsoftAuthUrl("my-state");
    expect(url).toContain("state=my-state");
  });

  it("includes client_id in the URL", () => {
    const url = microsoftAuthUrl("s");
    expect(url).toContain("client_id=ms-cid");
  });

  it("includes tenantId in the auth base URL", () => {
    const url = microsoftAuthUrl("s");
    expect(url).toContain("common");
  });
});

// ── microsoftHandleCallback ───────────────────────────────────────────────────

describe("microsoftHandleCallback", () => {
  function stubTokenExchange(tokenJson: any) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve(tokenJson),
    });
  }

  function stubGraphMe(userJson: any) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve(userJson),
    });
  }

  it("creates a new outlook identity", async () => {
    stubTokenExchange({ access_token: "ms-at", refresh_token: "ms-rt", expires_in: 3600, scope: "openid" });
    stubGraphMe({ mail: "user@outlook.com", displayName: "Test User" });
    const result = await microsoftHandleCallback("auth-code", "ws-1");
    expect(result.identityId).toBe("new-ms-id");
    expect(mockCreateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ type: "outlook", accessToken: "ms-at" }),
    );
  });

  it("handles failed Graph /me call gracefully (non-fatal)", async () => {
    stubTokenExchange({ access_token: "ms-at", expires_in: 3600, scope: "openid" });
    mockFetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve("403"), json: () => Promise.resolve({}) });
    const result = await microsoftHandleCallback("auth-code", "ws-1");
    expect(result.identityId).toBe("new-ms-id");
    expect(mockCreateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ account: "" }),
    );
  });

  it("uses userPrincipalName when mail is absent", async () => {
    stubTokenExchange({ access_token: "ms-at", expires_in: 3600, scope: "openid" });
    stubGraphMe({ userPrincipalName: "upn@company.com", displayName: "UPN User" });
    await microsoftHandleCallback("auth-code", "ws-1");
    expect(mockCreateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ account: "upn@company.com" }),
    );
  });

  it("throws when token exchange fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, text: () => Promise.resolve("invalid_grant") });
    await expect(microsoftHandleCallback("bad-code", "ws-1")).rejects.toThrow();
  });

  it("uses displayName in label", async () => {
    stubTokenExchange({ access_token: "ms-at", expires_in: 3600, scope: "openid" });
    stubGraphMe({ mail: "user@co.com", displayName: "Alice Smith" });
    await microsoftHandleCallback("auth-code", "ws-1");
    expect(mockCreateIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Alice Smith" }),
    );
  });
});

// ── getMicrosoftToken ─────────────────────────────────────────────────────────

describe("getMicrosoftToken", () => {
  it("throws when no access token in identity", async () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: null });
    await expect(getMicrosoftToken("id-1")).rejects.toThrow();
  });

  it("returns access token directly when not expired", async () => {
    const farFuture = Date.now() + 60 * 60 * 1000;
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "valid-at", expiresAt: farFuture });
    const token = await getMicrosoftToken("id-1");
    expect(token).toBe("valid-at");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refreshes token when expired", async () => {
    const nearPast = Date.now() - 1000;
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "old-at", refreshToken: "rt", expiresAt: nearPast });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "new-at", expires_in: 3600 }),
    });
    const token = await getMicrosoftToken("id-1");
    expect(token).toBe("new-at");
    expect(mockUpdateIdentity).toHaveBeenCalledWith("id-1", expect.objectContaining({ accessToken: "new-at" }));
  });

  it("throws when expired and no refresh token", async () => {
    const nearPast = Date.now() - 1000;
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "old-at", refreshToken: null, expiresAt: nearPast });
    await expect(getMicrosoftToken("id-1")).rejects.toThrow(/refresh token/i);
  });

  it("throws when refresh request fails", async () => {
    const nearPast = Date.now() - 1000;
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "old-at", refreshToken: "rt", expiresAt: nearPast });
    mockFetch.mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) });
    await expect(getMicrosoftToken("id-1")).rejects.toThrow();
  });

  it("throws when expiresAt is null and no refresh token", async () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "no-exp-at", refreshToken: null, expiresAt: null });
    await expect(getMicrosoftToken("id-1")).rejects.toThrow();
  });

  it("persists new refresh token to DB after refresh", async () => {
    const nearPast = Date.now() - 1000;
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "old-at", refreshToken: "rt", expiresAt: nearPast });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }),
    });
    await getMicrosoftToken("id-1");
    expect(mockDbStmt.run).toHaveBeenCalled();
  });
});

// ── listOutlookIdentities ─────────────────────────────────────────────────────

describe("listOutlookIdentities", () => {
  it("returns identities from listIdentities('outlook')", () => {
    mockListIdentities.mockReturnValue([{ id: "ol-1", account: "a@b.com" }]);
    const result = listOutlookIdentities();
    expect(result).toHaveLength(1);
    expect(mockListIdentities).toHaveBeenCalledWith("outlook");
  });
});

// ── microsoftStatus ───────────────────────────────────────────────────────────

describe("microsoftStatus", () => {
  it("returns connected=false when identity has no token", () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: null });
    expect(microsoftStatus("id-1")).toEqual({ connected: false });
  });

  it("returns connected=false when identity not found", () => {
    mockGetIdentity.mockReturnValue(null);
    expect(microsoftStatus("id-1")).toEqual({ connected: false });
  });

  it("returns connected=true with account when token present", () => {
    mockGetIdentity.mockReturnValue({ id: "id-1", accessToken: "tok", account: "user@co.com" });
    expect(microsoftStatus("id-1")).toEqual({ connected: true, account: "user@co.com" });
  });
});
