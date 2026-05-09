import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/frontend/components/util.js", () => ({
  escapeHtml: (s: string) => s,
}));

import {
  domainFromUrl,
  clearbitLogoUrl,
  googleFaviconUrl,
  buildLogoCandidates,
  initialsFor,
  monogramDataUrl,
  renderWorkspaceBadge,
  renderWorkspaceCluster,
} from "../../src/frontend/components/workspace-logo.js";

// ── domainFromUrl ─────────────────────────────────────────────────────────────

describe("domainFromUrl", () => {
  it("returns null for null/undefined/empty", () => {
    expect(domainFromUrl(null)).toBeNull();
    expect(domainFromUrl(undefined)).toBeNull();
    expect(domainFromUrl("")).toBeNull();
    expect(domainFromUrl("   ")).toBeNull();
  });

  it("strips www prefix", () => {
    expect(domainFromUrl("https://www.example.com")).toBe("example.com");
  });

  it("adds https when no protocol given", () => {
    expect(domainFromUrl("example.com")).toBe("example.com");
  });

  it("parses full URL including path", () => {
    expect(domainFromUrl("https://app.example.com/path/to/thing")).toBe("app.example.com");
  });

  it("lowercases the domain", () => {
    expect(domainFromUrl("HTTPS://Example.COM")).toBe("example.com");
  });

  it("returns null for invalid URL", () => {
    expect(domainFromUrl("not a url at all!!!")).toBeNull();
  });
});

// ── clearbitLogoUrl ───────────────────────────────────────────────────────────

describe("clearbitLogoUrl", () => {
  it("returns clearbit URL with domain", () => {
    const url = clearbitLogoUrl("example.com");
    expect(url).toContain("logo.clearbit.com");
    expect(url).toContain("example.com");
  });

  it("includes default size 128", () => {
    expect(clearbitLogoUrl("x.com")).toContain("size=128");
  });

  it("uses custom size when provided", () => {
    expect(clearbitLogoUrl("x.com", 64)).toContain("size=64");
  });
});

// ── googleFaviconUrl ──────────────────────────────────────────────────────────

describe("googleFaviconUrl", () => {
  it("returns google favicon URL", () => {
    const url = googleFaviconUrl("example.com");
    expect(url).toContain("google.com/s2/favicons");
    expect(url).toContain("example.com");
  });

  it("includes default size 128", () => {
    expect(googleFaviconUrl("x.com")).toContain("sz=128");
  });

  it("uses custom size", () => {
    expect(googleFaviconUrl("x.com", 32)).toContain("sz=32");
  });
});

// ── buildLogoCandidates ───────────────────────────────────────────────────────

describe("buildLogoCandidates", () => {
  it("returns empty array for falsy input", () => {
    expect(buildLogoCandidates(null)).toEqual([]);
    expect(buildLogoCandidates(undefined)).toEqual([]);
    expect(buildLogoCandidates("")).toEqual([]);
  });

  it("returns direct URL verbatim when it looks like an image URL", () => {
    const candidates = buildLogoCandidates("https://example.com/logo.png");
    expect(candidates).toEqual(["https://example.com/logo.png"]);
  });

  it("returns svg image URL verbatim", () => {
    const candidates = buildLogoCandidates("https://example.com/logo.svg");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toContain("logo.svg");
  });

  it("returns clearbit + google for a plain domain", () => {
    const candidates = buildLogoCandidates("example.com");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toContain("clearbit.com");
    expect(candidates[1]).toContain("google.com");
  });

  it("returns clearbit + google for a website URL", () => {
    const candidates = buildLogoCandidates("https://example.com");
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toContain("clearbit.com");
  });

  it("returns empty for invalid domain", () => {
    expect(buildLogoCandidates("not a url")).toEqual([]);
  });
});

// ── initialsFor ───────────────────────────────────────────────────────────────

describe("initialsFor", () => {
  it("returns ? for empty string", () => {
    expect(initialsFor("")).toBe("?");
  });

  it("returns first 2 chars uppercased for single word", () => {
    expect(initialsFor("Acme")).toBe("AC");
  });

  it("returns single char uppercased for 1-char word", () => {
    expect(initialsFor("A")).toBe("A");
  });

  it("returns first+last initials for two words", () => {
    expect(initialsFor("Acme Corp")).toBe("AC");
  });

  it("returns first+last initials for multiple words", () => {
    expect(initialsFor("Daily Command Center")).toBe("DC");
  });

  it("trims whitespace before splitting", () => {
    expect(initialsFor("  Hello  World  ")).toBe("HW");
  });
});

// ── monogramDataUrl ───────────────────────────────────────────────────────────

describe("monogramDataUrl", () => {
  it("returns a data URL string", () => {
    const url = monogramDataUrl("Acme Corp", "#2A9D8F");
    expect(url).toMatch(/^data:image\/svg\+xml;utf8,/);
  });

  it("includes the initials in the SVG", () => {
    const url = monogramDataUrl("Acme Corp", "#2A9D8F");
    expect(decodeURIComponent(url)).toContain("AC");
  });

  it("uses default color for invalid hex", () => {
    const url = monogramDataUrl("Test", "notacolor");
    expect(decodeURIComponent(url)).toContain("#0E4C5B");
  });

  it("uses default color for null", () => {
    const url = monogramDataUrl("Test", null);
    expect(decodeURIComponent(url)).toContain("#0E4C5B");
  });

  it("uses provided valid hex color", () => {
    const url = monogramDataUrl("Test", "#FF0000");
    expect(decodeURIComponent(url)).toContain("#FF0000");
  });

  it("respects custom size", () => {
    const url = monogramDataUrl("Test", null, 64);
    expect(decodeURIComponent(url)).toContain('width="64"');
    expect(decodeURIComponent(url)).toContain('height="64"');
  });
});

// ── renderWorkspaceBadge ──────────────────────────────────────────────────────

describe("renderWorkspaceBadge", () => {
  const ws = { name: "Acme", color: "#2A9D8F", logoUrl: null, website: "acme.com", icon: "🏢" };

  it("renders a span.ws-logo element", () => {
    const html = renderWorkspaceBadge(ws);
    expect(html).toContain("ws-logo");
    expect(html).toContain("<img");
  });

  it("includes title by default", () => {
    const html = renderWorkspaceBadge(ws);
    expect(html).toContain('title="Acme"');
  });

  it("omits title when opts.title is false", () => {
    const html = renderWorkspaceBadge(ws, 24, { title: false });
    expect(html).not.toContain('title="Acme"');
  });

  it("uses logoUrl as first candidate when present", () => {
    const wsWithLogo = { ...ws, logoUrl: "https://acme.com/logo.png" };
    const html = renderWorkspaceBadge(wsWithLogo);
    expect(html).toContain("acme.com/logo.png");
  });

  it("renders monogram data URL when no website or logoUrl", () => {
    const wsNoLogo = { ...ws, website: null, logoUrl: null };
    const html = renderWorkspaceBadge(wsNoLogo);
    expect(html).toContain("data:image/svg+xml");
  });

  it("uses provided size in CSS custom property", () => {
    const html = renderWorkspaceBadge(ws, 48);
    expect(html).toContain("--ws-size:48px");
  });
});

// ── renderWorkspaceCluster ────────────────────────────────────────────────────

describe("renderWorkspaceCluster", () => {
  const ws1 = { name: "Alpha", color: "#111", logoUrl: null, website: null, icon: "🏢" };
  const ws2 = { name: "Beta",  color: "#222", logoUrl: null, website: null, icon: "🏭" };
  const ws3 = { name: "Gamma", color: "#333", logoUrl: null, website: null, icon: "🏗" };
  const ws4 = { name: "Delta", color: "#444", logoUrl: null, website: null, icon: "🏛" };
  const ws5 = { name: "Epsilon", color: "#555", logoUrl: null, website: null, icon: "🏟" };

  it("returns empty string for empty list", () => {
    expect(renderWorkspaceCluster([])).toBe("");
  });

  it("renders single badge in cluster", () => {
    const html = renderWorkspaceCluster([ws1]);
    expect(html).toContain("ws-logo-cluster");
    expect(html).toContain("Alpha");
  });

  it("renders multiple badges", () => {
    const html = renderWorkspaceCluster([ws1, ws2]);
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
  });

  it("shows overflow chip when list exceeds max", () => {
    const html = renderWorkspaceCluster([ws1, ws2, ws3, ws4, ws5], 18, 4);
    expect(html).toContain("+1");
  });

  it("does not show overflow chip when list equals max", () => {
    const html = renderWorkspaceCluster([ws1, ws2, ws3, ws4], 18, 4);
    expect(html).not.toContain("ws-logo-more");
  });
});
