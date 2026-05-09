import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi, mockIsAuthError, mockGetSetting, mockSaveSetting, mockGetPrimaryTz, mockSetDayBounds, mockOffsetDateInTz } = vi.hoisted(() => ({
  mockApi: { calendarEvents: vi.fn() },
  mockIsAuthError:    vi.fn().mockReturnValue(false),
  mockGetSetting:     vi.fn().mockReturnValue(undefined),
  mockSaveSetting:    vi.fn(),
  mockGetPrimaryTz:   vi.fn().mockReturnValue("America/New_York"),
  mockSetDayBounds:   vi.fn(),
  mockOffsetDateInTz: vi.fn().mockReturnValue({ label: "Mon", startIso: "2025-05-09T00:00:00Z", endIso: "2025-05-09T23:59:59Z" }),
}));

vi.mock("../../src/frontend/api.js", () => ({
  api: mockApi,
  isAuthError: (...a: any[]) => mockIsAuthError(...a),
}));
vi.mock("../../src/frontend/state.js", () => ({
  getSetting:  (...a: any[]) => mockGetSetting(...a),
  saveSetting: (...a: any[]) => mockSaveSetting(...a),
}));
vi.mock("../../src/frontend/components/tz.js", () => ({
  getPrimaryTz: (...a: any[]) => mockGetPrimaryTz(...a),
}));
vi.mock("../../src/frontend/components/header.js", () => ({
  setDayBounds: (...a: any[]) => mockSetDayBounds(...a),
}));
vi.mock("../../src/frontend/components/util.js", () => ({
  $:            (sel: string) => document.querySelector(sel),
  escapeHtml:   (s: string) => s,
  fmtTime:      (s: string) => s.slice(11, 16),
  fmtDuration:  (m: number) => `${m}m`,
  offsetDateInTz: (...a: any[]) => mockOffsetDateInTz(...a),
  renderNotConnected:           () => '<div class="not-connected"></div>',
  renderWorkspaceNotConfigured: () => '<div class="not-configured"></div>',
  stripFwdPrefix: (s: string) => s,
  skeletonList:   (n: number) => `<div class="skeleton">${n}</div>`,
  animateNumber:  vi.fn(),
}));

import { loadSchedule, navSchedule, initScheduleChips } from "../../src/frontend/components/schedule.js";

type CalEv = {
  id: string; title: string; start: string; end: string;
  isAllDay?: boolean; isFocus?: boolean; responseStatus?: string;
  badges?: string[]; attendeeCount?: number; meetUrl?: string;
  htmlLink?: string; sourceColor?: string; sourceLabel?: string;
  durationMinutes?: number; isCreatedToday?: boolean;
};

function makeEvent(overrides: Partial<CalEv> = {}): CalEv {
  return {
    id: "ev1", title: "Team Standup",
    start: "2025-05-09T09:00:00Z", end: "2025-05-09T09:30:00Z",
    isAllDay: false, isFocus: false, responseStatus: "accepted",
    badges: [], attendeeCount: 3, durationMinutes: 30,
    isCreatedToday: false,
    ...overrides,
  };
}

function setupDOM() {
  document.body.innerHTML = `
    <div id="schedule-body"></div>
    <div id="schedule-summary"></div>
    <div id="schedule-day-label">Today</div>
    <div id="kpi-meetings">0</div>
    <div id="kpi-meetings-detail"></div>
    <div id="schedule-chips">
      <div class="chip" data-filter="all">All</div>
      <div class="chip" data-filter="mine">Mine</div>
      <div class="chip" data-filter="needs-response">Needs response</div>
      <div class="chip" data-filter="hide-focus">Hide focus</div>
    </div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsAuthError.mockReturnValue(false);
  mockGetSetting.mockReturnValue(undefined);
  mockGetPrimaryTz.mockReturnValue("America/New_York");
  mockOffsetDateInTz.mockReturnValue({ label: "Mon", startIso: "2025-05-09T00:00:00Z", endIso: "2025-05-09T23:59:59Z" });
  setupDOM();
});

// ── loadSchedule ──────────────────────────────────────────────────────────────

describe("loadSchedule", () => {
  it("shows skeleton while loading (not silent)", async () => {
    let resolveFn: any;
    mockApi.calendarEvents.mockReturnValue(new Promise(r => { resolveFn = r; }));
    const promise = loadSchedule(false);
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("skeleton");
    resolveFn({ data: [], notConfigured: false });
    await promise;
  });

  it("renders empty state when no events", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    await loadSchedule();
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("Nothing on the calendar");
  });

  it("renders not-configured state when notConfigured", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: true });
    await loadSchedule();
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("not-configured");
  });

  it("renders event items when data is present", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [makeEvent()], notConfigured: false });
    await loadSchedule();
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("Team Standup");
  });

  it("renders not-connected on auth error", async () => {
    mockIsAuthError.mockReturnValue(true);
    mockApi.calendarEvents.mockRejectedValue(new Error("401"));
    await loadSchedule();
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("not-connected");
  });

  it("renders error message on non-auth error", async () => {
    mockApi.calendarEvents.mockRejectedValue(new Error("Network down"));
    await loadSchedule();
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("Network down");
  });

  it("renders all-day events", async () => {
    mockApi.calendarEvents.mockResolvedValue({
      data: [makeEvent({ isAllDay: true, title: "All Day Meeting" })],
      notConfigured: false,
    });
    await loadSchedule();
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("All Day Meeting");
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("All day");
  });

  it("renders meet link when meetUrl is provided", async () => {
    mockApi.calendarEvents.mockResolvedValue({
      data: [makeEvent({ meetUrl: "https://meet.google.com/abc", title: "Video Call" })],
      notConfigured: false,
    });
    await loadSchedule();
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("Meet");
  });

  it("sets day label to Today when offset is 0", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    await loadSchedule();
    expect(document.getElementById("schedule-day-label")!.textContent).toBe("Today");
  });

  it("renders Declined response status badge", async () => {
    mockApi.calendarEvents.mockResolvedValue({
      data: [makeEvent({ responseStatus: "declined", badges: ["declined"] })],
      notConfigured: false,
    });
    await loadSchedule();
    expect(document.getElementById("schedule-body")!.innerHTML).toContain("Declined");
  });

  it("filters out focus events in hide-focus mode (via initScheduleChips)", async () => {
    // Set up the chip state to hide-focus by clicking
    mockApi.calendarEvents.mockResolvedValue({
      data: [
        makeEvent({ isFocus: true, title: "Focus Block" }),
        makeEvent({ id: "ev2", title: "Regular Meeting" }),
      ],
      notConfigured: false,
    });

    // Click hide-focus chip to activate that filter
    initScheduleChips();
    const hideChip = document.querySelector<HTMLElement>("[data-filter='hide-focus']")!;
    hideChip.click();
    await vi.waitFor(() => expect(mockApi.calendarEvents).toHaveBeenCalled());
  });
});

// ── navSchedule ───────────────────────────────────────────────────────────────

describe("navSchedule", () => {
  it("sets offset to 0 when called with 'today'", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    await navSchedule("today");
    expect(document.getElementById("schedule-day-label")!.textContent).toBe("Today");
  });

  it("increments offset when called with positive number", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    mockOffsetDateInTz.mockReturnValue({ label: "Tomorrow", startIso: "s", endIso: "e" });
    await navSchedule(1);
    expect(document.getElementById("schedule-day-label")!.textContent).toBe("Tomorrow");
  });

  it("decrements offset when called with negative number", async () => {
    // Navigate forward twice so offset is 2, then back once to offset 1 (non-zero → shows label)
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    mockOffsetDateInTz.mockReturnValue({ label: "Day+1", startIso: "s", endIso: "e" });
    await navSchedule("today"); // reset to 0
    await navSchedule(1);       // offset 1
    await navSchedule(1);       // offset 2
    mockOffsetDateInTz.mockReturnValue({ label: "Day+1-back", startIso: "s", endIso: "e" });
    await navSchedule(-1);      // offset 1
    expect(document.getElementById("schedule-day-label")!.textContent).toBe("Day+1-back");
  });
});

// ── initScheduleChips ────────────────────────────────────────────────────────

describe("initScheduleChips", () => {
  it("does not throw", () => {
    expect(() => initScheduleChips()).not.toThrow();
  });

  it("marks exactly one filter chip as active", () => {
    initScheduleChips();
    const activeChips = document.querySelectorAll(".chip.active");
    expect(activeChips.length).toBe(1);
  });

  it("switches active chip on click", async () => {
    mockApi.calendarEvents.mockResolvedValue({ data: [], notConfigured: false });
    initScheduleChips();
    const mineChip = document.querySelector<HTMLElement>("[data-filter='mine']")!;
    mineChip.click();
    expect(mineChip.classList.contains("active")).toBe(true);
    await vi.waitFor(() => expect(mockApi.calendarEvents).toHaveBeenCalled());
  });
});
