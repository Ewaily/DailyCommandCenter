import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockSlack, mockSlackAuth, mockListWs, mockListOverview, mockUpdateConnector, mockGetActiveWs } = vi.hoisted(() => ({
  mockSlack: {
    getChannelDigest:        vi.fn(),
    getMentions:             vi.fn(),
    invalidateMentionsCache: vi.fn(),
  },
  mockSlackAuth: {
    getSlackToken:  vi.fn(),
    getSlackUserId: vi.fn(),
  },
  mockListWs:          vi.fn(),
  mockListOverview:    vi.fn(),
  mockUpdateConnector: vi.fn(),
  mockGetActiveWs:     vi.fn(),
}));

vi.mock("../src/server/integrations/slack.js",    () => mockSlack);
vi.mock("../src/server/auth/slack.js",            () => mockSlackAuth);
vi.mock("../src/server/lib/request-context.js",   () => ({ getActiveWorkspaceId: mockGetActiveWs }));
vi.mock("../src/server/lib/workspace-config.js", () => ({
  listConnectorsForWorkspace: mockListWs,
  listConnectorsForOverview:  mockListOverview,
  updateConnectorInstance:    mockUpdateConnector,
}));

import { slackRouter } from "../src/server/routes/slack.js";

const app = express();
app.use(express.json());
app.use(slackRouter);

const slackConnector = (overrides: Record<string, unknown> = {}) => ({
  id: "slack-1", type: "slack", enabled: true, identityId: "id-1",
  workspaceId: "ws-1", config: {},
  ...overrides,
});

const digestConnector = (channels = [{ id: "C1", name: "general" }]) =>
  slackConnector({ config: { digestChannels: channels, msgsPerChannel: 5 } });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveWs.mockReturnValue("ws-1");
  mockListWs.mockReturnValue([slackConnector()]);
  mockListOverview.mockReturnValue([slackConnector()]);
  mockSlackAuth.getSlackToken.mockReturnValue("xoxp-token");
  mockSlackAuth.getSlackUserId.mockReturnValue("U123");
  mockSlack.getChannelDigest.mockResolvedValue([]);
  mockSlack.getMentions.mockResolvedValue([]);
});

// ── GET /digest ────────────────────────────────────────────────────────────────

describe("GET /digest", () => {
  it("returns notConfigured when no connectors are available", async () => {
    mockListWs.mockReturnValue([]);
    const res = await request(app).get("/digest");
    expect(res.body.notConfigured).toBe(true);
  });

  it("skips connector when getSlackToken throws", async () => {
    mockSlackAuth.getSlackToken.mockImplementation(() => { throw new Error("no token"); });
    const res = await request(app).get("/digest");
    expect(res.body.notConfigured).toBe(true);
  });

  it("skips disabled connectors", async () => {
    mockListWs.mockReturnValue([slackConnector({ enabled: false })]);
    const res = await request(app).get("/digest");
    expect(res.body.notConfigured).toBe(true);
  });

  it("merges digest channels and deduplicates by channelId", async () => {
    mockListWs.mockReturnValue([digestConnector(), digestConnector([{ id: "C1", name: "general" }, { id: "C2", name: "eng" }])]);
    mockSlack.getChannelDigest
      .mockResolvedValueOnce([{ channelId: "C1", messages: [] }])
      .mockResolvedValueOnce([{ channelId: "C1", messages: [] }, { channelId: "C2", messages: [] }]);
    const res = await request(app).get("/digest");
    expect(res.body.data).toHaveLength(2); // C1 deduped, C2 new
  });

  it("gracefully handles connector failure and returns partial results", async () => {
    mockListWs.mockReturnValue([digestConnector([{ id: "C1", name: "g" }]), digestConnector([{ id: "C2", name: "e" }])]);
    mockSlack.getChannelDigest
      .mockRejectedValueOnce(new Error("Slack down"))
      .mockResolvedValueOnce([{ channelId: "C2", messages: [] }]);
    const res = await request(app).get("/digest");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("scopes to a specific connectorId", async () => {
    mockListWs.mockReturnValue([
      slackConnector({ id: "s1" }),
      slackConnector({ id: "s2" }),
    ]);
    mockSlack.getChannelDigest.mockResolvedValue([{ channelId: "CX", messages: [] }]);
    const res = await request(app).get("/digest?connectorId=s1");
    expect(res.status).toBe(200);
    expect(mockSlack.getChannelDigest).toHaveBeenCalledTimes(1);
  });

  it("includes fresh_at timestamp in response", async () => {
    mockListWs.mockReturnValue([digestConnector()]);
    const res = await request(app).get("/digest");
    expect(typeof res.body.fresh_at).toBe("number");
  });
});

// ── GET /digest/config ─────────────────────────────────────────────────────────

describe("GET /digest/config", () => {
  it("returns empty channels when no connector is configured", async () => {
    mockListWs.mockReturnValue([]);
    const res = await request(app).get("/digest/config");
    expect(res.status).toBe(200);
    expect(res.body.data.channels).toEqual([]);
    expect(res.body.data.msgsPerChannel).toBe(5);
  });

  it("returns the configured channels from the first connector", async () => {
    mockListWs.mockReturnValue([digestConnector([{ id: "C1", name: "general" }])]);
    const res = await request(app).get("/digest/config");
    expect(res.body.data.channels).toHaveLength(1);
    expect(res.body.data.channels[0].id).toBe("C1");
  });

  it("returns msgsPerChannel from connector config", async () => {
    mockListWs.mockReturnValue([slackConnector({ config: { digestChannels: [{ id: "C1", name: "g" }], msgsPerChannel: 10 } })]);
    const res = await request(app).get("/digest/config");
    expect(res.body.data.msgsPerChannel).toBe(10);
  });
});

// ── PUT /digest/config ─────────────────────────────────────────────────────────

describe("PUT /digest/config", () => {
  it("returns 400 when no active workspace", async () => {
    mockGetActiveWs.mockReturnValue(undefined);
    const res = await request(app).put("/digest/config").send({ channels: [], msgsPerChannel: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no active workspace/);
  });

  it("returns 400 when body is invalid (channels not array)", async () => {
    const res = await request(app).put("/digest/config").send({ channels: "bad", msgsPerChannel: 5 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when msgsPerChannel is not a number", async () => {
    const res = await request(app).put("/digest/config").send({ channels: [], msgsPerChannel: "five" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when no owned Slack connector exists for workspace", async () => {
    mockListWs.mockReturnValue([slackConnector({ workspaceId: "other-ws" })]);
    const res = await request(app).put("/digest/config").send({ channels: [], msgsPerChannel: 5 });
    expect(res.status).toBe(404);
  });

  it("saves config and calls updateConnectorInstance", async () => {
    mockListWs.mockReturnValue([slackConnector({ id: "slack-1", workspaceId: "ws-1" })]);
    const res = await request(app).put("/digest/config").send({
      channels: [{ id: "C1", name: "general" }],
      msgsPerChannel: 7,
    });
    expect(res.status).toBe(200);
    expect(mockUpdateConnector).toHaveBeenCalledWith("slack-1", expect.objectContaining({
      config: expect.objectContaining({ digestChannels: [{ id: "C1", name: "general" }], msgsPerChannel: 7 }),
    }));
  });

  it("clamps msgsPerChannel to max 20", async () => {
    mockListWs.mockReturnValue([slackConnector({ workspaceId: "ws-1" })]);
    const res = await request(app).put("/digest/config").send({ channels: [], msgsPerChannel: 999 });
    expect(res.body.data.msgsPerChannel).toBe(20);
  });

  it("clamps msgsPerChannel to min 1", async () => {
    mockListWs.mockReturnValue([slackConnector({ workspaceId: "ws-1" })]);
    const res = await request(app).put("/digest/config").send({ channels: [], msgsPerChannel: 0 });
    expect(res.body.data.msgsPerChannel).toBe(1);
  });

  it("strips channels with no id", async () => {
    mockListWs.mockReturnValue([slackConnector({ workspaceId: "ws-1" })]);
    const res = await request(app).put("/digest/config").send({
      channels: [{ id: "", name: "bad" }, { id: "C1", name: "good" }],
      msgsPerChannel: 5,
    });
    expect(res.body.data.channels).toHaveLength(1);
    expect(res.body.data.channels[0].id).toBe("C1");
  });
});

// ── GET /channels/:id/messages ─────────────────────────────────────────────────

describe("GET /channels/:id/messages", () => {
  it("returns 501 with a redirect hint", async () => {
    const res = await request(app).get("/channels/C123/messages");
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/digest/);
  });
});

// ── GET /mentions ──────────────────────────────────────────────────────────────

describe("GET /mentions", () => {
  it("returns notConfigured when no connectors resolve", async () => {
    mockListWs.mockReturnValue([]);
    const res = await request(app).get("/mentions");
    expect(res.body.notConfigured).toBe(true);
  });

  it("fetches mentions and returns them sorted by ts descending", async () => {
    const m1 = { channelId: "C1", ts: "1000.000", text: "a" };
    const m2 = { channelId: "C1", ts: "2000.000", text: "b" };
    mockSlack.getMentions.mockResolvedValue([m1, m2]);
    const res = await request(app).get("/mentions");
    expect(res.body.data[0].ts).toBe("2000.000");
  });

  it("deduplicates mentions by channelId+ts across connectors", async () => {
    mockListWs.mockReturnValue([slackConnector({ id: "s1" }), slackConnector({ id: "s2" })]);
    const dup = { channelId: "C1", ts: "1000.000", text: "dup" };
    mockSlack.getMentions.mockResolvedValue([dup]);
    const res = await request(app).get("/mentions");
    expect(res.body.data).toHaveLength(1);
  });

  it("clamps days to 1 minimum", async () => {
    await request(app).get("/mentions?days=0");
    expect(mockSlack.getMentions).toHaveBeenCalledWith(expect.anything(), expect.anything(), 1);
  });

  it("clamps days to 30 maximum", async () => {
    await request(app).get("/mentions?days=999");
    expect(mockSlack.getMentions).toHaveBeenCalledWith(expect.anything(), expect.anything(), 30);
  });

  it("calls invalidateMentionsCache when bust=1", async () => {
    await request(app).get("/mentions?bust=1");
    expect(mockSlack.invalidateMentionsCache).toHaveBeenCalled();
  });

  it("does not call invalidateMentionsCache without bust param", async () => {
    await request(app).get("/mentions");
    expect(mockSlack.invalidateMentionsCache).not.toHaveBeenCalled();
  });

  it("continues when one connector's getMentions rejects", async () => {
    mockListWs.mockReturnValue([slackConnector({ id: "s1" }), slackConnector({ id: "s2" })]);
    mockSlack.getMentions
      .mockRejectedValueOnce(new Error("auth"))
      .mockResolvedValueOnce([{ channelId: "C2", ts: "1.0", text: "ok" }]);
    const res = await request(app).get("/mentions");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
