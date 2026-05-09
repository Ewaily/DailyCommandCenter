import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockFetch, mockGetJiraConfig, mockGetActiveWorkspaceId, mockMemo,
} = vi.hoisted(() => ({
  mockFetch:                vi.fn(),
  mockGetJiraConfig:        vi.fn().mockReturnValue(null),
  mockGetActiveWorkspaceId: vi.fn().mockReturnValue(undefined),
  mockMemo:                 vi.fn().mockImplementation((_k: string, _t: number, fn: () => any) => fn()),
}));

vi.mock("../src/server/config.js", () => ({
  config: {
    jira: { baseUrl: "https://mycompany.atlassian.net", email: "me@co.com", apiToken: "tok" },
  },
}));
vi.mock("../src/server/lib/workspace-config.js", () => ({ getJiraConfig: mockGetJiraConfig }));
vi.mock("../src/server/lib/request-context.js", () => ({ getActiveWorkspaceId: mockGetActiveWorkspaceId }));
vi.mock("../src/server/lib/cache.js", () => ({ memo: mockMemo }));

import {
  isConfigured,
  listMineWith,
  listWatchedUserWith,
  listTeamIssuesWith,
  listTeamIssues,
  listDeadlines,
  buildCloneAdf,
  createIssue,
  getIssueDetails,
  getIssueDescription,
  getIssueAttachments,
  downloadJiraFile,
  listProjectsWith,
  MINE_BUCKET_ID,
} from "../src/server/integrations/jira.js";

const CREDS = { baseUrl: "https://jira.example.com", email: "me@co.com", apiToken: "secret" };
const EMPTY_CREDS = { baseUrl: "", email: "", apiToken: "" };

function mockOk(json: any) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(JSON.stringify(json)),
    headers: { get: () => null },
  });
}

function mockFail(status = 400, text = "error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve({}),
    headers: { get: () => null },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset clears the once-implementation queue that clearAllMocks() misses
  mockFetch.mockReset();
  mockMemo.mockImplementation((_k: string, _t: number, fn: () => any) => fn());
  mockGetJiraConfig.mockReturnValue(null);
  mockGetActiveWorkspaceId.mockReturnValue(undefined);
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => vi.unstubAllGlobals());

// ── MINE_BUCKET_ID ────────────────────────────────────────────────────────────

describe("MINE_BUCKET_ID", () => {
  it("is 'mine'", () => {
    expect(MINE_BUCKET_ID).toBe("mine");
  });
});

// ── isConfigured ──────────────────────────────────────────────────────────────

describe("isConfigured", () => {
  it("returns true when DB config has all fields", () => {
    mockGetJiraConfig.mockReturnValue({ baseUrl: "https://a.com", email: "e@a.com", token: "t" });
    expect(isConfigured()).toBe(true);
  });

  it("uses explicit workspaceId when provided", () => {
    mockGetJiraConfig.mockReturnValue({ baseUrl: "https://a.com", email: "e@a.com", token: "t" });
    expect(isConfigured("ws-99")).toBe(true);
    expect(mockGetJiraConfig).toHaveBeenCalledWith("ws-99");
  });

  it("returns false when active workspace has no DB config (empty creds)", () => {
    mockGetActiveWorkspaceId.mockReturnValue("ws-x");
    mockGetJiraConfig.mockReturnValue(null);
    expect(isConfigured()).toBe(false);
  });

  it("falls back to env config when no workspace and no DB config", () => {
    mockGetJiraConfig.mockReturnValue(null);
    mockGetActiveWorkspaceId.mockReturnValue(undefined);
    // env config has values from vi.mock above → true
    expect(isConfigured()).toBe(true);
  });
});

// ── listMineWith ──────────────────────────────────────────────────────────────

describe("listMineWith", () => {
  it("returns empty array when creds are empty", async () => {
    const result = await listMineWith(EMPTY_CREDS);
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls Jira search/jql POST and returns normalized issues", async () => {
    const issue = {
      id: "1001", key: "PROJ-1",
      fields: {
        summary: "Fix bug",
        status: { name: "In Progress", statusCategory: { key: "indeterminate", colorName: "yellow" } },
        priority: { name: "High" },
        assignee: { displayName: "Alice", accountId: "acc-1", avatarUrls: { "48x48": "https://av.com/1.png" } },
        duedate: "2025-06-01",
        project: { name: "My Project", key: "PROJ" },
        updated: "2025-05-01",
      },
    };
    mockOk({ issues: [issue], total: 1 });
    const result = await listMineWith(CREDS);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("PROJ-1");
    expect(result[0].title).toBe("Fix bug");
    expect(result[0].status).toBe("In Progress");
    expect(result[0].statusBucket).toBe("in_progress");
    expect(result[0].priority).toBe("high");
    expect(result[0].assignee?.name).toBe("Alice");
    expect(result[0].source).toBe("jira");
    expect(result[0].url).toBe(`${CREDS.baseUrl}/browse/PROJ-1`);
  });

  it("handles missing fields gracefully", async () => {
    mockOk({ issues: [{ id: "1", key: "X-1", fields: {} }], total: 1 });
    const result = await listMineWith(CREDS);
    expect(result[0].title).toBe("(untitled)");
    expect(result[0].assignee).toBeNull();
    expect(result[0].priority).toBeNull();
    expect(result[0].status).toBe("Unknown");
  });

  it("maps assignee email when displayName is missing", async () => {
    mockOk({
      issues: [{
        id: "2", key: "A-2",
        fields: { assignee: { emailAddress: "jane@co.com", accountId: "j1", avatarUrls: {} } },
      }],
      total: 1,
    });
    const result = await listMineWith(CREDS);
    expect(result[0].assignee?.name).toBe("jane@co.com");
  });

  it("maps priority Highest to urgent", async () => {
    mockOk({ issues: [{ id: "3", key: "A-3", fields: { priority: { name: "Highest" } } }], total: 1 });
    const result = await listMineWith(CREDS);
    expect(result[0].priority).toBe("urgent");
  });

  it("maps status name to 'blocked' bucket", async () => {
    mockOk({ issues: [{ id: "4", key: "A-4", fields: { status: { name: "Blocked by QA", statusCategory: { key: "", colorName: "" } } } }], total: 1 });
    expect((await listMineWith(CREDS))[0].statusBucket).toBe("blocked");
  });

  it("maps status name to 'in_review' bucket for QA", async () => {
    mockOk({ issues: [{ id: "5", key: "A-5", fields: { status: { name: "QA Testing", statusCategory: { key: "" } } } }], total: 1 });
    expect((await listMineWith(CREDS))[0].statusBucket).toBe("in_review");
  });

  it("maps status name to 'in_review' for clarification", async () => {
    mockOk({ issues: [{ id: "6", key: "A-6", fields: { status: { name: "Needs Clarification", statusCategory: { key: "" } } } }], total: 1 });
    expect((await listMineWith(CREDS))[0].statusBucket).toBe("in_review");
  });

  it("maps category 'done' to 'done' bucket", async () => {
    mockOk({ issues: [{ id: "7", key: "A-7", fields: { status: { name: "Closed", statusCategory: { key: "done" } } } }], total: 1 });
    expect((await listMineWith(CREDS))[0].statusBucket).toBe("done");
  });

  it("maps unknown status to 'todo' bucket", async () => {
    mockOk({ issues: [{ id: "8", key: "A-8", fields: { status: { name: "Open", statusCategory: { key: "new" } } } }], total: 1 });
    expect((await listMineWith(CREDS))[0].statusBucket).toBe("todo");
  });

  it("maps STATUS_CATEGORY_COLOR correctly for blue-gray", async () => {
    mockOk({ issues: [{ id: "9", key: "A-9", fields: { status: { statusCategory: { colorName: "blue-gray" } } } }], total: 1 });
    expect((await listMineWith(CREDS))[0].statusColor).toBe("#4C9AFF");
  });

  it("throws when Jira POST fails", async () => {
    mockFail(401, "Unauthorized");
    await expect(listMineWith(CREDS)).rejects.toThrow();
  });
});

// ── listWatchedUserWith ───────────────────────────────────────────────────────

// Use accountId-like strings (length ≥ 20) to bypass user search and avoid
// the module-level accountIdCache causing cross-test interference.
const ACCOUNT_ID_QUERY = "5b10a2844c20165700ede001"; // looks like accountId

describe("listWatchedUserWith", () => {
  it("returns empty array when creds are empty", async () => {
    const result = await listWatchedUserWith(EMPTY_CREDS, { id: "w1", query: ACCOUNT_ID_QUERY, label: "X" });
    expect(result).toEqual([]);
  });

  it("resolves display name to accountId via search API", async () => {
    mockOk([{ displayName: "UniqueUserAbc123", accountId: "abc-account-id-999" }]);
    mockOk({ issues: [], total: 0 });
    await listWatchedUserWith(CREDS, { id: "w1", query: "UniqueUserAbc123", label: "X" });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstUrl).toContain("user/search");
  });

  it("skips user resolution for accountId-like query", async () => {
    mockOk({ issues: [], total: 0 });
    await listWatchedUserWith(CREDS, { id: "w1", query: ACCOUNT_ID_QUERY, label: "Bob" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns empty when user not found by display name", async () => {
    mockOk([]); // empty user search result
    const result = await listWatchedUserWith(CREDS, { id: "w1", query: "NoSuchUserXyz987", label: "X" });
    expect(result).toEqual([]);
  });

  it("includes status filter when watched user has status field", async () => {
    mockOk({ issues: [], total: 0 });
    await listWatchedUserWith(CREDS, { id: "w1", query: ACCOUNT_ID_QUERY, label: "Bob", status: "In Review" });
    const bodyStr = mockFetch.mock.calls[0][1].body as string;
    const body = JSON.parse(bodyStr);
    expect(body.jql).toContain("status");
    expect(body.jql).toContain("In Review");
  });

  it("hides closed issues by default", async () => {
    mockOk({ issues: [], total: 0 });
    await listWatchedUserWith(CREDS, { id: "w1", query: ACCOUNT_ID_QUERY, label: "X" });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.jql).toContain("statusCategory != Done");
  });

  it("shows closed issues when hideClosed is false", async () => {
    mockOk({ issues: [], total: 0 });
    await listWatchedUserWith(CREDS, { id: "w1", query: ACCOUNT_ID_QUERY, label: "X", hideClosed: false });
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.jql).not.toContain("statusCategory != Done");
  });

  it("handles user search fetch failure gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network"));
    const result = await listWatchedUserWith(CREDS, { id: "w1", query: "FetchFailUser", label: "X" });
    expect(result).toEqual([]);
  });
});

// ── listTeamIssuesWith ────────────────────────────────────────────────────────

describe("listTeamIssuesWith", () => {
  it("returns empty when creds are empty", async () => {
    expect(await listTeamIssuesWith(EMPTY_CREDS)).toEqual([]);
  });

  it("uses provided project key directly", async () => {
    mockOk({ issues: [], total: 0 });
    await listTeamIssuesWith(CREDS, "MYPROJ");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.jql).toContain("MYPROJ");
  });

  it("auto-detects project from last assigned issue when no project given", async () => {
    mockOk({ issues: [{ id: "1", key: "AUTODETECT-42", fields: { status: { name: "Open", statusCategory: { key: "new" } } } }], total: 1 });
    mockOk({ issues: [], total: 0 });
    await listTeamIssuesWith(CREDS);
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondBody.jql).toContain("AUTODETECT");
  });

  it("returns empty when no recent issues found for auto-detection", async () => {
    mockOk({ issues: [], total: 0 });
    const result = await listTeamIssuesWith(CREDS);
    expect(result).toEqual([]);
  });
});

// ── buildCloneAdf ─────────────────────────────────────────────────────────────

describe("buildCloneAdf", () => {
  it("returns a doc with version 1", () => {
    const doc = buildCloneAdf("ClickUp", "https://app.clickup.com/t/123", null);
    expect(doc.type).toBe("doc");
    expect(doc.version).toBe(1);
  });

  it("includes a cloned-from blockquote header", () => {
    const doc = buildCloneAdf("ClickUp", "https://cu.com", null);
    const header = doc.content[0] as any;
    expect(header.type).toBe("blockquote");
    const text = header.content[0].content[0];
    expect(text.text).toContain("ClickUp");
    expect(text.marks[0].attrs.href).toBe("https://cu.com");
  });

  it("splices ADF doc content after header", () => {
    const adfBody = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] };
    const doc = buildCloneAdf("Jira", "https://j.com", adfBody);
    expect(doc.content).toHaveLength(2);
    expect((doc.content[1] as any).type).toBe("paragraph");
  });

  it("converts markdown string body to ADF nodes", () => {
    const doc = buildCloneAdf("GitHub", "https://gh.com", "## Title\nSome text");
    expect(doc.content.length).toBeGreaterThan(1);
  });

  it("ignores empty string body", () => {
    const doc = buildCloneAdf("X", "https://x.com", "");
    expect(doc.content).toHaveLength(1);
  });

  it("handles bold markdown (**text**)", () => {
    const doc = buildCloneAdf("X", "https://x.com", "**bold text**");
    const para = doc.content[1] as any;
    expect(para.type).toBe("paragraph");
    expect(para.content[0].marks[0].type).toBe("strong");
  });

  it("handles italic markdown (*text*)", () => {
    const doc = buildCloneAdf("X", "https://x.com", "*italic*");
    const para = doc.content[1] as any;
    expect(para.content[0].marks[0].type).toBe("em");
  });

  it("handles inline code (`code`)", () => {
    const doc = buildCloneAdf("X", "https://x.com", "`code`");
    const para = doc.content[1] as any;
    expect(para.content[0].marks[0].type).toBe("code");
  });

  it("handles markdown link [text](url)", () => {
    const doc = buildCloneAdf("X", "https://x.com", "[click here](https://example.com)");
    const para = doc.content[1] as any;
    expect(para.content[0].marks[0].type).toBe("link");
    expect(para.content[0].marks[0].attrs.href).toBe("https://example.com");
  });

  it("handles bullet list", () => {
    const doc = buildCloneAdf("X", "https://x.com", "- item 1\n- item 2");
    const list = doc.content[1] as any;
    expect(list.type).toBe("bulletList");
    expect(list.content).toHaveLength(2);
  });

  it("handles numbered list", () => {
    const doc = buildCloneAdf("X", "https://x.com", "1. first\n2. second");
    const list = doc.content[1] as any;
    expect(list.type).toBe("bulletList");
    expect(list.content).toHaveLength(2);
  });

  it("handles fenced code block", () => {
    const doc = buildCloneAdf("X", "https://x.com", "```js\nconsole.log('hi');\n```");
    const cb = doc.content[1] as any;
    expect(cb.type).toBe("codeBlock");
    expect(cb.attrs.language).toBe("js");
    expect(cb.content[0].text).toContain("console.log");
  });

  it("handles horizontal rule ---", () => {
    const doc = buildCloneAdf("X", "https://x.com", "---");
    const rule = doc.content[1] as any;
    expect(rule.type).toBe("rule");
  });

  it("handles blockquote line", () => {
    const doc = buildCloneAdf("X", "https://x.com", "> some quote");
    const bq = doc.content[1] as any;
    expect(bq.type).toBe("blockquote");
  });

  it("handles unclosed code block at end of string", () => {
    const doc = buildCloneAdf("X", "https://x.com", "```\nsome code");
    const cb = doc.content[1] as any;
    expect(cb.type).toBe("codeBlock");
    expect(cb.content[0].text).toBe("some code");
  });

  it("handles mixed text (plain after link)", () => {
    const doc = buildCloneAdf("X", "https://x.com", "[link](https://a.com) and more text");
    const para = doc.content[1] as any;
    expect(para.content.length).toBeGreaterThan(1);
    const lastNode = para.content[para.content.length - 1];
    expect(lastNode.type).toBe("text");
  });

  it("blank lines produce no paragraph", () => {
    const doc = buildCloneAdf("X", "https://x.com", "line1\n\nline2");
    // two paragraphs for line1 and line2
    expect(doc.content.length).toBe(3); // header + para + para
  });
});

// ── createIssue ───────────────────────────────────────────────────────────────

describe("createIssue", () => {
  it("creates an issue and returns key and id", async () => {
    mockOk({ key: "PROJ-42", id: "100042" });
    const result = await createIssue(CREDS, {
      projectKey: "PROJ",
      summary: "Test issue",
      descriptionAdf: { type: "doc", version: 1, content: [] },
    });
    expect(result.key).toBe("PROJ-42");
    expect(result.id).toBe("100042");
  });

  it("throws when API returns error", async () => {
    mockFail(400, "Invalid project");
    await expect(
      createIssue(CREDS, { projectKey: "BAD", summary: "x", descriptionAdf: null }),
    ).rejects.toThrow();
  });
});

// ── getIssueDetails ───────────────────────────────────────────────────────────

describe("getIssueDetails", () => {
  it("returns description and filters to image/video attachments only", async () => {
    mockOk({
      fields: {
        description: { type: "doc" },
        attachment: [
          { filename: "screenshot.png", content: "https://j.com/attach/1", mimeType: "image/png", size: 1024 },
          { filename: "report.pdf", content: "https://j.com/attach/2", mimeType: "application/pdf", size: 2048 },
          { filename: "video.mp4", content: "https://j.com/attach/3", mimeType: "video/mp4", size: 4096 },
        ],
      },
    });
    const result = await getIssueDetails(CREDS, "PROJ-1");
    expect(result.description).toEqual({ type: "doc" });
    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0].filename).toBe("screenshot.png");
    expect(result.attachments[1].filename).toBe("video.mp4");
  });

  it("returns null description and empty attachments when fields missing", async () => {
    mockOk({ fields: {} });
    const result = await getIssueDetails(CREDS, "PROJ-2");
    expect(result.description).toBeNull();
    expect(result.attachments).toEqual([]);
  });

  it("returns empty on API failure", async () => {
    mockFail(500);
    const result = await getIssueDetails(CREDS, "BAD-1");
    expect(result).toEqual({ description: null, attachments: [] });
  });
});

describe("getIssueDescription (deprecated)", () => {
  it("delegates to getIssueDetails", async () => {
    mockOk({ fields: { description: { type: "doc" }, attachment: [] } });
    const desc = await getIssueDescription(CREDS, "PROJ-1");
    expect(desc).toEqual({ type: "doc" });
  });
});

describe("getIssueAttachments (deprecated)", () => {
  it("delegates to getIssueDetails", async () => {
    mockOk({
      fields: {
        description: null,
        attachment: [{ filename: "img.jpg", content: "https://j.com/a/1", mimeType: "image/jpeg", size: 512 }],
      },
    });
    const attachments = await getIssueAttachments(CREDS, "PROJ-1");
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe("img.jpg");
  });
});

// ── downloadJiraFile ──────────────────────────────────────────────────────────

describe("downloadJiraFile", () => {
  it("returns buffer and mimeType on success", async () => {
    const ab = new ArrayBuffer(15);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => h === "content-length" ? "15" : "image/png; charset=utf-8" },
      arrayBuffer: () => Promise.resolve(ab),
    });
    const result = await downloadJiraFile(CREDS, "https://j.com/attach/1");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
    expect(result!.buffer.byteLength).toBe(15);
  });

  it("returns null when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, headers: { get: () => null } });
    expect(await downloadJiraFile(CREDS, "https://j.com/a")).toBeNull();
  });

  it("returns null when content-length exceeds 25MB", async () => {
    const bigSize = (25 * 1024 * 1024 + 1).toString();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => h === "content-length" ? bigSize : "image/png" },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    expect(await downloadJiraFile(CREDS, "https://j.com/a")).toBeNull();
  });

  it("returns null when buffer exceeds 25MB even if header was ok", async () => {
    const bigAb = new ArrayBuffer(26 * 1024 * 1024);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => h === "content-length" ? "100" : "image/png" },
      arrayBuffer: () => Promise.resolve(bigAb),
    });
    expect(await downloadJiraFile(CREDS, "https://j.com/a")).toBeNull();
  });

  it("returns null when content-length is missing and buffer is small", async () => {
    const ab = new ArrayBuffer(100);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: (h: string) => h === "content-length" ? null : "image/jpeg" },
      arrayBuffer: () => Promise.resolve(ab),
    });
    const result = await downloadJiraFile(CREDS, "https://j.com/a");
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/jpeg");
  });

  it("returns null on fetch exception", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    expect(await downloadJiraFile(CREDS, "https://j.com/a")).toBeNull();
  });
});

// ── listProjectsWith ──────────────────────────────────────────────────────────

describe("listProjectsWith", () => {
  it("returns mapped projects", async () => {
    mockOk({
      values: [
        { id: "p1", key: "PROJ", name: "My Project" },
        { id: "p2", key: "TEST", name: "Test Project" },
      ],
    });
    const projects = await listProjectsWith(CREDS);
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({ id: "p1", key: "PROJ", name: "My Project" });
    expect(projects[1]).toEqual({ id: "p2", key: "TEST", name: "Test Project" });
  });

  it("throws when API fails", async () => {
    mockFail(401, "Unauthorized");
    await expect(listProjectsWith(CREDS)).rejects.toThrow();
  });

  it("returns empty when values is missing", async () => {
    mockOk({});
    const projects = await listProjectsWith(CREDS);
    expect(projects).toEqual([]);
  });
});

// ── listTeamIssues (non-With wrapper) ─────────────────────────────────────────

describe("listTeamIssues", () => {
  it("returns [] when not configured (active workspace with no jira config)", async () => {
    // Force effective() to return empty creds: workspace is set but has no jira DB config
    mockGetActiveWorkspaceId.mockReturnValue("ws-no-jira");
    mockGetJiraConfig.mockReturnValue(null);
    const result = await listTeamIssues();
    expect(result).toEqual([]);
  });

  it("delegates to listTeamIssuesWith with provided project", async () => {
    mockOk({ issues: [], total: 0 });
    const result = await listTeamIssues("MYPROJ");
    expect(result).toEqual([]);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.jql).toContain("MYPROJ");
  });

  it("delegates to listTeamIssuesWith without project (auto-detect)", async () => {
    // First call: detect project from last assigned issue
    mockOk({ issues: [{ id: "1", key: "AUTO-5", fields: { status: { name: "Open", statusCategory: { key: "new" } } } }], total: 1 });
    // Second call: team board for AUTO project
    mockOk({ issues: [], total: 0 });
    const result = await listTeamIssues();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── listDeadlines ─────────────────────────────────────────────────────────────

describe("listDeadlines", () => {
  it("returns [] when not configured", async () => {
    // Force empty creds by using a workspace that has no jira config in DB
    mockGetActiveWorkspaceId.mockReturnValue("ws-no-jira");
    mockGetJiraConfig.mockReturnValue(null);
    const result = await listDeadlines();
    expect(result).toEqual([]);
  });

  it("returns deadline items for issues with a due date", async () => {
    // Give getJiraConfig a valid creds object so isConfigured() returns true
    mockGetJiraConfig.mockReturnValue(null); // falls back to config.js mock with valid creds
    const futureDate = new Date(Date.now() + 86_400_000 * 3).toISOString().slice(0, 10);
    mockOk({
      issues: [
        {
          id: "i1",
          key: "PROJ-99",
          fields: {
            summary: "Fix critical bug",
            duedate: futureDate,
            status: { name: "In Progress", statusCategory: { key: "indeterminate", colorName: "blue" } },
            priority: { name: "High" },
            assignee: null,
            project: { name: "Project", key: "PROJ" },
            updated: new Date().toISOString(),
          },
        },
      ],
    });
    const result = await listDeadlines(7);
    expect(result).toHaveLength(1);
    expect(result[0].dueDate).toBe(futureDate);
    expect(result[0].source).toBe("Jira");
    expect(result[0].title).toContain("PROJ-99");
  });

  it("uses default days=7 and filters out items without dueDate", async () => {
    mockGetJiraConfig.mockReturnValue(null);
    mockOk({
      issues: [
        {
          id: "i2",
          key: "PROJ-100",
          fields: {
            summary: "No due date",
            duedate: null,
            status: { name: "Open", statusCategory: { key: "new", colorName: "default" } },
            priority: null,
            assignee: null,
            project: { name: "P", key: "P" },
            updated: new Date().toISOString(),
          },
        },
      ],
    });
    const result = await listDeadlines();
    expect(result).toEqual([]);
  });

  it("computes relative label 'today' for overdue/due today items", async () => {
    mockGetJiraConfig.mockReturnValue(null);
    const today = new Date().toISOString().slice(0, 10);
    mockOk({
      issues: [
        {
          id: "i3",
          key: "PROJ-101",
          fields: {
            summary: "Due today",
            duedate: today,
            status: { name: "Open", statusCategory: { key: "new", colorName: "default" } },
            priority: null,
            assignee: null,
            project: { name: "P", key: "P" },
            updated: new Date().toISOString(),
          },
        },
      ],
    });
    const result = await listDeadlines(7);
    expect(result[0].dueRelative).toBe("today");
  });
});
