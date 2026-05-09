import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockNotion, mockJira } = vi.hoisted(() => ({
  mockNotion: { isConfigured: vi.fn(), listDeadlines: vi.fn() },
  mockJira:   { isConfigured: vi.fn(), listDeadlines: vi.fn() },
}));

vi.mock("../src/server/integrations/notion.js", () => mockNotion);
vi.mock("../src/server/integrations/jira.js",   () => mockJira);

import { deadlinesRouter } from "../src/server/routes/deadlines.js";

const app = express();
app.use(express.json());
app.use(deadlinesRouter);

beforeEach(() => {
  vi.clearAllMocks();
  mockNotion.isConfigured.mockReturnValue(false);
  mockJira.isConfigured.mockReturnValue(false);
  mockNotion.listDeadlines.mockResolvedValue([]);
  mockJira.listDeadlines.mockResolvedValue([]);
});

describe("GET /", () => {
  it("returns notConfigured when neither jira nor notion is configured", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.notConfigured).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("fetches when jira is configured", async () => {
    mockJira.isConfigured.mockReturnValue(true);
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(mockJira.listDeadlines).toHaveBeenCalled();
  });

  it("fetches when notion is configured", async () => {
    mockNotion.isConfigured.mockReturnValue(true);
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(mockNotion.listDeadlines).toHaveBeenCalled();
  });

  it("merges and sorts results by daysUntilDue ascending", async () => {
    mockJira.isConfigured.mockReturnValue(true);
    mockNotion.isConfigured.mockReturnValue(true);
    mockJira.listDeadlines.mockResolvedValue([{ title: "B", daysUntilDue: 5 }]);
    mockNotion.listDeadlines.mockResolvedValue([{ title: "A", daysUntilDue: 2 }]);
    const res = await request(app).get("/");
    expect(res.body.data[0].daysUntilDue).toBe(2);
    expect(res.body.data[1].daysUntilDue).toBe(5);
  });

  it("clamps days to 1 minimum", async () => {
    mockJira.isConfigured.mockReturnValue(true);
    await request(app).get("/?days=0");
    expect(mockJira.listDeadlines).toHaveBeenCalledWith(1);
  });

  it("clamps days to 60 maximum", async () => {
    mockJira.isConfigured.mockReturnValue(true);
    await request(app).get("/?days=999");
    expect(mockJira.listDeadlines).toHaveBeenCalledWith(60);
  });

  it("defaults to 7 days when no query param provided", async () => {
    mockJira.isConfigured.mockReturnValue(true);
    await request(app).get("/");
    expect(mockJira.listDeadlines).toHaveBeenCalledWith(7);
  });

  it("includes partial results when one source rejects (allSettled)", async () => {
    mockJira.isConfigured.mockReturnValue(true);
    mockNotion.isConfigured.mockReturnValue(true);
    mockJira.listDeadlines.mockRejectedValue(new Error("Jira down"));
    mockNotion.listDeadlines.mockResolvedValue([{ title: "N1", daysUntilDue: 3 }]);
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("N1");
  });

  it("returns empty data when all sources reject", async () => {
    mockJira.isConfigured.mockReturnValue(true);
    mockNotion.isConfigured.mockReturnValue(true);
    mockJira.listDeadlines.mockRejectedValue(new Error("down"));
    mockNotion.listDeadlines.mockRejectedValue(new Error("down"));
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
