import { describe, it, expect, vi, beforeEach } from "vitest";

// Reset modules before each test to clear module-level state
beforeEach(() => { vi.resetModules(); });

const mockApi = {
  slackDigest:       vi.fn(),
  slackDigestConfig: vi.fn().mockResolvedValue({ data: { channels: [], msgsPerChannel: 5 } }),
  saveSlackDigestConfig: vi.fn(),
};
const mockIsAuthError = vi.fn().mockReturnValue(false);
const mockHasCapability = vi.fn().mockReturnValue(false);

async function setup() {
  vi.mock("../../src/frontend/api.js", () => ({
    api: mockApi,
    isAuthError: (...a: any[]) => mockIsAuthError(...a),
  }));
  vi.mock("../../src/frontend/connectors.js", () => ({
    hasCapability: (...a: any[]) => mockHasCapability(...a),
  }));
  vi.mock("../../src/frontend/components/util.js", () => ({
    $:            (sel: string) => document.querySelector(sel),
    escapeHtml:   (s: string) => s,
    renderNotConnected:           () => '<div class="not-connected"></div>',
    renderWorkspaceNotConfigured: () => '<div class="not-configured"></div>',
    skeletonList:   (n: number) => `<div class="skeleton">${n}</div>`,
    toast:          vi.fn(),
  }));

  document.body.innerHTML = `
    <div id="channels-body"></div>
    <div id="channels-config-panel"></div>
    <button id="channels-config-btn"></button>
    <span id="channels-header-meta"></span>
  `;

  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockHasCapability.mockReturnValue(false);

  const { loadChannels, initChannelDigestConfig } = await import(
    "../../src/frontend/components/channel-digest.js"
  );
  return { loadChannels, initChannelDigestConfig };
}

function makeDigestChannel(overrides: any = {}) {
  return {
    channelId: "C001",
    channelName: "general",
    permalink: "https://app.slack.com/...",
    messages: [
      { authorName: "Alice", tsHuman: "10m ago", text: "Hello", html: "", ts: "1700000000.1" },
    ],
    ...overrides,
  };
}

describe("loadChannels", () => {
  it("shows skeleton while loading (non-silent)", async () => {
    const { loadChannels } = await setup();
    let resolveFn: any;
    mockApi.slackDigest.mockReturnValue(new Promise(r => { resolveFn = r; }));
    const promise = loadChannels(false);
    expect(document.getElementById("channels-body")!.innerHTML).toContain("skeleton");
    resolveFn({ data: [], notConfigured: false });
    await promise;
  });

  it("renders not-configured state when notConfigured", async () => {
    const { loadChannels } = await setup();
    mockApi.slackDigest.mockResolvedValue({ data: [], notConfigured: true });
    await loadChannels();
    expect(document.getElementById("channels-body")!.innerHTML).toContain("not-configured");
  });

  it("renders empty state when no channel data", async () => {
    const { loadChannels } = await setup();
    mockApi.slackDigest.mockResolvedValue({ data: [], notConfigured: false });
    await loadChannels();
    expect(document.getElementById("channels-body")!.innerHTML).toContain("All quiet on Slack");
  });

  it("renders channel tiles when data is present", async () => {
    const { loadChannels } = await setup();
    mockApi.slackDigest.mockResolvedValue({
      data: [makeDigestChannel()],
      notConfigured: false,
    });
    await loadChannels();
    expect(document.getElementById("channels-body")!.innerHTML).toContain("general");
    expect(document.getElementById("channels-body")!.innerHTML).toContain("Alice");
  });

  it("renders permalink link in message", async () => {
    const { loadChannels } = await setup();
    const ch = makeDigestChannel({
      messages: [{ authorName: "Bob", tsHuman: "5m ago", text: "Hey", html: "", ts: "1700000001.0", permalink: "https://app.slack.com/msg/1" }],
    });
    mockApi.slackDigest.mockResolvedValue({ data: [ch], notConfigured: false });
    await loadChannels();
    expect(document.getElementById("channels-body")!.innerHTML).toContain("Reply ↗");
  });

  it("renders channel with no messages gracefully", async () => {
    const { loadChannels } = await setup();
    const ch = makeDigestChannel({ messages: [] });
    mockApi.slackDigest.mockResolvedValue({ data: [ch], notConfigured: false });
    await loadChannels();
    expect(document.getElementById("channels-body")!.innerHTML).toContain("No recent messages");
  });

  it("renders html content when provided", async () => {
    const { loadChannels } = await setup();
    const ch = makeDigestChannel({
      messages: [{ authorName: "Carol", tsHuman: "1h ago", text: "", html: "<b>bold</b>", ts: "1700000002.0" }],
    });
    mockApi.slackDigest.mockResolvedValue({ data: [ch], notConfigured: false });
    await loadChannels();
    expect(document.getElementById("channels-body")!.innerHTML).toContain("<b>bold</b>");
  });

  it("sorts channels by most recent message first", async () => {
    const { loadChannels } = await setup();
    const old = makeDigestChannel({ channelName: "old-channel", messages: [{ ts: "1600000000.0", authorName: "X", tsHuman: "", text: "" }] });
    const recent = makeDigestChannel({ channelId: "C002", channelName: "new-channel", messages: [{ ts: "1700000000.0", authorName: "Y", tsHuman: "", text: "" }] });
    mockApi.slackDigest.mockResolvedValue({ data: [old, recent], notConfigured: false });
    await loadChannels();
    const body = document.getElementById("channels-body")!.innerHTML;
    expect(body.indexOf("new-channel")).toBeLessThan(body.indexOf("old-channel"));
  });

  it("renders not-connected on auth error", async () => {
    const { loadChannels } = await setup();
    mockIsAuthError.mockReturnValue(true);
    mockApi.slackDigest.mockRejectedValue(new Error("401"));
    await loadChannels();
    expect(document.getElementById("channels-body")!.innerHTML).toContain("not-connected");
  });

  it("renders error message on non-auth error", async () => {
    const { loadChannels } = await setup();
    mockApi.slackDigest.mockRejectedValue(new Error("Connection refused"));
    await loadChannels();
    expect(document.getElementById("channels-body")!.innerHTML).toContain("Connection refused");
  });

  it("clicking channel head toggles is-open class", async () => {
    const { loadChannels } = await setup();
    mockApi.slackDigest.mockResolvedValue({
      data: [makeDigestChannel()],
      notConfigured: false,
    });
    await loadChannels();
    const head = document.querySelector<HTMLElement>(".dg-channel-head")!;
    head.click();
    expect(document.querySelector(".dg-channel")!.classList.contains("is-open")).toBe(true);
  });

  it("clicking same channel head twice closes it", async () => {
    const { loadChannels } = await setup();
    mockApi.slackDigest.mockResolvedValue({
      data: [makeDigestChannel()],
      notConfigured: false,
    });
    await loadChannels();
    const head = document.querySelector<HTMLElement>(".dg-channel-head")!;
    head.click();
    head.click();
    expect(document.querySelector(".dg-channel")!.classList.contains("is-open")).toBe(false);
  });

  it("does not show skeleton in silent mode", async () => {
    const { loadChannels } = await setup();
    let resolveFn: any;
    mockApi.slackDigest.mockReturnValue(new Promise(r => { resolveFn = r; }));
    const promise = loadChannels(true);
    expect(document.getElementById("channels-body")!.innerHTML).not.toContain("skeleton");
    resolveFn({ data: [], notConfigured: false });
    await promise;
  });
});

describe("initChannelDigestConfig", () => {
  it("fetches config when slack capability is available", async () => {
    const { initChannelDigestConfig } = await setup();
    mockHasCapability.mockReturnValue(true);
    await initChannelDigestConfig();
    expect(mockApi.slackDigestConfig).toHaveBeenCalled();
  });

  it("skips config fetch when slack not available", async () => {
    const { initChannelDigestConfig } = await setup();
    mockHasCapability.mockReturnValue(false);
    await initChannelDigestConfig();
    expect(mockApi.slackDigestConfig).not.toHaveBeenCalled();
  });

  it("updates meta element after init", async () => {
    const { initChannelDigestConfig } = await setup();
    await initChannelDigestConfig();
    expect(document.getElementById("channels-header-meta")!.textContent).toContain("msgs");
  });

  it("handles config fetch error gracefully", async () => {
    const { initChannelDigestConfig } = await setup();
    mockHasCapability.mockReturnValue(true);
    mockApi.slackDigestConfig.mockRejectedValue(new Error("server error"));
    await expect(initChannelDigestConfig()).resolves.toBeUndefined();
  });
});
