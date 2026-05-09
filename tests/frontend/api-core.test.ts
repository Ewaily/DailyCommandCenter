/**
 * Tests for the real api.ts fetch client — NOT using vi.mock("...api.js").
 * We stub global fetch to control responses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Do NOT mock api.js — we test the real module.
import { api, ApiError, isAuthError } from "../../src/frontend/api.js";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
}

function errJson(status: number, body?: unknown) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve(body ?? { error: `Error ${status}` }),
  });
}

// ── ApiError ──────────────────────────────────────────────────────────────────

describe("ApiError", () => {
  it("is an instance of Error", () => {
    const e = new ApiError("Not found", 404);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(ApiError);
  });

  it("stores status and message", () => {
    const e = new ApiError("Forbidden", 403);
    expect(e.message).toBe("Forbidden");
    expect(e.status).toBe(403);
  });
});

// ── isAuthError ───────────────────────────────────────────────────────────────

describe("isAuthError", () => {
  it("returns true for 401 ApiError", () => {
    expect(isAuthError(new ApiError("Unauthorized", 401))).toBe(true);
  });

  it("returns true for 403 ApiError", () => {
    expect(isAuthError(new ApiError("Forbidden", 403))).toBe(true);
  });

  it("returns true when message contains not_connected", () => {
    expect(isAuthError(new ApiError("not_connected", 400))).toBe(true);
  });

  it("returns false for non-auth status", () => {
    expect(isAuthError(new ApiError("Server error", 500))).toBe(false);
  });

  it("returns false for plain Error", () => {
    expect(isAuthError(new Error("Not an api error"))).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isAuthError(null)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});

// ── req() via api methods ─────────────────────────────────────────────────────

describe("req() success path", () => {
  it("api.health() resolves with parsed JSON", async () => {
    mockFetch.mockReturnValue(okJson({ ok: true, providers: {} }));
    const result = await api.health();
    expect(result.data.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/health"),
      expect.any(Object),
    );
  });

  it("sends Content-Type: application/json header", async () => {
    mockFetch.mockReturnValue(okJson({ ok: true, providers: {} }));
    await api.health();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });
});

describe("req() error path", () => {
  it("throws ApiError with server error message on non-ok response", async () => {
    mockFetch.mockReturnValue(errJson(404, { error: "Not found" }));
    let caught: unknown;
    try { await api.health(); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(404);
    expect((caught as ApiError).message).toBe("Not found");
  });

  it("throws ApiError with status code string when response body has no error field", async () => {
    mockFetch.mockReturnValue(errJson(500, {}));
    await expect(api.health()).rejects.toMatchObject({ status: 500 });
  });

  it("throws ApiError even when JSON parse fails", async () => {
    mockFetch.mockReturnValue(Promise.resolve({
      ok: false, status: 502,
      json: () => Promise.reject(new Error("bad json")),
    }));
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);
  });
});

// ── withWs() workspace query param ──────────────────────────────────────────

describe("withWs() workspace param injection", () => {
  it("adds workspace= param when dcc-active-workspace is set", async () => {
    localStorage.setItem("dcc-active-workspace", "ws-123");
    mockFetch.mockReturnValue(okJson({ channels: [], msgsPerChannel: 5 }));
    await api.slackDigestConfig();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("workspace=ws-123");
  });

  it("does not add workspace= when no workspace is active", async () => {
    localStorage.removeItem("dcc-active-workspace");
    mockFetch.mockReturnValue(okJson({ channels: [], msgsPerChannel: 5 }));
    await api.slackDigestConfig();
    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain("workspace=");
  });

  it("appends workspace= with & when path already has a query string", async () => {
    localStorage.setItem("dcc-active-workspace", "ws-abc");
    mockFetch.mockReturnValue(okJson([]));
    await api.calendarEvents("2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("&workspace=ws-abc");
  });
});

// ── api methods that were previously uncovered ───────────────────────────────

describe("api.connectorUpdate / connectorDelete", () => {
  it("connectorUpdate sends PATCH with correct body", async () => {
    mockFetch.mockReturnValue(okJson({ id: "ci-1" }));
    await api.connectorUpdate("ci-1", { enabled: false });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/connectors/ci-1");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body)).toMatchObject({ enabled: false });
  });

  it("connectorDelete sends DELETE to correct path", async () => {
    mockFetch.mockReturnValue(okJson({ ok: true }));
    await api.connectorDelete("ci-9");
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/connectors/ci-9");
    expect(opts.method).toBe("DELETE");
  });
});

// ── connectorId optional param branches ──────────────────────────────────────

describe("optional connectorId param branches", () => {
  it("calendarEvents includes connectorId= when provided", async () => {
    mockFetch.mockReturnValue(okJson([]));
    await api.calendarEvents("2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z", "ci-cal");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("connectorId=ci-cal");
  });

  it("slackDigest includes connectorId= when provided", async () => {
    mockFetch.mockReturnValue(okJson([]));
    await api.slackDigest("ci-slack");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("connectorId=ci-slack");
  });

  it("ticketsMine includes connectorId= when provided", async () => {
    mockFetch.mockReturnValue(okJson([]));
    await api.ticketsMine("mine", "ci-jira");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("connectorId=ci-jira");
  });

  it("ticketsTeam includes project= when provided", async () => {
    mockFetch.mockReturnValue(okJson([]));
    await api.ticketsTeam("MY-PROJECT", "ci-jira");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("project=MY-PROJECT");
    expect(url).toContain("connectorId=ci-jira");
  });

  it("prs includes connectorId= when provided", async () => {
    mockFetch.mockReturnValue(okJson([]));
    await api.prs("review", "ci-github");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("connectorId=ci-github");
  });

  it("clickupTasks includes connectorId= when provided", async () => {
    mockFetch.mockReturnValue(okJson([]));
    await api.clickupTasks("mine", "ci-clickup");
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("connectorId=ci-clickup");
  });

  it("todos() calls /todos", async () => {
    mockFetch.mockReturnValue(okJson([]));
    await api.todos();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/todos");
  });

  it("settingsGet() calls /settings", async () => {
    mockFetch.mockReturnValue(okJson({}));
    await api.settingsGet();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/settings");
  });

  it("workspaceCreate sends POST to /workspaces", async () => {
    mockFetch.mockReturnValue(okJson({ id: "ws-new" }));
    await api.workspaceCreate({ name: "My WS" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/workspaces");
    expect(opts.method).toBe("POST");
  });

  it("workspaceUpdate sends PATCH to /workspaces/:id", async () => {
    mockFetch.mockReturnValue(okJson({ id: "ws-1" }));
    await api.workspaceUpdate("ws-1", { name: "Updated" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/workspaces/ws-1");
    expect(opts.method).toBe("PATCH");
  });

  it("workspaceDelete sends DELETE to /workspaces/:id", async () => {
    mockFetch.mockReturnValue(okJson({ ok: true }));
    await api.workspaceDelete("ws-1");
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/workspaces/ws-1");
    expect(opts.method).toBe("DELETE");
  });

  it("workspaceConnectorCreate sends POST to /workspaces/:id/connectors", async () => {
    mockFetch.mockReturnValue(okJson({ id: "ci-new" }));
    await api.workspaceConnectorCreate("ws-1", { type: "jira" });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/workspaces/ws-1/connectors");
    expect(opts.method).toBe("POST");
  });
});
