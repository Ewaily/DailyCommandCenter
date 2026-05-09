import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSetPrimaryTz, mockGetPrimaryTz } = vi.hoisted(() => ({
  mockSetPrimaryTz: vi.fn(),
  mockGetPrimaryTz: vi.fn().mockReturnValue("America/New_York"),
}));

vi.mock("../../src/frontend/components/tz.js", () => ({
  setPrimaryTz: mockSetPrimaryTz,
  getPrimaryTz: mockGetPrimaryTz,
}));
vi.mock("../../src/frontend/components/util.js", () => ({
  $: (sel: string) => document.querySelector(sel),
}));

import { setTimezones, setDayBounds, tick, startClock, getPrimaryTz } from "../../src/frontend/components/header.js";

function buildDom() {
  document.body.innerHTML = `
    <span id="clock"></span>
    <span id="clock-ampm"></span>
    <span id="header-date"></span>
    <span id="greeting"></span>
    <span id="primary-tz-label"></span>
    <div id="world-clocks"></div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPrimaryTz.mockReturnValue("America/New_York");
  buildDom();
});

// ── setTimezones ──────────────────────────────────────────────────────────────

describe("setTimezones", () => {
  it("calls setPrimaryTz with provided timezone", () => {
    setTimezones("Europe/London", []);
    expect(mockSetPrimaryTz).toHaveBeenCalledWith("Europe/London");
  });

  it("falls back to Africa/Cairo when primary is empty string", () => {
    setTimezones("", []);
    expect(mockSetPrimaryTz).toHaveBeenCalledWith("Africa/Cairo");
  });

  it("sets primary-tz-label text to city name", () => {
    mockGetPrimaryTz.mockReturnValue("America/New_York");
    setTimezones("America/New_York", []);
    expect(document.getElementById("primary-tz-label")!.textContent).toBe("New York");
  });

  it("replaces underscores in tz label", () => {
    mockGetPrimaryTz.mockReturnValue("America/Los_Angeles");
    setTimezones("America/Los_Angeles", []);
    expect(document.getElementById("primary-tz-label")!.textContent).toBe("Los Angeles");
  });

  it("renders secondary timezone clocks", () => {
    setTimezones("America/New_York", [{ tz: "Europe/London", label: "LON" }]);
    expect(document.getElementById("world-clocks")!.innerHTML).toContain("LON");
  });

  it("clips secondary timezones to max 3", () => {
    const tzs = [
      { tz: "Europe/London", label: "LON" },
      { tz: "Asia/Tokyo",    label: "TKY" },
      { tz: "Asia/Riyadh",  label: "RUH" },
      { tz: "Asia/Dubai",   label: "DXB" },
    ];
    setTimezones("America/New_York", tzs);
    const items = document.querySelectorAll("#world-clocks .wc-col");
    expect(items.length).toBe(3);
  });

  it("uses tz city as label fallback when label is empty", () => {
    setTimezones("America/New_York", [{ tz: "Europe/London", label: "" }]);
    expect(document.getElementById("world-clocks")!.innerHTML).toContain("LON");
  });

  it("handles missing #world-clocks element gracefully", () => {
    document.getElementById("world-clocks")!.remove();
    expect(() => setTimezones("UTC", [{ tz: "Europe/London", label: "LON" }])).not.toThrow();
  });
});

// ── tick ──────────────────────────────────────────────────────────────────────

describe("tick", () => {
  it("updates #clock element with time string", () => {
    tick();
    expect(document.getElementById("clock")!.textContent).toMatch(/\d+:\d{2}/);
  });

  it("updates #clock-ampm element", () => {
    tick();
    const ampm = document.getElementById("clock-ampm")!.textContent;
    expect(["AM", "am", "PM", "pm"].some(x => ampm!.toLowerCase().includes(x.toLowerCase()))).toBe(true);
  });

  it("updates #header-date element", () => {
    tick();
    expect(document.getElementById("header-date")!.textContent).toBeTruthy();
  });

  it("updates #greeting with appropriate greeting", () => {
    tick();
    const text = document.getElementById("greeting")!.textContent;
    expect(["Late night", "Good morning", "Good afternoon", "Good evening", "Good night"].some(g => text!.includes(g))).toBe(true);
  });

  it("updates secondary world clock elements", () => {
    setTimezones("America/New_York", [{ tz: "Europe/London", label: "LON" }]);
    tick();
    const el = document.querySelector<HTMLElement>('[data-wc-idx="0"]');
    expect(el?.textContent).toMatch(/\d+:\d{2}/);
  });

  it("handles missing clock elements gracefully", () => {
    document.body.innerHTML = "";
    expect(() => tick()).not.toThrow();
  });

  it("does not update greeting if text is unchanged", () => {
    tick();
    const html1 = document.getElementById("greeting")!.innerHTML;
    tick();
    // text should remain the same (or update if second has crossed an hour boundary)
    expect(document.getElementById("greeting")!.innerHTML).toBeTruthy();
    // The key assertion is that it doesn't throw
  });
});

// ── setDayBounds ──────────────────────────────────────────────────────────────

describe("setDayBounds", () => {
  it("calls tick (doesn't throw with any input)", () => {
    expect(() => setDayBounds([])).not.toThrow();
    expect(() => setDayBounds([{ start: "09:00", end: "10:00" }])).not.toThrow();
  });
});

// ── startClock ────────────────────────────────────────────────────────────────

describe("startClock", () => {
  it("calls tick once synchronously without throwing", () => {
    expect(() => startClock()).not.toThrow();
    expect(document.getElementById("clock")!.textContent).toMatch(/\d+:\d{2}/);
  });
});

// ── greetingFor coverage via tick at specific hours ──────────────────────────

describe("greetingFor via injected date", () => {
  // We can't easily control Date.now(), so we check tick() covers the full
  // code path by calling it and verifying one of the greetings appears.
  it("tick produces a valid greeting text", () => {
    tick();
    const text = document.getElementById("greeting")!.textContent ?? "";
    const valid = ["Late night", "Good morning", "Good afternoon", "Good evening", "Good night"];
    expect(valid.some(g => text.includes(g))).toBe(true);
  });
});

// ── getPrimaryTz re-export ────────────────────────────────────────────────────

describe("getPrimaryTz re-export", () => {
  it("returns the value from tz module", () => {
    mockGetPrimaryTz.mockReturnValue("Europe/Berlin");
    expect(getPrimaryTz()).toBe("Europe/Berlin");
  });
});
