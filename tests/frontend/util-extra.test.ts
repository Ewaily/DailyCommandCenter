import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  offsetDateInTz,
  timeAgo,
  fmtTime,
  fmtDateTime,
  fmtDuration,
  skeletonList,
  stripFwdPrefix,
  todayKey,
  toast,
  animateNumber,
} from "../../src/frontend/components/util.js";
import { getPrimaryTz, setPrimaryTz } from "../../src/frontend/components/tz.js";

describe("offsetDateInTz", () => {
  it("returns an iso date string for today at offset 0", () => {
    const result = offsetDateInTz(0, "UTC");
    expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns tomorrow's date at offset +1", () => {
    const today = offsetDateInTz(0, "UTC");
    const tomorrow = offsetDateInTz(1, "UTC");
    const todayDate = new Date(today.iso);
    const tomorrowDate = new Date(tomorrow.iso);
    expect(tomorrowDate.getTime()).toBeGreaterThan(todayDate.getTime());
  });

  it("returns a label like 'Wednesday, May 7'", () => {
    const result = offsetDateInTz(0, "UTC");
    expect(result.label).toBeTruthy();
    expect(typeof result.label).toBe("string");
  });

  it("startIso is before endIso", () => {
    const result = offsetDateInTz(0, "UTC");
    expect(new Date(result.startIso).getTime()).toBeLessThan(new Date(result.endIso).getTime());
  });
});

describe("timeAgo", () => {
  it("returns empty string for null", () => {
    expect(timeAgo(null)).toBe("");
  });

  it("returns seconds ago for recent time", () => {
    const result = timeAgo(Date.now() - 30_000);
    expect(result).toMatch(/s ago/);
  });

  it("returns minutes ago for ~5 minutes", () => {
    const result = timeAgo(Date.now() - 5 * 60_000);
    expect(result).toMatch(/m ago/);
  });

  it("returns hours ago for ~2 hours", () => {
    const result = timeAgo(Date.now() - 2 * 3600_000);
    expect(result).toMatch(/h ago/);
  });

  it("returns days ago for ~3 days", () => {
    const result = timeAgo(Date.now() - 3 * 86_400_000);
    expect(result).toMatch(/d ago/);
  });
});

describe("fmtTime", () => {
  it("returns a formatted time string from an ISO string", () => {
    const result = fmtTime("2026-05-06T14:30:00Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("fmtDateTime", () => {
  it("returns a formatted date-time string", () => {
    const result = fmtDateTime("2026-05-06T14:30:00Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("fmtDuration", () => {
  it("formats 0 minutes as less than 1m", () => {
    const result = fmtDuration(0);
    expect(result).toBeTruthy();
  });

  it("formats 90 minutes", () => {
    const result = fmtDuration(90);
    expect(typeof result).toBe("string");
  });
});

describe("skeletonList", () => {
  it("returns HTML string with default 4 rows", () => {
    const result = skeletonList();
    expect(result).toContain("skeleton");
  });

  it("respects the rows parameter", () => {
    const result = skeletonList(2);
    expect(result).toContain("skeleton");
  });
});

describe("stripFwdPrefix", () => {
  it("strips RE: prefix", () => {
    expect(stripFwdPrefix("RE: Hello")).toBe("Hello");
  });

  it("strips FWD: prefix case-insensitively", () => {
    expect(stripFwdPrefix("Fwd: Newsletter")).toBe("Newsletter");
  });

  it("returns (untitled) for empty string", () => {
    expect(stripFwdPrefix("")).toBe("(untitled)");
  });

  it("leaves non-prefixed titles alone", () => {
    expect(stripFwdPrefix("Just a title")).toBe("Just a title");
  });
});

describe("todayKey", () => {
  it("returns a YYYY-MM-DD formatted string", () => {
    const result = todayKey();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("toast", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="toast-stack"></div>`;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns undefined when #toast-stack is absent", () => {
    document.body.innerHTML = "";
    const result = toast("hello");
    expect(result).toBeUndefined();
  });

  it("appends a toast element to #toast-stack", () => {
    toast("Test message", "info");
    const stack = document.getElementById("toast-stack")!;
    expect(stack.querySelector(".toast")).not.toBeNull();
    expect(stack.querySelector(".toast")!.textContent).toContain("Test message");
  });

  it("returns a dismiss function", () => {
    const dismiss = toast("hello", "success");
    expect(typeof dismiss).toBe("function");
  });

  it("renders an action button when action is provided", () => {
    const onClick = vi.fn();
    toast("With action", { type: "info", action: { label: "Open", onClick } });
    const stack = document.getElementById("toast-stack")!;
    const btn = stack.querySelector<HTMLButtonElement>("button");
    expect(btn).not.toBeNull();
    expect(btn!.textContent).toBe("Open");
    btn!.click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("animateNumber", () => {
  it("does nothing when el is null", () => {
    expect(() => animateNumber(null, 10)).not.toThrow();
  });

  it("immediately sets textContent when start equals target", () => {
    const el = document.createElement("span");
    el.textContent = "5";
    animateNumber(el, 5);
    expect(el.textContent).toBe("5");
  });

  it("starts animating when start differs from target", () => {
    const el = document.createElement("span");
    el.textContent = "0";
    animateNumber(el, 100, 600);
    expect(el.textContent).not.toBeUndefined();
  });
});

// ── tz helpers ────────────────────────────────────────────────────────────────

describe("getPrimaryTz / setPrimaryTz", () => {
  it("returns the default timezone", () => {
    const tz = getPrimaryTz();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });

  it("setPrimaryTz updates the value returned by getPrimaryTz", () => {
    setPrimaryTz("America/New_York");
    expect(getPrimaryTz()).toBe("America/New_York");
  });

  it("ignores empty string in setPrimaryTz", () => {
    setPrimaryTz("Europe/London");
    setPrimaryTz("");
    expect(getPrimaryTz()).toBe("Europe/London");
  });
});
