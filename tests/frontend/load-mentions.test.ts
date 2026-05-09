import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockIsAuthError, mockGetPrimaryTz } = vi.hoisted(() => ({
  mockApi: { mentions: vi.fn() },
  mockIsAuthError: vi.fn().mockReturnValue(false),
  mockGetPrimaryTz: vi.fn().mockReturnValue("UTC"),
}));

vi.mock("../../src/frontend/api.js", () => ({
  api: mockApi,
  isAuthError: (...a: any[]) => mockIsAuthError(...a),
}));
vi.mock("../../src/frontend/state.js", () => ({
  getSetting: vi.fn().mockReturnValue(undefined),
  saveSetting: vi.fn(),
}));
vi.mock("../../src/frontend/components/tz.js", () => ({
  getPrimaryTz: (...a: any[]) => mockGetPrimaryTz(...a),
}));
vi.mock("../../src/frontend/components/util.js", () => ({
  $:           (sel: string) => document.querySelector(sel),
  escapeHtml:  (s: string) => s,
  skeletonList: (n: number) => `<div class="skeleton">${n}</div>`,
  animateNumber: vi.fn(),
  renderNotConnected: () => '<div class="not-connected"></div>',
  renderWorkspaceNotConfigured: () => '<div class="not-configured"></div>',
}));

import { loadMentions } from "../../src/frontend/components/mentions.js";

function setupDOM() {
  document.body.innerHTML = `
    <div id="mentions-body"></div>
    <div id="mentions-day-label">Today</div>
    <div id="mentions-today-btn" class="active"></div>
    <span id="kpi-mentions">—</span>
    <span id="kpi-mentions-detail"></span>
  `;
}

const NOW_SEC = Math.floor(Date.now() / 1000);

function makeMention(overrides: any = {}) {
  return {
    channelId: "C1", channelName: "general", isDm: false,
    ts: `${NOW_SEC}.000000`, tsHuman: "12:00 PM",
    authorId: "U1", authorName: "Alice", authorAvatar: null,
    text: "Hello", html: "<p>Hello</p>",
    permalink: "https://slack.com/p/1",
    urgent: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockGetPrimaryTz.mockReturnValue("UTC");
  setupDOM();
});

describe("loadMentions", () => {
  it("does nothing when #mentions-body is absent", async () => {
    document.body.innerHTML = "";
    await expect(loadMentions()).resolves.toBeUndefined();
  });

  it("shows skeleton while loading (not silent)", async () => {
    let resolveFn: any;
    mockApi.mentions.mockReturnValue(new Promise(r => { resolveFn = r; }));
    const promise = loadMentions(false);
    expect(document.getElementById("mentions-body")!.innerHTML).toContain("skeleton");
    resolveFn({ data: [], notConfigured: false });
    await promise;
  });

  it("does not show skeleton in silent mode", async () => {
    let resolveFn: any;
    mockApi.mentions.mockReturnValue(new Promise(r => { resolveFn = r; }));
    const promise = loadMentions(true);
    expect(document.getElementById("mentions-body")!.innerHTML).not.toContain("skeleton");
    resolveFn({ data: [], notConfigured: false });
    await promise;
  });

  it("renders notConfigured state", async () => {
    mockApi.mentions.mockResolvedValue({ data: [], notConfigured: true });
    await loadMentions();
    expect(document.getElementById("mentions-body")!.innerHTML).toContain("not-configured");
    expect(document.getElementById("kpi-mentions")!.textContent).toBe("—");
    expect(document.getElementById("kpi-mentions-detail")!.textContent).toBe("Not in this workspace");
  });

  it("renders mention items when data is present", async () => {
    mockApi.mentions.mockResolvedValue({ data: [makeMention()], notConfigured: false });
    await loadMentions();
    expect(document.getElementById("mentions-body")!.innerHTML).toContain("Alice");
  });

  it("renders not-connected on auth error", async () => {
    mockIsAuthError.mockReturnValue(true);
    mockApi.mentions.mockRejectedValue(new Error("401"));
    await loadMentions();
    expect(document.getElementById("mentions-body")!.innerHTML).toContain("not-connected");
    expect(document.getElementById("kpi-mentions")!.textContent).toBe("—");
    expect(document.getElementById("kpi-mentions-detail")!.textContent).toBe("Not connected");
  });

  it("renders error message on non-auth error", async () => {
    mockApi.mentions.mockRejectedValue(new Error("Connection refused"));
    await loadMentions();
    expect(document.getElementById("mentions-body")!.innerHTML).toContain("Connection refused");
  });
});
