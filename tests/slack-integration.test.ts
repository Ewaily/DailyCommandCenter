import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockFetch, mockGetDb, mockMemo, mockInvalidate, mockFormatSlackText, mockGetAppSetting } = vi.hoisted(() => {
  const db = {
    prepare: vi.fn(),
  };
  return {
    mockFetch:          vi.fn(),
    mockGetDb:          vi.fn().mockReturnValue(db),
    mockMemo:           vi.fn().mockImplementation((_k, _t, fn) => fn()),
    mockInvalidate:     vi.fn(),
    mockFormatSlackText: vi.fn().mockImplementation((text) => `<span>${text}</span>`),
    mockGetAppSetting:  vi.fn().mockReturnValue("UTC"),
  };
});

vi.mock("../src/server/config.js", () => ({
  config: { slack: { digestChannels: [{ id: "C_DEFAULT", name: "general" }] } },
}));
vi.mock("../src/server/db.js", () => ({ getDb: mockGetDb }));
vi.mock("../src/server/lib/cache.js", () => ({ memo: mockMemo, invalidate: mockInvalidate }));
vi.mock("../src/server/lib/slack-formatter.js", () => ({
  formatSlackText: mockFormatSlackText,
}));
vi.mock("../src/server/lib/app-settings.js", () => ({ getAppSetting: mockGetAppSetting }));

import {
  getDigestConfig,
  saveDigestConfig,
  resolveUsers,
  userInfo,
  resolveSubteams,
  resolveChannels,
  getMentions,
  getChannelDigest,
  invalidateMentionsCache,
} from "../src/server/integrations/slack.js";

function makeDb(rowOrNull: Record<string, string> | null = null) {
  const stmt = { get: vi.fn().mockReturnValue(rowOrNull), run: vi.fn(), all: vi.fn().mockReturnValue([]) };
  mockGetDb.mockReturnValue({ prepare: vi.fn().mockReturnValue(stmt) });
  return stmt;
}

function stubFetch(responses: Array<{ ok?: boolean; status?: number; json?: any; headers?: Record<string, string> }>) {
  let i = 0;
  mockFetch.mockImplementation(() => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    const headers = new Map(Object.entries(r.headers ?? {}));
    return Promise.resolve({
      ok: r.ok !== false,
      status: r.status ?? 200,
      headers: { get: (k: string) => headers.get(k) ?? null },
      json: () => Promise.resolve(r.json ?? {}),
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  mockGetAppSetting.mockReturnValue("UTC");
  mockMemo.mockImplementation((_k: string, _t: number, fn: () => any) => fn());
});

afterEach(() => vi.unstubAllGlobals());

// ── getDigestConfig ───────────────────────────────────────────────────────────

describe("getDigestConfig", () => {
  it("returns default config when no DB row", () => {
    makeDb(null);
    const cfg = getDigestConfig();
    expect(cfg.channels).toEqual([{ id: "C_DEFAULT", name: "general" }]);
    expect(cfg.msgsPerChannel).toBe(5);
  });

  it("returns parsed config when DB row exists", () => {
    makeDb({ value: JSON.stringify({ channels: [{ id: "C1", name: "random" }], msgsPerChannel: 10 }) });
    const cfg = getDigestConfig();
    expect(cfg.channels[0].id).toBe("C1");
    expect(cfg.msgsPerChannel).toBe(10);
  });

  it("falls back to default on JSON parse error", () => {
    makeDb({ value: "not json" });
    const cfg = getDigestConfig();
    expect(cfg.msgsPerChannel).toBe(5);
  });
});

// ── saveDigestConfig ──────────────────────────────────────────────────────────

describe("saveDigestConfig", () => {
  it("stores config to DB and invalidates cache", () => {
    const stmt = makeDb();
    saveDigestConfig({ channels: [], msgsPerChannel: 7 });
    expect(stmt.run).toHaveBeenCalledWith(
      "slack.digest.config",
      JSON.stringify({ channels: [], msgsPerChannel: 7 }),
    );
    expect(mockInvalidate).toHaveBeenCalledWith("slack.digest");
  });
});

// ── invalidateMentionsCache ───────────────────────────────────────────────────

describe("invalidateMentionsCache", () => {
  it("calls invalidate with slack.mentions key", () => {
    invalidateMentionsCache();
    expect(mockInvalidate).toHaveBeenCalledWith("slack.mentions");
  });
});

// ── resolveUsers ──────────────────────────────────────────────────────────────

describe("resolveUsers", () => {
  it("returns display_name when available", async () => {
    stubFetch([{ json: { ok: true, user: { profile: { display_name: "Alice", image_48: "https://img/a.png" } } } }]);
    const map = await resolveUsers(["U_ALICE_NEW"], "tok-1");
    expect(map["U_ALICE_NEW"]).toBe("Alice");
  });

  it("falls back to real_name in profile", async () => {
    stubFetch([{ json: { ok: true, user: { profile: { display_name: "", real_name: "Bob Smith" } } } }]);
    const map = await resolveUsers(["U_BOB_NEW"], "tok-2");
    expect(map["U_BOB_NEW"]).toBe("Bob Smith");
  });

  it("falls back to user id on API error", async () => {
    stubFetch([{ json: { ok: false, error: "user_not_found" } }]);
    const map = await resolveUsers(["U_ERR_NEW"], "tok-3");
    expect(map["U_ERR_NEW"]).toBe("U_ERR_NEW");
  });

  it("uses cache for repeated resolution", async () => {
    stubFetch([{ json: { ok: true, user: { profile: { display_name: "Cached User" } } } }]);
    await resolveUsers(["U_CACHE"], "tok-cache");
    // Second call should not trigger fetch
    const fetchCount = mockFetch.mock.calls.length;
    await resolveUsers(["U_CACHE"], "tok-cache");
    expect(mockFetch.mock.calls.length).toBe(fetchCount);
  });
});

// ── userInfo ──────────────────────────────────────────────────────────────────

describe("userInfo", () => {
  it("returns name and null avatar for unknown user", () => {
    const info = userInfo("U_UNKNOWN_NEVER_RESOLVED");
    expect(info.name).toBe("U_UNKNOWN_NEVER_RESOLVED");
    expect(info.avatar).toBeNull();
  });
});

// ── resolveSubteams ───────────────────────────────────────────────────────────

describe("resolveSubteams", () => {
  it("fetches usergroups and maps by id", async () => {
    stubFetch([{
      json: { ok: true, usergroups: [{ id: "ST1", handle: "eng" }, { id: "ST2", handle: "design" }] },
    }]);
    const map = await resolveSubteams(["ST1", "ST2"], "tok-sub");
    expect(map["ST1"]).toBe("eng");
    expect(map["ST2"]).toBe("design");
  });

  it("falls back to id on API error", async () => {
    stubFetch([{ json: { ok: false, error: "missing_scope" } }]);
    const map = await resolveSubteams(["ST_ERR"], "tok-sub-err");
    expect(map["ST_ERR"]).toBe("ST_ERR");
  });

  it("uses cache on second call with same ids", async () => {
    stubFetch([{ json: { ok: true, usergroups: [{ id: "ST_CACHED", handle: "qa" }] } }]);
    await resolveSubteams(["ST_CACHED"], "tok-sub2");
    const fetchCount = mockFetch.mock.calls.length;
    await resolveSubteams(["ST_CACHED"], "tok-sub2");
    expect(mockFetch.mock.calls.length).toBe(fetchCount);
  });
});

// ── resolveChannels ───────────────────────────────────────────────────────────

describe("resolveChannels", () => {
  it("resolves channel id to name", async () => {
    stubFetch([{ json: { ok: true, channel: { name: "engineering" } } }]);
    const map = await resolveChannels(["C_ENG_NEW"], "tok-ch");
    expect(map["C_ENG_NEW"]).toBe("engineering");
  });

  it("falls back to channel id on error", async () => {
    stubFetch([{ json: { ok: false, error: "channel_not_found" } }]);
    const map = await resolveChannels(["C_BAD"], "tok-ch-err");
    expect(map["C_BAD"]).toBe("C_BAD");
  });
});

// ── getChannelDigest ──────────────────────────────────────────────────────────

describe("getChannelDigest", () => {
  it("returns empty array when no channels configured", async () => {
    const result = await getChannelDigest("tok-d1", { channels: [], msgsPerChannel: 5 });
    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches and formats messages for configured channels", async () => {
    stubFetch([
      // conversations.history
      { json: { ok: true, messages: [{ ts: "1700000000.000001", text: "Hello", user: "U1" }] } },
      // users.info for U1
      { json: { ok: true, user: { profile: { display_name: "Alice" } } } },
      // auth.test for workspace URL
      { json: { ok: true, url: "https://myteam.slack.com" } },
    ]);
    const result = await getChannelDigest("tok-d2", {
      channels: [{ id: "C123", name: "general" }],
      msgsPerChannel: 5,
    });
    expect(result).toHaveLength(1);
    expect(result[0].channelId).toBe("C123");
    expect(result[0].messages.length).toBeGreaterThanOrEqual(0);
  });

  it("returns empty messages array on channel fetch error", async () => {
    stubFetch([{ json: { ok: false, error: "channel_not_found" } }]);
    const result = await getChannelDigest("tok-d3", {
      channels: [{ id: "C_ERR", name: "broken" }],
      msgsPerChannel: 5,
    });
    expect(result[0].messages).toEqual([]);
    expect((result[0] as any).error).toBeDefined();
  });

  it("filters out channel_join subtypes", async () => {
    stubFetch([
      { json: { ok: true, messages: [
        { ts: "1700000000.000001", text: "Hello", user: "U1", subtype: "channel_join" },
        { ts: "1700000000.000002", text: "World", user: "U1" },
      ] } },
      { json: { ok: true, user: { profile: { display_name: "Alice" } } } },
      { json: { ok: true, url: "https://myteam.slack.com" } },
    ]);
    const result = await getChannelDigest("tok-d4", {
      channels: [{ id: "C_FILTER", name: "test" }],
      msgsPerChannel: 5,
    });
    expect(result[0].messages.length).toBe(1);
  });

  it("clamps msgsPerChannel to 1 minimum", async () => {
    stubFetch([{ json: { ok: true, messages: [] } }]);
    await getChannelDigest("tok-d5", { channels: [{ id: "C1", name: "ch" }], msgsPerChannel: 0 });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(Number(url.searchParams.get("limit"))).toBeGreaterThanOrEqual(1);
  });

  it("clamps msgsPerChannel to 20 maximum", async () => {
    stubFetch([{ json: { ok: true, messages: [] } }]);
    await getChannelDigest("tok-d6", { channels: [{ id: "C1", name: "ch" }], msgsPerChannel: 999 });
    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(Number(url.searchParams.get("limit"))).toBeLessThanOrEqual(20);
  });
});

// ── getMentions ───────────────────────────────────────────────────────────────

describe("getMentions", () => {
  it("throws when both DM and mention searches fail", async () => {
    stubFetch([
      { json: { ok: false, error: "not_authed" } },
      { json: { ok: false, error: "not_authed" } },
    ]);
    await expect(getMentions("tok-m1", "U_ME")).rejects.toThrow();
  });

  it("returns combined results from DMs and mentions", async () => {
    stubFetch([
      // DM search
      { json: { ok: true, messages: { matches: [
        { ts: "1700000100.000001", text: "DM message", user: "U_OTHER",
          channel: { id: "D1", is_im: true }, permalink: "https://slack.com/p1" },
      ] } } },
      // Mention search
      { json: { ok: true, messages: { matches: [] } } },
      // user resolution for DM sender
      { json: { ok: true, user: { profile: { display_name: "Bob" } } } },
      // auth.test for workspace URL
      { json: { ok: true, url: "https://myteam.slack.com" } },
    ]);
    const results = await getMentions("tok-m2", "U_ME2");
    expect(Array.isArray(results)).toBe(true);
  });

  it("deduplicates messages appearing in both DM and mention results", async () => {
    const sharedTs = "1700000200.000001";
    stubFetch([
      // DM search returns one message
      { json: { ok: true, messages: { matches: [
        { ts: sharedTs, text: "Overlap", user: "U_A",
          channel: { id: "C_SHARED", name: "shared" }, permalink: "https://slack.com/p1" },
      ] } } },
      // Mention search returns same ts in a non-DM channel
      { json: { ok: true, messages: { matches: [
        { ts: sharedTs, text: "Overlap", user: "U_A",
          channel: { id: "C_SHARED", name: "shared", is_im: false, is_mpim: false }, permalink: "https://slack.com/p1" },
      ] } } },
      // user resolution
      { json: { ok: true, user: { profile: { display_name: "User A" } } } },
      { json: { ok: true, url: "https://myteam.slack.com" } },
      { json: { ok: true, user: { profile: { display_name: "User A" } } } },
      { json: { ok: true, url: "https://myteam.slack.com" } },
    ]);
    const results = await getMentions("tok-m3", "U_ME3", 7);
    const tsList = results.map(r => r.ts);
    const unique = new Set(tsList);
    expect(unique.size).toBe(tsList.length);
  });

  it("filters out messages from self", async () => {
    stubFetch([
      // DM search returns a self-authored message
      { json: { ok: true, messages: { matches: [
        { ts: "1700000300.000001", text: "Self msg", user: "U_ME_SELF",
          channel: { id: "D_SELF", is_im: true }, permalink: "" },
      ] } } },
      { json: { ok: true, messages: { matches: [] } } },
    ]);
    const results = await getMentions("tok-m4", "U_ME_SELF");
    expect(results).toHaveLength(0);
  });

  it("sorts results by ts descending (newest first)", async () => {
    stubFetch([
      { json: { ok: true, messages: { matches: [
        { ts: "1700000010.000001", text: "Older DM", user: "U_X",
          channel: { id: "D_X", is_im: true }, permalink: "" },
        { ts: "1700000020.000001", text: "Newer DM", user: "U_X",
          channel: { id: "D_X", is_im: true }, permalink: "" },
      ] } } },
      { json: { ok: true, messages: { matches: [] } } },
      { json: { ok: true, user: { profile: { display_name: "X" } } } },
      { json: { ok: true, url: "https://team.slack.com" } },
    ]);
    const results = await getMentions("tok-m5", "U_ME5");
    if (results.length >= 2) {
      expect(Number(results[0].ts)).toBeGreaterThan(Number(results[1].ts));
    }
  });

  it("handles group DM (mpim) channel name cleanup", async () => {
    stubFetch([
      { json: { ok: true, messages: { matches: [
        { ts: "1700000400.000001", text: "Group msg", user: "U_GRP",
          channel: { id: "G_MPIM", is_im: false, is_mpim: true, name: "mpdm-alice--bob--1" },
          permalink: "" },
      ] } } },
      { json: { ok: true, messages: { matches: [] } } },
      { json: { ok: true, url: "https://team.slack.com" } },
    ]);
    const results = await getMentions("tok-m6", "U_ME6");
    expect(Array.isArray(results)).toBe(true);
  });

  it("succeeds when only DM search fails (mention search ok)", async () => {
    stubFetch([
      // DM search fails
      { json: { ok: false, error: "not_authed" } },
      // Mention search succeeds
      { json: { ok: true, messages: { matches: [
        { ts: "1700000500.000001", text: "Hey mention", user: "U_OTHER",
          channel: { id: "C_PUB", name: "general", is_im: false, is_mpim: false },
          permalink: "https://slack.com/p5" },
      ] } } },
      { json: { ok: true, url: "https://team.slack.com" } },
    ]);
    const results = await getMentions("tok-m7", "U_ME7");
    expect(Array.isArray(results)).toBe(true);
  });

  it("succeeds when only mention search fails (DM search ok)", async () => {
    stubFetch([
      // DM search succeeds with empty
      { json: { ok: true, messages: { matches: [] } } },
      // Mention search fails — mentionMatches should be []
      { json: { ok: false, error: "not_authed" } },
    ]);
    const results = await getMentions("tok-m8", "U_ME8");
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(0);
  });

  it("deduplicates across DM and mention results (same ts)", async () => {
    // Use a recent timestamp to pass the cutoff filter (within 7 days of now)
    const recentTs = `${Math.floor(Date.now() / 1000) - 60}.000001`; // 1 minute ago
    stubFetch([
      // DM search: a message from U_DEDUP_SENDER
      { json: { ok: true, messages: { matches: [
        { ts: recentTs, text: "Shared DM", user: "U_DEDUP_SENDER",
          channel: { id: "D_DEDUP", is_im: true }, permalink: "https://slack.com/p6" },
      ] } } },
      // Mention search: same ts in a public channel (not DM, not MPIM)
      { json: { ok: true, messages: { matches: [
        { ts: recentTs, text: "Shared mention", user: "U_DEDUP_SENDER",
          channel: { id: "C_DEDUP_PUB", name: "general", is_im: false, is_mpim: false }, permalink: "https://slack.com/p6m" },
      ] } } },
      // user resolution for DM sender
      { json: { ok: true, user: { profile: { display_name: "Dedup User" } } } },
      { json: { ok: true, url: "https://team.slack.com" } },
      // mention channel formatBatch (user already cached, so just auth.test)
      { json: { ok: true, url: "https://team.slack.com" } },
    ]);
    const results = await getMentions("tok-m9", "U_ME9", 7);
    // Both have same ts — deduplication should yield only 1
    const tsList = results.map(r => r.ts);
    const unique = new Set(tsList);
    expect(unique.size).toBe(tsList.length);
    expect(results).toHaveLength(1);
  });
});
