import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockIsAuthError, mockGetSetting, mockSaveSetting, mockRenderTaskRow } =
  vi.hoisted(() => ({
    mockApi: {
      clickupTasks: vi.fn(),
      settingsPut: vi.fn().mockResolvedValue({}),
    },
    mockIsAuthError: vi.fn().mockReturnValue(false),
    mockGetSetting: vi.fn().mockReturnValue(undefined),
    mockSaveSetting: vi.fn(),
    mockRenderTaskRow: vi.fn(() => `<div class="task-row">task</div>`),
  }));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi, isAuthError: mockIsAuthError }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: mockGetSetting, saveSetting: mockSaveSetting }));
vi.mock("../../src/frontend/components/task-row.js", () => ({ renderTaskRow: mockRenderTaskRow }));
vi.mock("../../src/frontend/components/util.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/frontend/components/util.js")>();
  return { ...actual, animateNumber: vi.fn() };
});

import { instantiateClickUp } from "../../src/frontend/components/clickup.js";

function makeContainer() { return document.createElement("div"); }

const task = (overrides = {}) => ({
  source: "clickup" as const,
  id: "task1", customId: "CU-1", title: "Build feature",
  status: "In Progress", statusColor: "#abc", statusBucket: "in_progress" as const,
  priority: null, assignees: [], list: "Sprint", url: "https://app.clickup.com/t/task1",
  dueDate: null, updatedAt: "2026-05-06T00:00:00Z",
  ...overrides,
});

const watched = [{ id: "u2", label: "Bob", query: "" }];

const okResp = (items = [task()], buckets = watched, counts: Record<string, number> = { mine: 1, u2: 0 }) =>
  Promise.resolve({ data: items, buckets, counts, notConfigured: false, bucket: "mine" });

const notConfiguredResp = () =>
  Promise.resolve({ data: [], buckets: [], counts: {}, notConfigured: true });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockGetSetting.mockReturnValue(undefined);
  mockRenderTaskRow.mockReturnValue(`<div class="task-row">task</div>`);
});

// ── structure ─────────────────────────────────────────────────────────────
describe("instantiateClickUp — HTML structure", () => {
  it("renders title-source and title-text", () => {
    mockApi.clickupTasks.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateClickUp(c, "conn-1", { wsName: "Acme · bob", title: "Tasks" });
    expect(c.querySelector(".title-source")?.textContent).toBe("Acme · bob");
    expect(c.querySelector(".title-text")?.textContent?.trim()).toContain("Tasks");
  });

  it("renders the tabs container", () => {
    mockApi.clickupTasks.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    expect(c.querySelector("[data-ov-tabs]")).toBeTruthy();
  });

  it("renders the card-body container", () => {
    mockApi.clickupTasks.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    expect(c.querySelector("[data-ov-body]")).toBeTruthy();
  });

  it("hides tabs when only mine bucket (≤1)", async () => {
    // single-bucket response → tabs hidden
    mockApi.clickupTasks.mockResolvedValue(
      Promise.resolve({ data: [], buckets: [], counts: { mine: 0 }, notConfigured: false, bucket: "mine" })
    );
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    const tabsEl = c.querySelector("[data-ov-tabs]")!;
    expect(tabsEl.innerHTML).toBe("");
  });
});

// ── load() ────────────────────────────────────────────────────────────────
describe("instantiateClickUp — load()", () => {
  it("passes connectorId to api.clickupTasks", async () => {
    mockApi.clickupTasks.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-xyz", { wsName: "WS", title: "Tasks" });
    await inst.load();
    expect(mockApi.clickupTasks).toHaveBeenCalledWith("mine", "conn-xyz");
  });

  it("renders notConfigured state", async () => {
    mockApi.clickupTasks.mockResolvedValue(notConfiguredResp());
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.textContent).toContain("ClickUp");
  });

  it("renders task rows via renderTaskRow", async () => {
    mockApi.clickupTasks.mockResolvedValue(okResp([task(), task({ id: "task2", customId: "CU-2" })]));
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    expect(c.querySelectorAll("[data-ov-body] .task-row").length).toBe(2);
  });

  it("renders empty state when no tasks", async () => {
    mockApi.clickupTasks.mockResolvedValue(okResp([]));
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    expect(c.querySelector("[data-ov-body] .empty")).toBeTruthy();
  });

  it("expands tabs when watched users are returned", async () => {
    mockApi.clickupTasks.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    const tabs = Array.from(c.querySelectorAll<HTMLElement>("[data-ov-bucket]"))
      .map(b => b.dataset.ovBucket);
    expect(tabs).toContain("mine");
    expect(tabs).toContain("u2");
  });

  it("renders error on API failure", async () => {
    mockApi.clickupTasks.mockRejectedValue(new Error("clickup down"));
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.textContent).toContain("clickup down");
  });

  it("resets to mine when stored bucket disappears", async () => {
    mockGetSetting.mockImplementation((k: string) => k === "clickupTab" ? "u2" : undefined);
    mockApi.clickupTasks
      .mockResolvedValueOnce(okResp([task()], watched, { mine: 1, u2: 0 }))
      .mockResolvedValueOnce(okResp([task()], [], { mine: 1 }));
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();
    await inst.load();
    expect(mockSaveSetting).toHaveBeenCalledWith("clickupTab", "mine");
  });
});

// ── tab switching ─────────────────────────────────────────────────────────
describe("instantiateClickUp — tab switching", () => {
  it("clicking a tab saves bucket and reloads", async () => {
    mockApi.clickupTasks.mockResolvedValue(okResp());
    const c = makeContainer();
    const inst = instantiateClickUp(c, "conn-1", { wsName: "WS", title: "Tasks" });
    await inst.load();

    c.querySelector<HTMLElement>("[data-ov-bucket='u2']")!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockSaveSetting).toHaveBeenCalledWith("clickupTab", "u2");
    expect(mockApi.clickupTasks).toHaveBeenLastCalledWith("u2", "conn-1");
  });
});

// ── instance isolation ─────────────────────────────────────────────────────
describe("instantiateClickUp — instance isolation", () => {
  it("two instances use their own connectorIds", async () => {
    mockApi.clickupTasks.mockResolvedValue(okResp());
    const c1 = makeContainer();
    const c2 = makeContainer();
    const i1 = instantiateClickUp(c1, "conn-A", { wsName: "WS-A", title: "Tasks" });
    const i2 = instantiateClickUp(c2, "conn-B", { wsName: "WS-B", title: "Tasks" });
    await Promise.all([i1.load(), i2.load()]);
    const ids = (mockApi.clickupTasks as ReturnType<typeof vi.fn>).mock.calls.map(([, id]) => id);
    expect(ids).toContain("conn-A");
    expect(ids).toContain("conn-B");
  });
});
