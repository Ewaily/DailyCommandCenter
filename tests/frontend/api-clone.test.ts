// Tests for the new api.ts methods added in this PR: cloneTicket and
// jiraProjects. We import the real api object (no module mock) and stub
// global fetch so the underlying req() wrapper actually executes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../../src/frontend/api.js";

const okResponse = (body: unknown, init: Partial<Response> = {}) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve(body),
  ...init,
} as Response);

const errResponse = (status: number, body: unknown) => ({
  ok: false,
  status,
  json: () => Promise.resolve(body),
} as Response);

beforeEach(() => {
  // Mocking localStorage for the active workspace lookup
  globalThis.localStorage = {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: 0,
  } as unknown as Storage;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api.cloneTicket", () => {
  it("POSTs to /api/jira/clone-ticket with the JSON-encoded payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({
      data: { key: "PROJ-1", id: "1", url: "https://jira.example.com/browse/PROJ-1" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.cloneTicket({
      sourceProvider:      "clickup",
      title:               "Build feature",
      originalLink:        "https://app.clickup.com/t/abc",
      connectorId:         "ci-source-1",
    });
    expect(result.data.key).toBe("PROJ-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jira/clone-ticket");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toMatchObject({
      sourceProvider:      "clickup",
      title:               "Build feature",
      originalLink:        "https://app.clickup.com/t/abc",
      connectorId:         "ci-source-1",
    });
  });

  it("appends ?workspace= when an active workspace is set", async () => {
    (globalThis.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("ws-42");
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: { key: "K", id: "I", url: "u" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.cloneTicket({
      sourceProvider:      "jira",
      title:               "X",
      originalLink:        "https://x",
      connectorId:         "ci-source-1",
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("workspace=ws-42");
  });

  it("throws ApiError when the server returns a non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(errResponse(500, { error: "Boom" })));
    await expect(api.cloneTicket({
      sourceProvider:      "jira",
      title:               "X",
      originalLink:        "https://x",
      connectorId:         "ci-source-1",
    })).rejects.toThrow("Boom");
  });
});

describe("api.ticketsMine", () => {
  it("GETs /api/tickets/mine?bucket=mine by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({
      data: [],
      buckets: [],
      counts: {},
      connectorCloningConfig: { cloningEnabled: false, cloneTargetProject: "" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await api.ticketsMine();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tickets/mine?bucket=mine");
    expect(res.connectorCloningConfig).toBeDefined();
  });

  it("includes the connectorId query param when provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ data: [], buckets: [], counts: {} })));
    await api.ticketsMine("u1", "ci-1");
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toContain("bucket=u1");
    expect(url).toContain("connectorId=ci-1");
  });
});

describe("api.clickupTasks", () => {
  it("GETs /api/clickup/tasks?bucket=mine by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({
      data: [],
      buckets: [],
      counts: {},
      connectorCloningConfig: { cloningEnabled: false, cloneTargetProject: "" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await api.clickupTasks();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/clickup/tasks?bucket=mine");
    expect(res.connectorCloningConfig).toBeDefined();
  });

  it("includes the connectorId query param when provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ data: [], buckets: [], counts: {} })));
    await api.clickupTasks("u1", "ci-cu");
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(url).toContain("bucket=u1");
    expect(url).toContain("connectorId=ci-cu");
  });
});

describe("api.jiraProjects", () => {
  it("GETs /api/jira/projects without connectorId", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.jiraProjects();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/jira/projects");
  });

  it("GETs /api/jira/projects?connectorId=X when a connectorId is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: [{ id: "1", key: "P", name: "Proj" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await api.jiraProjects("ci-jira-1");
    expect(res.data).toHaveLength(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("connectorId=ci-jira-1");
  });

  it("appends ?workspace= alongside the connectorId when set", async () => {
    (globalThis.localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue("ws-1");
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await api.jiraProjects("ci-jira-1");
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("connectorId=ci-jira-1");
    expect(url).toContain("workspace=ws-1");
  });

  it("returns notConfigured pass-through when server signals it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({ data: [], notConfigured: true })));
    const res = await api.jiraProjects();
    expect(res.notConfigured).toBe(true);
  });
});
