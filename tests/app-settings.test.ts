import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDbStmt, mockDb } = vi.hoisted(() => {
  const dbStmt = { get: vi.fn().mockReturnValue(null), run: vi.fn() };
  const db = {
    prepare: vi.fn().mockReturnValue(dbStmt),
    transaction: vi.fn().mockImplementation((fn) => fn),
  };
  return { mockDbStmt: dbStmt, mockDb: db };
});

vi.mock("../src/server/db.js", () => ({ getDb: () => mockDb }));

import {
  getAppSetting,
  setAppSetting,
  getAppSettings,
  setAppSettings,
  getAppSettingJSON,
} from "../src/server/lib/app-settings.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockDbStmt.get.mockReturnValue(null);
  mockDb.prepare.mockReturnValue(mockDbStmt);
  mockDb.transaction.mockImplementation((fn: any) => fn);
});

describe("getAppSetting", () => {
  it("returns envFallback when no row in DB", () => {
    mockDbStmt.get.mockReturnValue(null);
    expect(getAppSetting("brand.name", "DCC")).toBe("DCC");
  });

  it("returns parsed JSON value when row has value", () => {
    mockDbStmt.get.mockReturnValue({ value: '"My App"' });
    expect(getAppSetting("brand.name")).toBe("My App");
  });

  it("returns raw value when JSON parse fails", () => {
    mockDbStmt.get.mockReturnValue({ value: "not-json{" });
    expect(getAppSetting("brand.name")).toBe("not-json{");
  });

  it("returns envFallback when row value is empty string", () => {
    mockDbStmt.get.mockReturnValue({ value: "" });
    expect(getAppSetting("brand.name", "fallback")).toBe("fallback");
  });

  it("queries with app. prefix", () => {
    getAppSetting("brand.name");
    expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT"));
    expect(mockDbStmt.get).toHaveBeenCalledWith("app.brand.name");
  });
});

describe("setAppSetting", () => {
  it("calls run with prefixed key and JSON-encoded value", () => {
    setAppSetting("brand.name", "My Dashboard");
    expect(mockDbStmt.run).toHaveBeenCalledWith("app.brand.name", '"My Dashboard"');
  });
});

describe("getAppSettings", () => {
  it("returns a record with all requested keys", () => {
    mockDbStmt.get.mockReturnValue(null);
    const result = getAppSettings(["a", "b"]);
    expect(Object.keys(result)).toEqual(["a", "b"]);
  });

  it("populates values from DB", () => {
    mockDbStmt.get.mockReturnValue({ value: '"hello"' });
    const result = getAppSettings(["x"]);
    expect(result.x).toBe("hello");
  });
});

describe("setAppSettings", () => {
  it("calls run for each non-null key-value pair", () => {
    const txFn = vi.fn();
    mockDb.transaction.mockReturnValue(txFn);
    setAppSettings({ "a": "1", "b": "2" });
    expect(mockDb.transaction).toHaveBeenCalled();
    expect(txFn).toHaveBeenCalled();
  });

  it("skips null values", () => {
    const txFn = vi.fn();
    mockDb.transaction.mockReturnValue(txFn);
    setAppSettings({ "a": null as any, "b": "2" });
    expect(txFn).toHaveBeenCalled();
  });
});

describe("getAppSettingJSON", () => {
  it("returns fallback when no row", () => {
    mockDbStmt.get.mockReturnValue(null);
    expect(getAppSettingJSON("features", { x: 1 })).toEqual({ x: 1 });
  });

  it("returns parsed JSON", () => {
    mockDbStmt.get.mockReturnValue({ value: '{"x":42}' });
    expect(getAppSettingJSON("features", {})).toEqual({ x: 42 });
  });

  it("returns fallback when JSON parse fails", () => {
    mockDbStmt.get.mockReturnValue({ value: "{{bad" });
    expect(getAppSettingJSON("features", { default: true })).toEqual({ default: true });
  });

  it("returns fallback when parsed value is null", () => {
    mockDbStmt.get.mockReturnValue({ value: "null" });
    expect(getAppSettingJSON("features", { def: 1 })).toEqual({ def: 1 });
  });
});
