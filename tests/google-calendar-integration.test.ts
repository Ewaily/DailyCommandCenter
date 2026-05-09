import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { mockCalEventsList, mockGetGoogleAuth } = vi.hoisted(() => ({
  mockCalEventsList: vi.fn(),
  mockGetGoogleAuth: vi.fn().mockResolvedValue({ credentials: {} }),
}));

vi.mock("googleapis", () => ({
  google: {
    calendar: () => ({
      events: { list: mockCalEventsList },
    }),
  },
}));
vi.mock("../src/server/auth/google.js", () => ({ getGoogleAuth: mockGetGoogleAuth }));

import { listCalendarEvents } from "../src/server/integrations/google-calendar.js";

const TODAY = new Date().toISOString().slice(0, 10);

const makeItem = (overrides: Record<string, any> = {}) => ({
  id: "evt-1",
  summary: "Standup",
  htmlLink: "https://calendar.google.com/event/1",
  eventType: undefined,
  start: { dateTime: `${TODAY}T09:00:00Z` },
  end:   { dateTime: `${TODAY}T09:30:00Z` },
  attendees: [],
  created: new Date().toISOString(),
  hangoutLink: null,
  conferenceData: null,
  location: null,
  description: null,
  draft: false,
  ...overrides,
});

function stubList(items: any[]) {
  mockCalEventsList.mockResolvedValue({ data: { items } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetGoogleAuth.mockResolvedValue({ credentials: {} });
});
afterEach(() => vi.restoreAllMocks());

// ── listCalendarEvents ────────────────────────────────────────────────────────

describe("listCalendarEvents", () => {
  it("returns empty array when API returns no items", async () => {
    stubList([]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result).toEqual([]);
  });

  it("maps summary to title", async () => {
    stubList([makeItem()]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].title).toBe("Standup");
  });

  it("falls back to (untitled) when summary is empty", async () => {
    stubList([makeItem({ summary: null })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].title).toBe("(untitled)");
  });

  it("filters out birthday eventType", async () => {
    stubList([makeItem({ eventType: "birthday" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result).toHaveLength(0);
  });

  it("filters out workingLocation eventType", async () => {
    stubList([makeItem({ eventType: "workingLocation" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result).toHaveLength(0);
  });

  it("filters out fromGmail eventType", async () => {
    stubList([makeItem({ eventType: "fromGmail" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result).toHaveLength(0);
  });

  it("filters out events with no start or end", async () => {
    stubList([makeItem({ start: {}, end: {} })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result).toHaveLength(0);
  });

  it("calculates durationMinutes correctly", async () => {
    stubList([makeItem()]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].durationMinutes).toBe(30);
  });

  it("detects all-day events via date-only start", async () => {
    stubList([makeItem({ start: { date: TODAY }, end: { date: TODAY } })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].isAllDay).toBe(true);
  });

  it("detects focusTime event type as isFocus", async () => {
    stubList([makeItem({ eventType: "focusTime", summary: "Focus Block" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].isFocus).toBe(true);
    expect(result[0].badges).toContain("focus");
  });

  it("detects 'focus' keyword in summary as isFocus", async () => {
    stubList([makeItem({ summary: "Deep Focus Time" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].isFocus).toBe(true);
  });

  it("assigns 'new' badge when event was created today", async () => {
    stubList([makeItem({ created: new Date().toISOString() })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].badges).toContain("new");
  });

  it("does not assign 'new' badge for old events", async () => {
    stubList([makeItem({ created: "2020-01-01T00:00:00Z" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].badges).not.toContain("new");
  });

  it("assigns 'respond' badge when responseStatus is needsAction", async () => {
    stubList([makeItem({ attendees: [{ self: true, responseStatus: "needsAction" }] })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].responseStatus).toBe("needsAction");
    expect(result[0].badges).toContain("respond");
  });

  it("assigns 'tentative' badge for tentative response", async () => {
    stubList([makeItem({ attendees: [{ self: true, responseStatus: "tentative" }] })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].badges).toContain("tentative");
  });

  it("assigns 'declined' badge for declined response", async () => {
    stubList([makeItem({ attendees: [{ self: true, responseStatus: "declined" }] })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].badges).toContain("declined");
  });

  it("counts attendees excluding self and resources", async () => {
    stubList([makeItem({
      attendees: [
        { self: true, responseStatus: "accepted" },
        { resource: true, email: "room@co.com" },
        { self: false, resource: false, email: "bob@co.com" },
        { self: false, resource: false, email: "alice@co.com" },
      ],
    })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].attendeeCount).toBe(2);
  });

  it("extracts hangoutLink as meetUrl", async () => {
    stubList([makeItem({ hangoutLink: "https://meet.google.com/abc-defg-hij" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].meetUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("extracts conferenceData video entry as meetUrl", async () => {
    stubList([makeItem({
      conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/123" }] },
    })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].meetUrl).toBe("https://zoom.us/j/123");
  });

  it("extracts zoom link from location field", async () => {
    stubList([makeItem({ location: "https://zoom.us/j/123456" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].meetUrl).toContain("zoom.us");
  });

  it("extracts meet link from description", async () => {
    stubList([makeItem({ description: "Join at https://meet.google.com/abc-def-ghi" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].meetUrl).toContain("meet.google.com");
  });

  it("returns null meetUrl when no meeting link is present", async () => {
    stubList([makeItem({ description: "Just a meeting" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].meetUrl).toBeNull();
  });

  it("passes sourceColor and sourceLabel from calConfig", async () => {
    stubList([makeItem()]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: "#FF0000", label: "Work" }, "", "");
    expect(result[0].sourceColor).toBe("#FF0000");
    expect(result[0].sourceLabel).toBe("Work");
  });

  it("uses teams link from location", async () => {
    stubList([makeItem({ location: "https://teams.microsoft.com/l/meetup-join/abc" })]);
    const result = await listCalendarEvents("id-1", { calendarId: "primary", color: null, label: null }, "", "");
    expect(result[0].meetUrl).toContain("teams.microsoft.com");
  });
});
