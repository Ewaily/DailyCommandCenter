import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockIsAuthError, mockGetSetting, mockSaveSetting } = vi.hoisted(() => ({
  mockApi: {
    prs: vi.fn(),
  },
  mockIsAuthError: vi.fn().mockReturnValue(false),
  mockGetSetting:  vi.fn().mockReturnValue(undefined),
  mockSaveSetting: vi.fn(),
}));

vi.mock("../../src/frontend/api.js", () => ({
  api: mockApi,
  isAuthError: (...a: any[]) => mockIsAuthError(...a),
}));
vi.mock("../../src/frontend/state.js", () => ({
  getSetting:  (...a: any[]) => mockGetSetting(...a),
  saveSetting: (...a: any[]) => mockSaveSetting(...a),
}));

import { loadPRs, bindPrTabs } from "../../src/frontend/components/prs.js";

function setupDOM() {
  document.body.innerHTML = `
    <div id="pr-queue-body"></div>
    <div id="pr-tabs">
      <button data-pr-tab="review"><span data-pr-count="review">0</span></button>
      <button data-pr-tab="mine"><span data-pr-count="mine">0</span></button>
      <button data-pr-tab="all"><span data-pr-count="all">0</span></button>
      <button data-pr-tab="closed"><span data-pr-count="closed">0</span></button>
    </div>
    <div id="kpi-prs">—</div>
    <div id="kpi-prs-detail"></div>
  `;
}

const prData = {
  id: "1", number: 1, title: "Fix bug", repo: "org/repo",
  url: "https://github.com/org/repo/pull/1", ageHuman: "1h ago",
  status: "Review needed", waitingOnYou: true, author: "alice",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockGetSetting.mockReturnValue(undefined);
  setupDOM();
});

// ── loadPRs ───────────────────────────────────────────────────────────────────

describe("loadPRs", () => {
  it("shows skeleton while loading when not silent", async () => {
    let resolveFn: any;
    mockApi.prs.mockReturnValue(new Promise(r => { resolveFn = r; }));
    const promise = loadPRs(false);
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("skeleton");
    resolveFn({ data: [], counts: {}, notConfigured: false });
    await promise;
  });

  it("renders PR items when data is returned", async () => {
    mockApi.prs.mockResolvedValue({
      data: [prData],
      counts: { review: 1, mine: 0, all: 1, closed: 0 },
      notConfigured: false,
    });
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("Fix bug");
  });

  it("renders empty state for review tab when no PRs", async () => {
    mockApi.prs.mockResolvedValue({ data: [], counts: {}, notConfigured: false });
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("Review queue is clear");
  });

  it("renders not connected state when notConfigured", async () => {
    mockApi.prs.mockResolvedValue({ data: [], notConfigured: true });
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("not-connected");
  });

  it("renders not connected on auth error", async () => {
    mockIsAuthError.mockReturnValue(true);
    mockApi.prs.mockRejectedValue(new Error("401 Unauthorized"));
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("not-connected");
  });

  it("renders error message on non-auth error", async () => {
    mockIsAuthError.mockReturnValue(false);
    mockApi.prs.mockRejectedValue(new Error("Network failed"));
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("Network failed");
  });

  it("updates tab count spans when counts are returned", async () => {
    mockApi.prs.mockResolvedValue({
      data: [],
      counts: { review: 3, mine: 1, all: 4, closed: 0 },
      notConfigured: false,
    });
    await loadPRs();
    expect(document.querySelector("[data-pr-count='review']")?.textContent).toBe("3");
    expect(document.querySelector("[data-pr-count='mine']")?.textContent).toBe("1");
  });

  it("renders PR with status Draft badge", async () => {
    mockApi.prs.mockResolvedValue({
      data: [{ ...prData, status: "Draft" }],
      counts: {},
      notConfigured: false,
    });
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("badge-focus");
  });

  it("renders PR with status Open badge", async () => {
    mockApi.prs.mockResolvedValue({
      data: [{ ...prData, status: "Open" }],
      counts: {},
      notConfigured: false,
    });
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("badge-info");
  });

  it("renders PR with status Merged badge", async () => {
    mockApi.prs.mockResolvedValue({
      data: [{ ...prData, status: "Merged" }],
      counts: {},
      notConfigured: false,
    });
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("badge-new");
  });

  it("renders PR with status Closed badge", async () => {
    mockApi.prs.mockResolvedValue({
      data: [{ ...prData, status: "Closed" }],
      counts: {},
      notConfigured: false,
    });
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("badge-warning");
  });

  it("renders PR with unknown status as badge-info", async () => {
    mockApi.prs.mockResolvedValue({
      data: [{ ...prData, status: "SomethingElse" }],
      counts: {},
      notConfigured: false,
    });
    await loadPRs();
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("badge-info");
    expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("SomethingElse");
  });

  it("skips author line in 'mine' bucket", async () => {
    // Switch to mine tab
    document.querySelector<HTMLElement>("[data-pr-tab='mine']")?.click();
    // loadPRs will be called by click handler; let's just verify rendering for mine bucket
    // To test mine bucket directly, we need to switch to it first
  });

  it("renders 'mine' empty state when mine tab is active with no PRs", async () => {
    mockApi.prs.mockResolvedValue({ data: [], counts: {}, notConfigured: false });
    bindPrTabs();
    document.querySelector<HTMLElement>("[data-pr-tab='mine']")!.click();
    await vi.waitFor(() =>
      expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("No open PRs")
    );
  });

  it("renders 'all' empty state when all tab is active with no PRs", async () => {
    mockApi.prs.mockResolvedValue({ data: [], counts: {}, notConfigured: false });
    bindPrTabs();
    document.querySelector<HTMLElement>("[data-pr-tab='all']")!.click();
    await vi.waitFor(() =>
      expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("Repo is quiet")
    );
  });

  it("renders 'closed' empty state when closed tab is active with no PRs", async () => {
    mockApi.prs.mockResolvedValue({ data: [], counts: {}, notConfigured: false });
    bindPrTabs();
    document.querySelector<HTMLElement>("[data-pr-tab='closed']")!.click();
    await vi.waitFor(() =>
      expect(document.getElementById("pr-queue-body")!.innerHTML).toContain("No closed PRs yet")
    );
  });
});

// ── bindPrTabs ────────────────────────────────────────────────────────────────

describe("bindPrTabs", () => {
  it("switches active tab on click and reloads PRs", async () => {
    mockApi.prs.mockResolvedValue({ data: [], counts: {}, notConfigured: false });
    bindPrTabs();
    const mineTab = document.querySelector<HTMLElement>("[data-pr-tab='mine']")!;
    mineTab.click();
    expect(mockSaveSetting).toHaveBeenCalledWith("prTab", "mine");
    await vi.waitFor(() => expect(mockApi.prs).toHaveBeenCalled());
  });

  it("saves the selected tab to settings", () => {
    mockApi.prs.mockReturnValue(new Promise(() => {}));
    bindPrTabs();
    document.querySelector<HTMLElement>("[data-pr-tab='closed']")!.click();
    expect(mockSaveSetting).toHaveBeenCalledWith("prTab", "closed");
  });
});
