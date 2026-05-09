import Database from "better-sqlite3";
import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import express from "express";
import request from "supertest";

let testDb: InstanceType<typeof Database>;

vi.mock("../src/server/db.js", () => ({ getDb: () => testDb }));

import { settingsRouter } from "../src/server/routes/settings.js";

const app = express();
app.use(express.json());
app.use(settingsRouter);

function buildDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return db;
}

beforeEach(() => {
  testDb = buildDb();
});

describe("GET /", () => {
  it("returns defaults when settings table is empty", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.data.scheduleFilter).toBe("all");
    expect(res.body.data.todoTab).toBe("today");
    expect(res.body.data.autoRefreshMs).toBe(5 * 60 * 1000);
    expect(res.body.data.pinnedProject).toBeNull();
  });

  it("merges stored values over defaults", async () => {
    testDb.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("scheduleFilter", JSON.stringify("mine"));
    const res = await request(app).get("/");
    expect(res.body.data.scheduleFilter).toBe("mine");
    expect(res.body.data.todoTab).toBe("today"); // default still present
  });

  it("handles non-JSON value gracefully (uses raw string)", async () => {
    testDb.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("foo", "not-json{{{");
    const res = await request(app).get("/");
    expect(res.body.data.foo).toBe("not-json{{{");
  });

  it("returns numeric autoRefreshMs from stored value", async () => {
    testDb.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("autoRefreshMs", JSON.stringify(60_000));
    const res = await request(app).get("/");
    expect(res.body.data.autoRefreshMs).toBe(60_000);
  });
});

describe("PUT /", () => {
  it("stores a key and returns updated data", async () => {
    const res = await request(app).put("/").send({ scheduleFilter: "mine" });
    expect(res.status).toBe(200);
    expect(res.body.data.scheduleFilter).toBe("mine");
  });

  it("upserts an existing key", async () => {
    await request(app).put("/").send({ scheduleFilter: "all" });
    const res = await request(app).put("/").send({ scheduleFilter: "mine" });
    expect(res.body.data.scheduleFilter).toBe("mine");
  });

  it("can store multiple keys in one request", async () => {
    const res = await request(app).put("/").send({ scheduleFilter: "mine", todoTab: "all", autoRefreshMs: 120_000 });
    expect(res.body.data.scheduleFilter).toBe("mine");
    expect(res.body.data.todoTab).toBe("all");
    expect(res.body.data.autoRefreshMs).toBe(120_000);
  });

  it("stores boolean values", async () => {
    const res = await request(app).put("/").send({ someBool: true });
    expect(res.body.data.someBool).toBe(true);
  });

  it("stores null values", async () => {
    const res = await request(app).put("/").send({ pinnedProject: null });
    expect(res.body.data.pinnedProject).toBeNull();
  });

  it("handles empty body without crashing", async () => {
    const res = await request(app).put("/").send({});
    expect(res.status).toBe(200);
  });
});
