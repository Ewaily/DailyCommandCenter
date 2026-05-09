import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    settingsPut: vi.fn().mockResolvedValue({}),
    settingsGet: vi.fn(),
  },
}));

vi.mock("../../src/frontend/api.js", () => ({ api: mockApi }));

import { getSetting, saveSetting, hydrateSettingsFromServer } from "../../src/frontend/state.js";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("getSetting", () => {
  it("returns undefined for unknown key", () => {
    expect(getSetting("nonexistent")).toBeUndefined();
  });

  it("returns value previously set with saveSetting", () => {
    saveSetting("myKey", "myValue");
    expect(getSetting("myKey")).toBe("myValue");
  });

  it("returns value hydrated from server", async () => {
    mockApi.settingsGet.mockResolvedValue({ data: { serverKey: "serverVal" } });
    await hydrateSettingsFromServer();
    expect(getSetting("serverKey")).toBe("serverVal");
  });
});

describe("saveSetting", () => {
  it("writes to localStorage", () => {
    saveSetting("color", "blue");
    const stored = JSON.parse(localStorage.getItem("dcc-settings") || "{}");
    expect(stored.color).toBe("blue");
  });

  it("calls api.settingsPut with the key/value pair", () => {
    saveSetting("theme", "dark");
    expect(mockApi.settingsPut).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("does not throw when api.settingsPut rejects", async () => {
    mockApi.settingsPut.mockRejectedValueOnce(new Error("network"));
    expect(() => saveSetting("k", "v")).not.toThrow();
    await Promise.resolve(); // flush microtasks
  });

  it("stores null values correctly", () => {
    saveSetting("pinnedProject", null);
    const stored = JSON.parse(localStorage.getItem("dcc-settings") || "{}");
    expect(stored.pinnedProject).toBeNull();
  });

  it("stores boolean values correctly", () => {
    saveSetting("flag", true);
    const stored = JSON.parse(localStorage.getItem("dcc-settings") || "{}");
    expect(stored.flag).toBe(true);
  });

  it("overwrites previously saved key", () => {
    saveSetting("x", "first");
    saveSetting("x", "second");
    expect(getSetting("x")).toBe("second");
  });
});

describe("hydrateSettingsFromServer", () => {
  it("merges server data over local cache", async () => {
    saveSetting("local", "localVal");
    mockApi.settingsGet.mockResolvedValue({ data: { server: "serverVal" } });
    await hydrateSettingsFromServer();
    expect(getSetting("local")).toBe("localVal");
    expect(getSetting("server")).toBe("serverVal");
  });

  it("server values win over local values on conflict", async () => {
    saveSetting("key", "local");
    mockApi.settingsGet.mockResolvedValue({ data: { key: "server" } });
    await hydrateSettingsFromServer();
    expect(getSetting("key")).toBe("server");
  });

  it("does not throw when api.settingsGet rejects", async () => {
    mockApi.settingsGet.mockRejectedValueOnce(new Error("down"));
    await expect(hydrateSettingsFromServer()).resolves.toBeUndefined();
  });

  it("persists merged data to localStorage", async () => {
    mockApi.settingsGet.mockResolvedValue({ data: { persisted: true } });
    await hydrateSettingsFromServer();
    const stored = JSON.parse(localStorage.getItem("dcc-settings") || "{}");
    expect(stored.persisted).toBe(true);
  });
});
