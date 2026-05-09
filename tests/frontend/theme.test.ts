import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSaveSetting, mockGetSetting, mockToast } = vi.hoisted(() => ({
  mockSaveSetting: vi.fn(),
  mockGetSetting:  vi.fn().mockReturnValue(undefined),
  mockToast:       vi.fn(),
}));

vi.mock("../../src/frontend/state.js", () => ({
  saveSetting: (...a: any[]) => mockSaveSetting(...a),
  getSetting:  (...a: any[]) => mockGetSetting(...a),
}));

vi.mock("../../src/frontend/components/util.js", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

vi.mock("../../src/frontend/components/icons.js", () => ({
  icons: { sun: "<svg>sun</svg>", moon: "<svg>moon</svg>" },
}));

import { applyTheme, initTheme, toggleTheme } from "../../src/frontend/components/theme.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSetting.mockReturnValue(undefined);
  document.documentElement.removeAttribute("data-theme");
  document.body.innerHTML = "";
});

describe("applyTheme", () => {
  it("sets data-theme attribute on documentElement", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("sets data-theme to light", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("updates theme button innerHTML for dark theme", () => {
    document.body.innerHTML = '<button id="theme-btn"></button>';
    applyTheme("dark");
    const btn = document.getElementById("theme-btn")!;
    expect(btn.innerHTML).toContain("sun");
  });

  it("updates theme button innerHTML for light theme", () => {
    document.body.innerHTML = '<button id="theme-btn"></button>';
    applyTheme("light");
    const btn = document.getElementById("theme-btn")!;
    expect(btn.innerHTML).toContain("moon");
  });

  it("sets aria-label on theme button for dark mode", () => {
    document.body.innerHTML = '<button id="theme-btn"></button>';
    applyTheme("dark");
    const btn = document.getElementById("theme-btn")!;
    expect(btn.getAttribute("aria-label")).toContain("light");
  });

  it("sets aria-label on theme button for light mode", () => {
    document.body.innerHTML = '<button id="theme-btn"></button>';
    applyTheme("light");
    const btn = document.getElementById("theme-btn")!;
    expect(btn.getAttribute("aria-label")).toContain("dark");
  });

  it("saves setting", () => {
    applyTheme("dark");
    expect(mockSaveSetting).toHaveBeenCalledWith("theme", "dark");
  });

  it("does not throw when theme-btn is absent", () => {
    expect(() => applyTheme("light")).not.toThrow();
  });
});

describe("initTheme", () => {
  it("calls applyTheme with current theme from data-theme attribute", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    initTheme();
    expect(mockSaveSetting).toHaveBeenCalledWith("theme", "dark");
  });

  it("defaults to light when no data-theme attribute", () => {
    initTheme();
    expect(mockSaveSetting).toHaveBeenCalledWith("theme", "light");
  });

  it("registers matchMedia listener when no saved preference", () => {
    const mockMq = { addEventListener: vi.fn() };
    vi.spyOn(window, "matchMedia").mockReturnValue(mockMq as any);
    mockGetSetting.mockReturnValue(undefined);
    initTheme();
    expect(mockMq.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("does not register matchMedia listener when preference is set", () => {
    const mockMq = { addEventListener: vi.fn() };
    vi.spyOn(window, "matchMedia").mockReturnValue(mockMq as any);
    mockGetSetting.mockReturnValue("dark");
    initTheme();
    expect(mockMq.addEventListener).not.toHaveBeenCalled();
  });
});

describe("toggleTheme", () => {
  it("switches from light to dark", () => {
    document.documentElement.setAttribute("data-theme", "light");
    toggleTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("switches from dark to light", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    toggleTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("calls toast with mode name", () => {
    document.documentElement.setAttribute("data-theme", "light");
    toggleTheme();
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Dark"), "info");
  });
});
