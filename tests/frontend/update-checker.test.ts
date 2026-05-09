import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  APP_VERSION,
  parseSemver,
  isNewerVersion,
  checkForUpdates,
} from "../../src/frontend/update-checker.js";

// ── parseSemver ───────────────────────────────────────────────────────────────

describe("parseSemver", () => {
  it("parses a plain semver string", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
  });

  it("strips a leading v", () => {
    expect(parseSemver("v2.10.5")).toEqual([2, 10, 5]);
  });

  it("returns [0,0,0] for an unparseable string", () => {
    expect(parseSemver("not-a-version")).toEqual([0, 0, 0]);
  });

  it("returns [0,0,0] for an empty string", () => {
    expect(parseSemver("")).toEqual([0, 0, 0]);
  });

  it("ignores pre-release suffixes", () => {
    const [maj, min, pat] = parseSemver("v3.0.0-beta.1");
    expect(maj).toBe(3);
    expect(min).toBe(0);
    expect(pat).toBe(0);
  });
});

// ── isNewerVersion ────────────────────────────────────────────────────────────

describe("isNewerVersion", () => {
  it("returns true when major is bumped", () => {
    expect(isNewerVersion("v1.0.0", "v2.0.0")).toBe(true);
  });

  it("returns true when minor is bumped", () => {
    expect(isNewerVersion("v1.0.0", "v1.1.0")).toBe(true);
  });

  it("returns true when patch is bumped", () => {
    expect(isNewerVersion("v1.0.0", "v1.0.1")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(isNewerVersion("v1.0.0", "v1.0.0")).toBe(false);
  });

  it("returns false when candidate major is lower", () => {
    expect(isNewerVersion("v2.0.0", "v1.9.9")).toBe(false);
  });

  it("returns false when candidate minor is lower", () => {
    expect(isNewerVersion("v1.5.0", "v1.4.9")).toBe(false);
  });

  it("returns false when candidate patch is lower", () => {
    expect(isNewerVersion("v1.0.2", "v1.0.1")).toBe(false);
  });

  it("handles versions without leading v", () => {
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  });

  it("APP_VERSION is not newer than itself", () => {
    expect(isNewerVersion(APP_VERSION, APP_VERSION)).toBe(false);
  });
});

// ── checkForUpdates ───────────────────────────────────────────────────────────

describe("checkForUpdates", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="toast-stack"></div>`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function mockFetch(response: { ok: boolean; body?: object }) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: response.ok,
      json: async () => response.body ?? {},
    }));
  }

  it("appends an update toast to #toast-stack when a newer release exists", async () => {
    mockFetch({ ok: true, body: { tag_name: "v99.0.0" } });
    await checkForUpdates();

    const toast = document.getElementById("toast-stack")!.querySelector(".toast");
    expect(toast).not.toBeNull();
    expect(toast!.textContent).toContain("v99.0.0");
  });

  it("toast action button opens the releases page", async () => {
    mockFetch({ ok: true, body: { tag_name: "v99.0.0" } });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    await checkForUpdates();

    const btn = document.getElementById("toast-stack")!.querySelector<HTMLButtonElement>("button");
    expect(btn).not.toBeNull();
    btn!.click();
    expect(openSpy).toHaveBeenCalledWith(
      "https://github.com/Ewaily/DailyCommandCenter/releases/latest",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows no toast when already on the latest version", async () => {
    mockFetch({ ok: true, body: { tag_name: APP_VERSION } });
    await checkForUpdates();

    expect(document.getElementById("toast-stack")!.querySelector(".toast")).toBeNull();
  });

  it("shows no toast when the release tag is older than current", async () => {
    mockFetch({ ok: true, body: { tag_name: "v0.0.1" } });
    await checkForUpdates();

    expect(document.getElementById("toast-stack")!.querySelector(".toast")).toBeNull();
  });

  it("fails silently on 404 (no releases published yet)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(document.getElementById("toast-stack")!.querySelector(".toast")).toBeNull();
  });

  it("fails silently on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(document.getElementById("toast-stack")!.querySelector(".toast")).toBeNull();
  });

  it("fails silently when tag_name is absent from response", async () => {
    mockFetch({ ok: true, body: { name: "Some release without tag_name" } });
    await expect(checkForUpdates()).resolves.toBeUndefined();
    expect(document.getElementById("toast-stack")!.querySelector(".toast")).toBeNull();
  });
});
