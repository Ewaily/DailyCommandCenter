import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// ── hoisted mocks (run before any import) ──────────────────────────────────
const { mockApi, mockIsAuthError, mockGetSetting, mockSaveSetting, mockGetPrimaryTz } =
  vi.hoisted(() => ({
    mockApi: {
      calendarEvents: vi.fn(),
      settingsPut: vi.fn().mockResolvedValue({}),
    },
    mockIsAuthError: vi.fn().mockReturnValue(false),
    mockGetSetting: vi.fn().mockReturnValue(undefined),
    mockSaveSetting: vi.fn(),
    mockGetPrimaryTz: vi.fn().mockReturnValue("UTC"),
  }));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi, isAuthError: mockIsAuthError }));
vi.mock("../../src/frontend/state.js", () => ({ getSetting: mockGetSetting, saveSetting: mockSaveSetting }));
vi.mock("../../src/frontend/components/tz.js", () => ({ getPrimaryTz: mockGetPrimaryTz }));
vi.mock("../../src/frontend/components/header.js", () => ({ setDayBounds: vi.fn() }));

import { instantiateSchedule } from "../../src/frontend/components/schedule.js";

// ── helpers ────────────────────────────────────────────────────────────────
function makeContainer() { return document.createElement("div"); }

const calEvent = (overrides = {}) => ({
  id: "e1", title: "Standup", start: "2026-05-06T09:00:00Z",
  end: "2026-05-06T09:30:00Z", durationMinutes: 30,
  isFocus: false, isAllDay: false, isCreatedToday: false,
  responseStatus: "accepted", attendeeCount: 3,
  meetUrl: null, htmlLink: "https://cal.example/e1",
  badges: [], sourceColor: null, sourceLabel: null,
  ...overrides,
});

const okResp = (events: object[] = [calEvent()]) =>
  Promise.resolve({ data: events, notConfigured: false });

const notConfiguredResp = () =>
  Promise.resolve({ data: [], notConfigured: true });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPrimaryTz.mockReturnValue("UTC");
  mockIsAuthError.mockReturnValue(false);
});

// ── structure ──────────────────────────────────────────────────────────────
describe("instantiateSchedule — HTML structure", () => {
  it("renders title-source and title-text", () => {
    mockApi.calendarEvents.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "Acme · alice", title: "My Calendar" });
    expect(c.querySelector(".title-source")?.textContent).toBe("Acme · alice");
    expect(c.querySelector(".title-text")?.textContent?.trim()).toContain("My Calendar");
  });

  it("renders the three day-navigation buttons", () => {
    mockApi.calendarEvents.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    expect(c.querySelector("[data-ov-nav='prev']")).toBeTruthy();
    expect(c.querySelector("[data-ov-nav='today']")).toBeTruthy();
    expect(c.querySelector("[data-ov-nav='next']")).toBeTruthy();
  });

  it("renders all four filter chips", () => {
    mockApi.calendarEvents.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    const chips = c.querySelectorAll("[data-ov-chips] .chip");
    const filters = Array.from(chips).map(ch => (ch as HTMLElement).dataset.filter);
    expect(filters).toEqual(["all", "mine", "needs-response", "hide-focus"]);
  });

  it("marks the chip matching getSetting as active", () => {
    mockGetSetting.mockImplementation((k: string) => k === "scheduleFilter" ? "mine" : undefined);
    mockApi.calendarEvents.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    const active = c.querySelector("[data-ov-chips] .chip.active") as HTMLElement;
    expect(active?.dataset.filter).toBe("mine");
  });

  it("defaults to 'all' chip when no setting is stored", () => {
    mockGetSetting.mockReturnValue(undefined);
    mockApi.calendarEvents.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    const active = c.querySelector("[data-ov-chips] .chip.active") as HTMLElement;
    expect(active?.dataset.filter).toBe("all");
  });

  it("renders the card-body container", () => {
    mockApi.calendarEvents.mockReturnValue(new Promise(() => {}));
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    expect(c.querySelector("[data-ov-body]")).toBeTruthy();
  });
});

// ── load() — API wiring ────────────────────────────────────────────────────
describe("instantiateSchedule — load()", () => {
  it("passes the connectorId to api.calendarEvents", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    const c = makeContainer();
    const inst = instantiateSchedule(c, "conn-xyz", { wsName: "WS", title: "Schedule" });
    await inst.load();
    expect(mockApi.calendarEvents).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), "conn-xyz"
    );
  });

  it("renders notConfigured state when server signals notConfigured", async () => {
    mockApi.calendarEvents.mockResolvedValue(notConfiguredResp());
    const c = makeContainer();
    const inst = instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.textContent).toContain("Calendar");
    expect(mockApi.calendarEvents).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when no events are returned", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    const c = makeContainer();
    const inst = instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    await inst.load();
    const body = c.querySelector("[data-ov-body]")!;
    expect(body.querySelector(".empty")).toBeTruthy();
  });

  it("renders event rows when data is returned", async () => {
    mockApi.calendarEvents.mockResolvedValue(okResp([calEvent(), calEvent({ id: "e2", title: "Retro" })]));
    const c = makeContainer();
    const inst = instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    await inst.load();
    const body = c.querySelector("[data-ov-body]")!;
    expect(body.querySelectorAll(".schedule-item").length).toBe(2);
  });

  it("renders the summary count", async () => {
    mockApi.calendarEvents.mockResolvedValue(okResp([calEvent()]));
    const c = makeContainer();
    const inst = instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    await inst.load();
    expect(c.querySelector("[data-ov-summary]")?.textContent).toBe("1 shown");
  });

  it("renders error message on API failure", async () => {
    mockApi.calendarEvents.mockRejectedValue(new Error("network down"));
    const c = makeContainer();
    const inst = instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    await inst.load();
    expect(c.querySelector("[data-ov-body]")?.textContent).toContain("network down");
  });
});

// ── filter chip interaction ────────────────────────────────────────────────
describe("instantiateSchedule — filter chip clicks", () => {
  it("clicking a chip saves the new filter and reloads", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    const c = makeContainer();
    const inst = instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    await inst.load();

    const mineChip = c.querySelector<HTMLElement>("[data-filter='mine']")!;
    mineChip.click();
    await new Promise(r => setTimeout(r, 0)); // flush promise

    expect(mockSaveSetting).toHaveBeenCalledWith("scheduleFilter", "mine");
    expect(mockApi.calendarEvents).toHaveBeenCalledTimes(2);
  });

  it("only one chip is active after click", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });

    const hideChip = c.querySelector<HTMLElement>("[data-filter='hide-focus']")!;
    hideChip.click();
    await new Promise(r => setTimeout(r, 0));

    const activeChips = c.querySelectorAll("[data-ov-chips] .chip.active");
    expect(activeChips.length).toBe(1);
    expect((activeChips[0] as HTMLElement).dataset.filter).toBe("hide-focus");
  });
});

// ── day navigation ─────────────────────────────────────────────────────────
describe("instantiateSchedule — day navigation", () => {
  it("clicking prev decrements offset and reloads", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });

    c.querySelector<HTMLElement>("[data-ov-nav='prev']")!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockApi.calendarEvents).toHaveBeenCalledTimes(1);
    const dayLabel = c.querySelector<HTMLElement>("[data-ov-nav='today']")?.textContent;
    expect(dayLabel).not.toBe("Today");
  });

  it("clicking today resets label to Today", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });

    c.querySelector<HTMLElement>("[data-ov-nav='prev']")!.click();
    await new Promise(r => setTimeout(r, 0));
    c.querySelector<HTMLElement>("[data-ov-nav='today']")!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(c.querySelector<HTMLElement>("[data-ov-nav='today']")?.textContent).toBe("Today");
  });

  it("next nav button triggers a reload", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    const c = makeContainer();
    instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });

    c.querySelector<HTMLElement>("[data-ov-nav='next']")!.click();
    await new Promise(r => setTimeout(r, 0));

    expect(mockApi.calendarEvents).toHaveBeenCalledTimes(1);
  });

  it("all-day events render without a time column", async () => {
    const allDay = calEvent({ isAllDay: true, start: "2026-05-06T00:00:00Z", end: "2026-05-06T23:59:59Z" });
    mockApi.calendarEvents.mockResolvedValue(okResp([allDay]));
    const c = makeContainer();
    const inst = instantiateSchedule(c, "conn-1", { wsName: "WS", title: "Schedule" });
    await inst.load();
    const timeEl = c.querySelector(".schedule-time");
    expect(timeEl?.textContent).toContain("All day");
  });
});

// ── instance isolation ─────────────────────────────────────────────────────
describe("instantiateSchedule — instance isolation", () => {
  it("two instances do not share state", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    const c1 = makeContainer();
    const c2 = makeContainer();
    instantiateSchedule(c1, "conn-A", { wsName: "WS-A", title: "Cal A" });
    instantiateSchedule(c2, "conn-B", { wsName: "WS-B", title: "Cal B" });

    // Click mine on c1 only
    c1.querySelector<HTMLElement>("[data-filter='mine']")!.click();
    await new Promise(r => setTimeout(r, 0));

    const active1 = (c1.querySelector("[data-ov-chips] .chip.active") as HTMLElement)?.dataset.filter;
    const active2 = (c2.querySelector("[data-ov-chips] .chip.active") as HTMLElement)?.dataset.filter;
    expect(active1).toBe("mine");
    expect(active2).toBe("all");
  });
});
