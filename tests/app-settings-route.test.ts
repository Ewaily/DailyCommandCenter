import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

let testDb: InstanceType<typeof Database>;

vi.mock("../src/server/db.js", () => ({ getDb: () => testDb }));
vi.mock("../src/server/config.js", () => ({
  config: {
    google:    { clientId: "", clientSecret: "", redirectUri: "" },
    slack:     { clientId: "", clientSecret: "", redirectUri: "" },
    microsoft: { clientId: "", clientSecret: "", redirectUri: "", tenantId: "" },
  },
}));

import { appSettingsRouter, DEFAULT_BRAND_NAME, DEFAULT_PRIMARY_TZ } from "../src/server/routes/app-settings.js";

const app = express();
app.use(express.json());
app.use(appSettingsRouter);

function buildDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return db;
}

beforeEach(() => { testDb = buildDb(); });

describe("GET /", () => {
  it("returns default brand name when nothing is stored", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.data.brand.name).toBe(DEFAULT_BRAND_NAME);
    expect(res.body.data.brand.subtitle).toBe("");
  });

  it("returns default primaryTz", async () => {
    const res = await request(app).get("/");
    expect(res.body.data.prefs.primaryTz).toBe(DEFAULT_PRIMARY_TZ);
  });

  it("returns stored brand name over default", async () => {
    testDb.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("app.brand.name", JSON.stringify("MyDash"));
    const res = await request(app).get("/");
    expect(res.body.data.brand.name).toBe("MyDash");
  });

  it("returns null for google clientId when not configured", async () => {
    const res = await request(app).get("/");
    expect(res.body.data.google.clientId).toBeNull();
    expect(res.body.data.google.hasSecret).toBe(false);
  });
});

describe("PUT /", () => {
  it("updates brand.name and returns it", async () => {
    const res = await request(app).put("/").send({ "brand.name": "NewName" });
    expect(res.status).toBe(200);
    expect(res.body.data.brand.name).toBe("NewName");
  });

  it("allows brand.name to be cleared to empty string (stored as-is)", async () => {
    await request(app).put("/").send({ "brand.name": "Something" });
    const res = await request(app).put("/").send({ "brand.name": "" });
    expect(res.body.data.brand.name).toBe(""); // brand keys may be cleared
  });

  it("ignores keys not in ALLOWED_KEYS", async () => {
    const res = await request(app).put("/").send({ "evil.key": "bad", "brand.name": "Ok" });
    expect(res.body.data.brand.name).toBe("Ok");
    const row = testDb.prepare("SELECT value FROM settings WHERE key = ?").get("app.evil.key");
    expect(row).toBeUndefined();
  });

  it("accepts valid prefs.primaryTz", async () => {
    const res = await request(app).put("/").send({ "prefs.primaryTz": "America/New_York" });
    expect(res.body.data.prefs.primaryTz).toBe("America/New_York");
  });

  it("rejects invalid prefs.primaryTz (keeps old value)", async () => {
    await request(app).put("/").send({ "prefs.primaryTz": "America/New_York" });
    await request(app).put("/").send({ "prefs.primaryTz": "NotAReal/Timezone" });
    const res = await request(app).get("/");
    expect(res.body.data.prefs.primaryTz).toBe("America/New_York");
  });

  it("accepts valid prefs.secondaryTzs array", async () => {
    const tzs = [{ tz: "Europe/London", label: "LON" }, { tz: "Asia/Tokyo", label: "TKY" }];
    const res = await request(app).put("/").send({ "prefs.secondaryTzs": tzs });
    expect(res.body.data.prefs.secondaryTzs).toHaveLength(2);
    expect(res.body.data.prefs.secondaryTzs[0].tz).toBe("Europe/London");
  });

  it("clamps prefs.secondaryTzs to max 3 items", async () => {
    const tzs = [
      { tz: "Europe/London", label: "A" },
      { tz: "Asia/Tokyo",    label: "B" },
      { tz: "America/New_York", label: "C" },
      { tz: "America/Chicago",  label: "D" },
    ];
    const res = await request(app).put("/").send({ "prefs.secondaryTzs": tzs });
    expect(res.body.data.prefs.secondaryTzs).toHaveLength(3);
  });

  it("filters invalid tz entries from secondaryTzs", async () => {
    const tzs = [{ tz: "INVALID", label: "X" }, { tz: "Europe/London", label: "LON" }];
    const res = await request(app).put("/").send({ "prefs.secondaryTzs": tzs });
    expect(res.body.data.prefs.secondaryTzs).toHaveLength(1);
    expect(res.body.data.prefs.secondaryTzs[0].tz).toBe("Europe/London");
  });

  it("ignores prefs.secondaryTzs when not an array", async () => {
    const res = await request(app).put("/").send({ "prefs.secondaryTzs": "bad" });
    expect(res.status).toBe(200); // no crash; key is just skipped
  });

  it("stores google.clientId", async () => {
    const res = await request(app).put("/").send({ "google.clientId": "gcid-123" });
    expect(res.body.data.google.clientId).toBe("gcid-123");
  });

  it("skips non-string values for non-tz keys", async () => {
    const before = await request(app).get("/");
    await request(app).put("/").send({ "brand.name": 42 });
    const after = await request(app).get("/");
    expect(after.body.data.brand.name).toBe(before.body.data.brand.name);
  });

  it("skips empty string for secret/id keys (not brand)", async () => {
    await request(app).put("/").send({ "google.clientId": "existing" });
    const res = await request(app).put("/").send({ "google.clientId": "" });
    expect(res.body.data.google.clientId).toBe("existing");
  });

  it("generates label from tz city when label is empty", async () => {
    const tzs = [{ tz: "America/New_York", label: "" }];
    const res = await request(app).put("/").send({ "prefs.secondaryTzs": tzs });
    const saved = res.body.data.prefs.secondaryTzs[0];
    expect(saved.label).toBeTruthy();
    expect(saved.label.length).toBeGreaterThan(0);
  });
});
