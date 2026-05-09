import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const { mockGetMicrosoftToken, mockGetIdentity } = vi.hoisted(() => ({
  mockGetMicrosoftToken: vi.fn(),
  mockGetIdentity: vi.fn(),
}));

vi.mock("../src/server/auth/microsoft.js", () => ({ getMicrosoftToken: mockGetMicrosoftToken }));
vi.mock("../src/server/lib/workspace-config.js", () => ({ getIdentity: mockGetIdentity }));

import { listOutlookCalendarEvents } from "../src/server/integrations/outlook-calendar.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TODAY = new Date().toISOString().slice(0, 10);

const makeEvent = (overrides: Record<string, any> = {}) => ({
  id: "evt-1",
  subject: "Standup",
  start: { dateTime: `${TODAY}T09:00:00`, date: null },
  end:   { dateTime: `${TODAY}T09:30:00`, date: null },
  isAllDay: false,
  responseStatus: { response: "accepted" },
  attendees: [{ type: "required", emailAddress: { name: "Bob", address: "bob@co.com" } }],
  onlineMeeting: null,
  webLink: "https://outlook.com/event/1",
  bodyPreview: "",
  createdDateTime: new Date().toISOString(),
  ...overrides,
});

function stubFetch(items: any[]) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ value: items }),
  }));
}

beforeEach(() => {
  mockGetMicrosoftToken.mockResolvedValue("ms-token");
  mockGetIdentity.mockReturnValue({ id: "id-1", displayColor: "#0078D4", label: "Work", account: "me@work.com" });
});

// ── listOutlookCalendarEvents ─────────────────────────────────────────────────

describe("listOutlookCalendarEvents", () => {
  it("returns empty array when no events", async () => {
    stubFetch([]);
    const result = await listOutlookCalendarEvents("id-1", `${TODAY}T00:00:00Z`, `${TODAY}T23:59:59Z`);
    expect(result).toEqual([]);
  });

  it("maps subject to title", async () => {
    stubFetch([makeEvent()]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].title).toBe("Standup");
  });

  it("falls back to (untitled) when subject is empty", async () => {
    stubFetch([makeEvent({ subject: "" })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].title).toBe("(untitled)");
  });

  it("maps accepted responseStatus correctly", async () => {
    stubFetch([makeEvent({ responseStatus: { response: "accepted" } })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].responseStatus).toBe("accepted");
  });

  it("maps declined responseStatus correctly", async () => {
    stubFetch([makeEvent({ responseStatus: { response: "declined" } })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].responseStatus).toBe("declined");
    expect(result[0].badges).toContain("declined");
  });

  it("maps tentativelyAccepted to tentative", async () => {
    stubFetch([makeEvent({ responseStatus: { response: "tentativelyAccepted" } })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].responseStatus).toBe("tentative");
    expect(result[0].badges).toContain("tentative");
  });

  it("maps notResponded to needsAction", async () => {
    stubFetch([makeEvent({ responseStatus: { response: "notResponded" } })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].responseStatus).toBe("needsAction");
    expect(result[0].badges).toContain("respond");
  });

  it("maps organizer to accepted", async () => {
    stubFetch([makeEvent({ responseStatus: { response: "organizer" } })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].responseStatus).toBe("accepted");
  });

  it("returns null responseStatus for unknown value", async () => {
    stubFetch([makeEvent({ responseStatus: { response: "unknown_val" } })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].responseStatus).toBeNull();
  });

  it("returns null responseStatus when responseStatus is absent", async () => {
    stubFetch([makeEvent({ responseStatus: null })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].responseStatus).toBeNull();
  });

  it("calculates durationMinutes correctly", async () => {
    stubFetch([makeEvent()]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].durationMinutes).toBe(30);
  });

  it("sets isAllDay from event property", async () => {
    stubFetch([makeEvent({ isAllDay: true })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].isAllDay).toBe(true);
  });

  it("marks isFocus when subject contains 'focus'", async () => {
    stubFetch([makeEvent({ subject: "Deep Focus Time" })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].isFocus).toBe(true);
    expect(result[0].badges).toContain("focus");
  });

  it("uses onlineMeeting.joinUrl for meetUrl", async () => {
    stubFetch([makeEvent({ onlineMeeting: { joinUrl: "https://teams.microsoft.com/meet/123" } })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].meetUrl).toBe("https://teams.microsoft.com/meet/123");
  });

  it("extracts teams link from bodyPreview when no onlineMeeting", async () => {
    stubFetch([makeEvent({ bodyPreview: "Join meeting: https://teams.microsoft.com/l/meetup-join/abc" })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].meetUrl).toContain("teams.microsoft.com");
  });

  it("extracts zoom link from bodyPreview", async () => {
    stubFetch([makeEvent({ bodyPreview: "Join at https://zoom.us/j/123456" })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].meetUrl).toContain("zoom.us");
  });

  it("sets meetUrl to null when no meeting link found", async () => {
    stubFetch([makeEvent({ bodyPreview: "Just a regular meeting" })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].meetUrl).toBeNull();
  });

  it("assigns isCreatedToday badge when event was created today", async () => {
    stubFetch([makeEvent({ createdDateTime: new Date().toISOString() })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].badges).toContain("new");
  });

  it("does not assign new badge when created on a different day", async () => {
    const old = new Date(Date.now() - 5 * 86400000).toISOString();
    stubFetch([makeEvent({ createdDateTime: old })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].badges).not.toContain("new");
  });

  it("excludes resource/room attendees from count", async () => {
    stubFetch([makeEvent({
      attendees: [
        { type: "required", emailAddress: { name: "Bob" } },
        { type: "resource", emailAddress: { name: "Room 101" } },
      ],
    })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].attendeeCount).toBe(1);
  });

  it("uses sourceColor from identity.displayColor", async () => {
    mockGetIdentity.mockReturnValue({ displayColor: "#ABCDEF", label: "Work", account: null });
    stubFetch([makeEvent()]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].sourceColor).toBe("#ABCDEF");
  });

  it("uses identity.label as sourceLabel", async () => {
    mockGetIdentity.mockReturnValue({ displayColor: null, label: "Personal", account: "me@p.com" });
    stubFetch([makeEvent()]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].sourceLabel).toBe("Personal");
  });

  it("falls back to identity.account when label is null", async () => {
    mockGetIdentity.mockReturnValue({ displayColor: null, label: null, account: "me@work.com" });
    stubFetch([makeEvent()]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].sourceLabel).toBe("me@work.com");
  });

  it("filters out events with no start or end", async () => {
    stubFetch([{ id: "bad", subject: "Bad", start: null, end: null }]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result).toHaveLength(0);
  });

  it("throws when Graph API returns non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    }));
    await expect(listOutlookCalendarEvents("id-1", "", "")).rejects.toThrow("403");
  });

  it("prefixes id with 'outlook-'", async () => {
    stubFetch([makeEvent({ id: "evt-abc" })]);
    const result = await listOutlookCalendarEvents("id-1", "", "");
    expect(result[0].id).toBe("outlook-evt-abc");
  });
});
