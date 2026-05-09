import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("../src/server/lib/workspace-config.js", () => ({
  getGithubConfig: vi.fn(),
}));
vi.mock("../src/server/lib/request-context.js", () => ({
  getActiveWorkspaceId: vi.fn().mockReturnValue(undefined),
}));
vi.mock("../src/server/config.js", () => ({
  config: { github: { token: "", username: "", repo: "" } },
}));
// memo: just call the factory directly (bypass caching)
vi.mock("../src/server/lib/cache.js", () => ({
  memo: (_key: string, _ttl: number, fn: () => any) => fn(),
  invalidate: vi.fn(),
}));

import { getGithubConfig } from "../src/server/lib/workspace-config.js";
import { isConfigured, listBucket, listBucketWith } from "../src/server/integrations/github.js";

const mockGetGithubConfig = getGithubConfig as ReturnType<typeof vi.fn>;

const makeItem = (overrides: Record<string, any> = {}) => ({
  id: 1,
  number: 42,
  title: "Fix bug",
  html_url: "https://github.com/alice/repo/pull/42",
  state: "open" as const,
  draft: false,
  created_at: new Date(Date.now() - 3600000).toISOString(),
  updated_at: new Date().toISOString(),
  closed_at: null,
  user: { login: "alice" },
  repository_url: "https://api.github.com/repos/alice/repo",
  pull_request: { merged_at: null, html_url: "" },
  ...overrides,
});

function stubFetch(items: any[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ items }),
  }));
}

beforeEach(() => { mockGetGithubConfig.mockReturnValue(null); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// ── isConfigured ──────────────────────────────────────────────────────────────

describe("isConfigured", () => {
  it("returns false when no github config found and env is empty", () => {
    expect(isConfigured()).toBe(false);
  });

  it("returns true when DB config has token and username", () => {
    mockGetGithubConfig.mockReturnValue({ token: "ghp_tok", username: "alice", repo: "alice/repo" });
    expect(isConfigured()).toBe(true);
  });

  it("returns false when token is missing", () => {
    mockGetGithubConfig.mockReturnValue({ token: "", username: "alice", repo: "repo" });
    expect(isConfigured()).toBe(false);
  });

  it("returns false when username is missing", () => {
    mockGetGithubConfig.mockReturnValue({ token: "ghp_tok", username: "", repo: "repo" });
    expect(isConfigured()).toBe(false);
  });
});

// ── listBucket ────────────────────────────────────────────────────────────────

describe("listBucket", () => {
  it("returns empty array when not configured", async () => {
    const result = await listBucket("review");
    expect(result).toEqual([]);
  });

  it("fetches items when configured", async () => {
    mockGetGithubConfig.mockReturnValue({ token: "ghp_tok", username: "alice", repo: "alice/repo" });
    stubFetch([makeItem()]);
    const result = await listBucket("review");
    expect(result).toHaveLength(1);
    expect(result[0].number).toBe(42);
  });
});

// ── listBucketWith ────────────────────────────────────────────────────────────

describe("listBucketWith", () => {
  const creds = { token: "ghp_tok", username: "alice", repo: "alice/repo" };

  it("returns empty array when creds are incomplete", async () => {
    expect(await listBucketWith({ token: "", username: "alice", repo: "repo" }, "review")).toEqual([]);
    expect(await listBucketWith({ token: "tok", username: "", repo: "repo" }, "review")).toEqual([]);
    expect(await listBucketWith({ token: "tok", username: "alice", repo: "" }, "review")).toEqual([]);
  });

  it("normalizes review bucket items with correct status", async () => {
    stubFetch([makeItem()]);
    const result = await listBucketWith(creds, "review");
    expect(result[0].status).toBe("Review needed");
    expect(result[0].waitingOnYou).toBe(true);
  });

  it("normalizes mine bucket: open state for non-draft", async () => {
    stubFetch([makeItem({ draft: false })]);
    const result = await listBucketWith(creds, "mine");
    expect(result[0].status).toBe("Open");
    expect(result[0].waitingOnYou).toBe(false);
  });

  it("normalizes mine bucket: Draft for draft items", async () => {
    stubFetch([makeItem({ draft: true })]);
    const result = await listBucketWith(creds, "mine");
    expect(result[0].status).toBe("Draft");
  });

  it("normalizes closed bucket: Merged when merged_at set", async () => {
    stubFetch([makeItem({ state: "closed", pull_request: { merged_at: new Date().toISOString(), html_url: "" } })]);
    const result = await listBucketWith(creds, "closed");
    expect(result[0].status).toBe("Merged");
    expect(result[0].merged).toBe(true);
  });

  it("normalizes closed bucket: Closed when not merged", async () => {
    stubFetch([makeItem({ state: "closed", pull_request: { merged_at: null, html_url: "" } })]);
    const result = await listBucketWith(creds, "closed");
    expect(result[0].status).toBe("Closed");
  });

  it("extracts repo from repository_url", async () => {
    stubFetch([makeItem()]);
    const result = await listBucketWith(creds, "review");
    expect(result[0].repo).toBe("alice/repo");
  });

  it("throws when GitHub API returns non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    }));
    await expect(listBucketWith(creds, "review")).rejects.toThrow("401");
  });

  it("returns empty array for unknown items field", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: null }),
    }));
    const result = await listBucketWith(creds, "review");
    expect(result).toEqual([]);
  });

  it("formats ageHuman correctly: minutes for recent items", async () => {
    stubFetch([makeItem({ created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString() })]);
    const result = await listBucketWith(creds, "review");
    expect(result[0].ageHuman).toMatch(/m ago/);
  });

  it("formats ageHuman correctly: hours", async () => {
    stubFetch([makeItem({ created_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString() })]);
    const result = await listBucketWith(creds, "review");
    expect(result[0].ageHuman).toMatch(/h ago/);
  });

  it("formats ageHuman correctly: days", async () => {
    stubFetch([makeItem({ created_at: new Date(Date.now() - 5 * 86400 * 1000).toISOString() })]);
    const result = await listBucketWith(creds, "review");
    expect(result[0].ageHuman).toMatch(/d ago/);
  });

  it("formats ageHuman correctly: months for old items", async () => {
    stubFetch([makeItem({ created_at: new Date(Date.now() - 90 * 86400 * 1000).toISOString() })]);
    const result = await listBucketWith(creds, "review");
    expect(result[0].ageHuman).toMatch(/mo ago/);
  });

  it("uses closed_at for ageHuman on closed bucket", async () => {
    const closedAt = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
    stubFetch([makeItem({ state: "closed", closed_at: closedAt, pull_request: { merged_at: null, html_url: "" } })]);
    const result = await listBucketWith(creds, "closed");
    expect(result[0].ageHuman).toMatch(/d ago/);
  });

  it("uses author login as empty string when user is null", async () => {
    stubFetch([makeItem({ user: null })]);
    const result = await listBucketWith(creds, "review");
    expect(result[0].author).toBe("");
  });

  it("builds correct query for all bucket (open PRs, no author filter)", async () => {
    stubFetch([]);
    await listBucketWith(creds, "all");
    const url = (vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url).toContain("is%3Apr");
    expect(url).toContain("is%3Aopen");
    expect(url).not.toContain("author%3A");
    expect(url).not.toContain("review-requested%3A");
  });

  it("builds correct query for closed bucket with sort=updated", async () => {
    stubFetch([]);
    await listBucketWith(creds, "closed");
    const url = (vi.mocked(fetch).mock.calls[0][0] as string);
    expect(url).toContain("sort=updated");
  });
});
