import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockIsAuthError, mockGetSetting, mockSaveSetting } =
  vi.hoisted(() => ({
    mockApi: {
      prs: vi.fn(),
      settingsPut: vi.fn().mockResolvedValue({}),
    },
    mockIsAuthError: vi.fn().mockReturnValue(false),
    mockGetSetting: vi.fn().mockReturnValue(undefined),
    mockSaveSetting: vi.fn(),
  }));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi, isAuthError: mockIsAuthError }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: mockGetSetting, saveSetting: mockSaveSetting }));

import { instantiatePRs } from "../../src/frontend/components/prs.js";

function makeContainer() { return document.createElement("div"); }

const pr = (overrides = {}) => ({
  id: "pr1", number: 42, title: "Fix bug", repo: "org/repo",
  url: "https://github.com/org/repo/pull/42", ageHuman: "2h ago",
  status: "Review needed", waitingOnYou: true, author: "alice",
  ...overrides,
});

const okResp = (items = [pr()], counts = { review: 1, mine: 0, all: 1, closed: 0 }) =>
  Promise.resolve({ data: items, counts, notConfigured: false });

const notConfiguredResp = () =>
  Promise.resolve({ data: [], notConfigured: true });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockGetSetting.mockReturnValue(undefined);
});

// ── structure ──────────────────────────────────────────────────────────────
describe("instantiatePRs — HTML structure", () => {
  it("renders title-source and title-text", () => {
    mockApi.prs.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiatePRs(c, "conn-1", { wsName: "Acme · bob", title: "Pull Requests" });
    expect(c.querySelector(".title-source")?.textContent).toBe("Acme · bob");
    expect(c.querySelector(".title-text")?.textContent?.trim()).toContain("Pull Requests");
  });

  it("renders four tab buttons with correct bucket values", () => {
    mockApi.prs.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    const tabs = Array.from(c.querySelectorAll<HTMLElement>("[data-ov-bucket]"))
      .map(b => b.dataset.ovBucket);
    expect(tabs).toEqual(["review", "mine", "all", "closed"]);
  });

  it("defaults active tab to 'review' when no setting stored", () => {
    mockGetSetting.mockReturnValue(undefined);
    mockApi.prs.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    const active = c.querySelector<HTMLElement>(".tab.active[data-ov-bucket]");
    expect(active?.dataset.ovBucket).toBe("review");
  });

  it("respects a stored prTab setting", () => {
    mockGetSetting.mockImplementation((k: string) => k === "prTab" ? "closed" : undefined);
    mockApi.prs.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    const active = c.querySelector<HTMLElement>(".tab.active[data-ov-bucket]");
    expect(active?.dataset.ovBucket).toBe("closed");
  });

  it("renders count badge spans for each bucket", () => {
    mockApi.prs.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    expect(c.querySelector("[data-ov-count='review']")).toBeTruthy();
    expect(c.querySelector("[data-ov-count='mine']")).toBeTruthy();
    expect(c.querySelector("[data-ov-count='all']")).toBeTruthy();
    expect(c.querySelector("[data-ov-count='closed']")).toBeTruthy();
  });

  it("renders the card-body container", () => {
    mockApi.prs.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    expect(c.querySelector("[data-ov-body]")).toBeTruthy();
  });
});

// ── load() ────────────────────────────────────────────────────────────────
describe("instantiatePRs — load()", () => {
  it("passes connectorId and active bucket to api.prs", async () => {
    mockApi.prs.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiatePRs(c, "conn-abc", { wsName: "WS", title: "PRs" });
    await inst.load();
    expect(mockApi.prs).toHaveBeenCalledWith("review", "conn-abc");
  });

  it("renders notConfigured state", async () => {
    mockApi.prs.mockResolvedValue(notConfiguredResp());
    const c = makeContainer();
    const inst = instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    await inst.load();
    const body = c.querySelector("[data-ov-body]")!;
    expect(body.querySelector(".not-connected")).toBeTruthy();
  });

  it("renders empty state when no PRs", async () => {
    mockApi.prs.mockResolvedValue(okResp([], { review: 0, mine: 0, all: 0, closed: 0 }));
    const c = makeContainer();
    const inst = instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    await inst.load();
    expect(c.querySelector("[data-ov-body] .empty")).toBeTruthy();
  });

  it("renders PR rows when data returned", async () => {
    mockApi.prs.mockResolvedValue(okResp([pr(), pr({ id: "pr2", number: 99, title: "Add feature" })]));
    const c = makeContainer();
    const inst = instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    await inst.load();
    expect(c.querySelectorAll("[data-ov-body] .schedule-item").length).toBe(2);
  });

  it("updates tab count badges from response counts", async () => {
    mockApi.prs.mockResolvedValue(okResp([pr()], { review: 5, mine: 2, all: 7, closed: 1 }));
    const c = makeContainer();
    const inst = instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    await inst.load();
    expect(c.querySelector("[data-ov-count='review']")?.textContent).toBe("5");
    expect(c.querySelector("[data-ov-count='mine']")?.textContent).toBe("2");
  });

  it("renders error message on network failure", async () => {
    mockApi.prs.mockRejectedValue(new Error("timeout"));
    const c = makeContainer();
    const inst = instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.textContent).toContain("timeout");
  });

  it("shows correct empty copy for 'mine' bucket", async () => {
    mockGetSetting.mockImplementation((k: string) => k === "prTab" ? "mine" : undefined);
    mockApi.prs.mockResolvedValue(okResp([], { review: 0, mine: 0, all: 0, closed: 0 }));
    const c = makeContainer();
    const inst = instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    await inst.load();
    expect(c.querySelector(".empty-title")?.textContent).toContain("No open PRs");
  });
});

// ── tab clicks ────────────────────────────────────────────────────────────
describe("instantiatePRs — tab switching", () => {
  it("clicking a tab saves the bucket and reloads with new bucket", async () => {
    mockApi.prs.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });
    await inst.load();

    const mineTab = c.querySelector<HTMLElement>("[data-ov-bucket='mine']")!;
    mineTab.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockSaveSetting).toHaveBeenCalledWith("prTab", "mine");
    expect(mockApi.prs).toHaveBeenLastCalledWith("mine", "conn-1");
  });

  it("clicked tab becomes the only active tab", async () => {
    mockApi.prs.mockResolvedValue(okResp());
    const c = makeContainer();
    instantiatePRs(c, "conn-1", { wsName: "WS", title: "PRs" });

    c.querySelector<HTMLElement>("[data-ov-bucket='all']")!.click();
    await new Promise(r => setTimeout(r, 0));

    const activeTabs = c.querySelectorAll(".tab.active[data-ov-bucket]");
    expect(activeTabs.length).toBe(1);
    expect((activeTabs[0] as HTMLElement).dataset.ovBucket).toBe("all");
  });
});

// ── instance isolation ────────────────────────────────────────────────────
describe("instantiatePRs — instance isolation", () => {
  it("two instances call api.prs with their own connectorIds", async () => {
    mockApi.prs.mockResolvedValue(okResp());
    const c1 = makeContainer();
    const c2 = makeContainer();
    const i1 = instantiatePRs(c1, "conn-A", { wsName: "WS-A", title: "PRs A" });
    const i2 = instantiatePRs(c2, "conn-B", { wsName: "WS-B", title: "PRs B" });
    await Promise.all([i1.load(), i2.load()]);
    const calls = (mockApi.prs as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([, id]) => id === "conn-A")).toBe(true);
    expect(calls.some(([, id]) => id === "conn-B")).toBe(true);
  });

  it("tab click on one instance does not affect the other", async () => {
    mockApi.prs.mockResolvedValue(okResp());
    const c1 = makeContainer();
    const c2 = makeContainer();
    instantiatePRs(c1, "conn-A", { wsName: "WS-A", title: "PRs" });
    instantiatePRs(c2, "conn-B", { wsName: "WS-B", title: "PRs" });

    c1.querySelector<HTMLElement>("[data-ov-bucket='closed']")!.click();
    await new Promise(r => setTimeout(r, 0));

    const active1 = (c1.querySelector(".tab.active[data-ov-bucket]") as HTMLElement)?.dataset.ovBucket;
    const active2 = (c2.querySelector(".tab.active[data-ov-bucket]") as HTMLElement)?.dataset.ovBucket;
    expect(active1).toBe("closed");
    expect(active2).toBe("review");
  });
});
