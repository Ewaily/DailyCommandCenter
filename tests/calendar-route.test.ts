import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockGcal, mockOutlook, mockListWs, mockListOverview, mockGetIdentity, mockGetActiveWs } = vi.hoisted(() => ({
  mockGcal:         { listCalendarEvents: vi.fn() },
  mockOutlook:      { listOutlookCalendarEvents: vi.fn() },
  mockListWs:       vi.fn(),
  mockListOverview: vi.fn(),
  mockGetIdentity:  vi.fn(),
  mockGetActiveWs:  vi.fn(),
}));

vi.mock("../src/server/integrations/google-calendar.js",  () => mockGcal);
vi.mock("../src/server/integrations/outlook-calendar.js", () => mockOutlook);
vi.mock("../src/server/lib/request-context.js",  () => ({ getActiveWorkspaceId: mockGetActiveWs }));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  listConnectorsForWorkspace: mockListWs,
  listConnectorsForOverview:  mockListOverview,
  getIdentity:                mockGetIdentity,
}));

import { calendarRouter } from "../src/server/routes/calendar.js";

const app = express();
app.use(express.json());
app.use(calendarRouter);

const gcalConnector = (overrides: Record<string, unknown> = {}) => ({
  id: "gcal-1", type: "gcal", enabled: true, identityId: "id-1",
  workspaceId: "ws-1", config: {},
  ...overrides,
});

const outlookConnector = (overrides: Record<string, unknown> = {}) => ({
  id: "ol-1", type: "outlook", enabled: true, identityId: "id-2",
  workspaceId: "ws-1", config: {},
  ...overrides,
});

const event = (start: string, title = "Meeting") => ({ title, start, end: start });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWs.mockReturnValue("ws-1");
  mockListWs.mockReturnValue([gcalConnector()]);
  mockListOverview.mockReturnValue([gcalConnector()]);
  mockGetIdentity.mockReturnValue({ id: "id-1", account: "me@test.com", displayColor: null, label: null });
  mockGcal.listCalendarEvents.mockResolvedValue([]);
  mockOutlook.listOutlookCalendarEvents.mockResolvedValue([]);
});

describe("GET /events", () => {
  it("returns notConfigured when no calendar connectors exist", async () => {
    mockListWs.mockReturnValue([]);
    const res = await request(app).get("/events");
    expect(res.status).toBe(200);
    expect(res.body.notConfigured).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("returns notConfigured when connectors have no identityId", async () => {
    mockListWs.mockReturnValue([gcalConnector({ identityId: null })]);
    const res = await request(app).get("/events");
    expect(res.body.notConfigured).toBe(true);
  });

  it("returns notConfigured when connector is disabled", async () => {
    mockListWs.mockReturnValue([gcalConnector({ enabled: false })]);
    const res = await request(app).get("/events");
    expect(res.body.notConfigured).toBe(true);
  });

  it("fetches gcal events and returns them", async () => {
    mockGcal.listCalendarEvents.mockResolvedValue([event("2026-05-10T09:00:00Z")]);
    const res = await request(app).get("/events");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("fetches outlook events and returns them", async () => {
    mockListWs.mockReturnValue([outlookConnector()]);
    mockOutlook.listOutlookCalendarEvents.mockResolvedValue([event("2026-05-10T10:00:00Z")]);
    const res = await request(app).get("/events");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("merges and sorts events by start ASC from multiple connectors", async () => {
    mockListWs.mockReturnValue([gcalConnector({ id: "g1" }), outlookConnector()]);
    mockGcal.listCalendarEvents.mockResolvedValue([event("2026-05-10T12:00:00Z", "Later")]);
    mockOutlook.listOutlookCalendarEvents.mockResolvedValue([event("2026-05-10T09:00:00Z", "Earlier")]);
    const res = await request(app).get("/events");
    expect(res.body.data[0].title).toBe("Earlier");
    expect(res.body.data[1].title).toBe("Later");
  });

  it("returns partial results when one connector fails", async () => {
    mockListWs.mockReturnValue([gcalConnector({ id: "g1" }), outlookConnector()]);
    mockGcal.listCalendarEvents.mockRejectedValue(new Error("auth"));
    mockOutlook.listOutlookCalendarEvents.mockResolvedValue([event("2026-05-10T10:00:00Z")]);
    const res = await request(app).get("/events");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("scopes to connectorId when provided", async () => {
    mockListWs.mockReturnValue([gcalConnector({ id: "g1" }), gcalConnector({ id: "g2" })]);
    mockGcal.listCalendarEvents.mockResolvedValue([event("2026-05-10T09:00:00Z")]);
    const res = await request(app).get("/events?connectorId=g1");
    expect(res.status).toBe(200);
    expect(mockGcal.listCalendarEvents).toHaveBeenCalledTimes(1);
  });

  it("uses overview connectors when no workspace is active", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    mockListOverview.mockReturnValue([gcalConnector()]);
    await request(app).get("/events");
    expect(mockListOverview).toHaveBeenCalled();
    expect(mockListWs).not.toHaveBeenCalled();
  });

  it("includes fresh_at timestamp in response", async () => {
    const res = await request(app).get("/events");
    expect(typeof res.body.fresh_at).toBe("number");
  });

  it("skips disabled connectors even when mixed with enabled ones", async () => {
    mockListWs.mockReturnValue([
      gcalConnector({ id: "g1", enabled: false }),
      gcalConnector({ id: "g2", enabled: true }),
    ]);
    mockGcal.listCalendarEvents.mockResolvedValue([event("2026-05-10T09:00:00Z")]);
    const res = await request(app).get("/events");
    expect(mockGcal.listCalendarEvents).toHaveBeenCalledTimes(1);
    expect(res.body.data).toHaveLength(1);
  });
});
