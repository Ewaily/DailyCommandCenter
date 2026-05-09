import { describe, it, expect, beforeEach } from "vitest";
import { icons, paintIcons, startIconAutoPaint } from "../../src/frontend/components/icons.js";

describe("icons object", () => {
  it("contains expected icon keys", () => {
    expect(typeof icons.refresh).toBe("string");
    expect(typeof icons.moon).toBe("string");
    expect(typeof icons.sun).toBe("string");
    expect(typeof icons.settings).toBe("string");
    expect(typeof icons.trash).toBe("string");
    expect(typeof icons.check).toBe("string");
  });

  it("icons are SVG strings", () => {
    expect(icons.refresh).toContain("<svg");
    expect(icons.refresh).toContain("</svg>");
  });

  it("icons have aria-hidden", () => {
    expect(icons.moon).toContain('aria-hidden="true"');
  });
});

describe("paintIcons", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("replaces data-icon elements with SVG content", () => {
    document.body.innerHTML = '<span data-icon="refresh"></span>';
    paintIcons();
    const el = document.body.querySelector("[data-icon='refresh']")!;
    expect(el.innerHTML).toContain("<svg");
  });

  it("marks element as painted", () => {
    document.body.innerHTML = '<span data-icon="check"></span>';
    paintIcons();
    const el = document.body.querySelector("[data-icon='check']") as HTMLElement;
    expect(el.dataset.iconPainted).toBe("check");
  });

  it("skips unknown icon names", () => {
    document.body.innerHTML = '<span data-icon="nonexistent"></span>';
    paintIcons();
    const el = document.body.querySelector("[data-icon='nonexistent']") as HTMLElement;
    expect(el.innerHTML).toBe("");
  });

  it("skips already-painted icons", () => {
    document.body.innerHTML = '<span data-icon="check" data-icon-painted="check">already painted</span>';
    paintIcons();
    const el = document.body.querySelector("[data-icon='check']") as HTMLElement;
    expect(el.innerHTML).toBe("already painted");
  });

  it("paints within a provided root element", () => {
    const div = document.createElement("div");
    div.innerHTML = '<span data-icon="plus"></span>';
    document.body.appendChild(div);
    paintIcons(div);
    expect(div.querySelector("[data-icon='plus']")!.innerHTML).toContain("<svg");
  });

  it("paints multiple icons in one pass", () => {
    document.body.innerHTML = '<span data-icon="moon"></span><span data-icon="sun"></span>';
    paintIcons();
    const all = document.body.querySelectorAll("[data-icon]");
    all.forEach(el => expect(el.innerHTML).toContain("<svg"));
  });
});

describe("startIconAutoPaint", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("paints existing icons on call", () => {
    document.body.innerHTML = '<span data-icon="bell"></span>';
    startIconAutoPaint();
    expect(document.body.querySelector("[data-icon='bell']")!.innerHTML).toContain("<svg");
  });

  it("does not throw", () => {
    expect(() => startIconAutoPaint()).not.toThrow();
  });
});
