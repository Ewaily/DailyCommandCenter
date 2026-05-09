import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_BRAND_NAME, applyBrand } from "../../src/frontend/components/brand.js";

beforeEach(() => {
  document.title = "";
  document.body.innerHTML = `
    <h1 id="brand-name"></h1>
    <span id="footer-brand-name"></span>
    <span id="brand-subtitle" hidden></span>
    <span id="brand-subtitle-sep" hidden></span>
  `;
});

describe("DEFAULT_BRAND_NAME", () => {
  it("is 'Daily Command Center'", () => {
    expect(DEFAULT_BRAND_NAME).toBe("Daily Command Center");
  });
});

describe("applyBrand", () => {
  it("sets document.title to the brand name", () => {
    applyBrand({ name: "My App", subtitle: "" });
    expect(document.title).toBe("My App");
  });

  it("sets h1#brand-name text content", () => {
    applyBrand({ name: "My App", subtitle: "" });
    expect(document.getElementById("brand-name")!.textContent).toBe("My App");
  });

  it("sets footer brand name", () => {
    applyBrand({ name: "My App", subtitle: "" });
    expect(document.getElementById("footer-brand-name")!.textContent).toBe("My App");
  });

  it("falls back to DEFAULT_BRAND_NAME when name is empty", () => {
    applyBrand({ name: "", subtitle: "" });
    expect(document.title).toBe(DEFAULT_BRAND_NAME);
  });

  it("falls back to DEFAULT_BRAND_NAME when name is whitespace", () => {
    applyBrand({ name: "   ", subtitle: "" });
    expect(document.title).toBe(DEFAULT_BRAND_NAME);
  });

  it("falls back to DEFAULT_BRAND_NAME when brand is null", () => {
    applyBrand(null as any);
    expect(document.title).toBe(DEFAULT_BRAND_NAME);
  });

  it("shows subtitle when provided", () => {
    applyBrand({ name: "App", subtitle: "Subtitle text" });
    const subEl = document.getElementById("brand-subtitle")!;
    const sepEl = document.getElementById("brand-subtitle-sep")!;
    expect(subEl.textContent).toBe("Subtitle text");
    expect(subEl.hidden).toBe(false);
    expect(sepEl.hidden).toBe(false);
  });

  it("hides subtitle when empty", () => {
    applyBrand({ name: "App", subtitle: "" });
    const subEl = document.getElementById("brand-subtitle")!;
    const sepEl = document.getElementById("brand-subtitle-sep")!;
    expect(subEl.hidden).toBe(true);
    expect(sepEl.hidden).toBe(true);
  });

  it("does not throw when brand-name element is absent", () => {
    document.body.innerHTML = "";
    expect(() => applyBrand({ name: "X", subtitle: "" })).not.toThrow();
  });
});
