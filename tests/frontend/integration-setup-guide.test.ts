import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/frontend/components/util", () => ({
  escapeHtml: (s: string) => s,
}));

import { renderSetupGuide, mdToHtml } from "../../src/frontend/components/integration-setup-guide.js";

// ── renderSetupGuide ──────────────────────────────────────────────────────────

describe("renderSetupGuide", () => {
  it("wraps in a details element with setup-guide class", () => {
    const html = renderSetupGuide({ key: "google", title: "Google Calendar", markdown: "" });
    expect(html).toContain("<details");
    expect(html).toContain("setup-guide");
  });

  it("includes data-collapse-key with prefix", () => {
    const html = renderSetupGuide({ key: "slack", title: "Slack", markdown: "" });
    expect(html).toContain('data-collapse-key="setup-slack"');
  });

  it("includes the title in the summary text", () => {
    const html = renderSetupGuide({ key: "jira", title: "Jira Cloud", markdown: "" });
    expect(html).toContain("Jira Cloud");
  });

  it("renders the markdown body in setup-guide-body div", () => {
    const html = renderSetupGuide({ key: "g", title: "T", markdown: "Hello world" });
    expect(html).toContain("setup-guide-body");
    expect(html).toContain("Hello world");
  });
});

// ── mdToHtml ──────────────────────────────────────────────────────────────────

describe("mdToHtml", () => {
  it("returns empty string for empty input", () => {
    expect(mdToHtml("")).toBe("");
  });

  it("renders a paragraph for plain text", () => {
    const html = mdToHtml("Hello world");
    expect(html).toContain("<p>Hello world</p>");
  });

  it("renders h3 (level 1 heading → h3)", () => {
    const html = mdToHtml("# Section");
    expect(html).toContain("<h3");
    expect(html).toContain("Section");
  });

  it("renders h4 (level 2 heading → h4)", () => {
    const html = mdToHtml("## Sub-section");
    expect(html).toContain("<h4");
    expect(html).toContain("Sub-section");
  });

  it("renders h5 (level 3 heading → h5)", () => {
    const html = mdToHtml("### Step");
    expect(html).toContain("<h5");
    expect(html).toContain("Step");
  });

  it("renders unordered list", () => {
    const html = mdToHtml("- item 1\n- item 2");
    expect(html).toContain("<ul");
    expect(html).toContain("<li>item 1</li>");
    expect(html).toContain("<li>item 2</li>");
    expect(html).toContain("</ul>");
  });

  it("renders ordered list", () => {
    const html = mdToHtml("1. first\n2. second");
    expect(html).toContain("<ol");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("</ol>");
  });

  it("renders * bullet list items", () => {
    const html = mdToHtml("* alpha\n* beta");
    expect(html).toContain("<ul");
    expect(html).toContain("alpha");
  });

  it("renders blockquote", () => {
    const html = mdToHtml("> This is a note");
    expect(html).toContain("<blockquote");
    expect(html).toContain("This is a note");
  });

  it("renders multi-line blockquote", () => {
    const html = mdToHtml("> Line one\n> Line two");
    expect(html).toContain("<blockquote");
    expect(html).toContain("Line one");
    expect(html).toContain("Line two");
  });

  it("renders fenced code block", () => {
    const html = mdToHtml("```\nconsole.log('hi');\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("console.log");
    expect(html).toContain("copy-code");
  });

  it("renders fenced code block with language tag", () => {
    const html = mdToHtml("```js\nconst x = 1;\n```");
    expect(html).toContain("<code>");
    expect(html).toContain("const x = 1;");
  });

  it("closes list before a heading", () => {
    const html = mdToHtml("- item\n## New Section");
    expect(html).toContain("</ul>");
    expect(html).toContain("<h4");
  });

  it("renders inline bold **text**", () => {
    const html = mdToHtml("Some **bold** text");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders inline code `snippet`", () => {
    const html = mdToHtml("Run `npm install`");
    expect(html).toContain('<code class="setup-guide-code">npm install</code>');
  });

  it("renders markdown link [text](url)", () => {
    const html = mdToHtml("[Click here](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("Click here");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("does not render non-https links as anchors", () => {
    const html = mdToHtml("[Bad link](javascript:alert(1))");
    expect(html).not.toContain("<a href=");
  });

  it("handles blank lines between paragraphs", () => {
    const html = mdToHtml("Para one\n\nPara two");
    expect(html).toContain("<p>Para one</p>");
    expect(html).toContain("<p>Para two</p>");
  });

  it("handles indented continuation line in list", () => {
    const html = mdToHtml("- First item\n    More text");
    expect(html).toContain("First item");
    expect(html).toContain("More text");
  });

  it("renders multi-line paragraph as single p", () => {
    const html = mdToHtml("Line one\nLine two");
    expect(html).toContain("<p>");
    expect(html).toContain("Line one");
    expect(html).toContain("Line two");
  });

  it("handles Windows line endings", () => {
    const html = mdToHtml("Line one\r\nLine two");
    expect(html).toContain("<p>");
  });

  it("switches from unordered to ordered list cleanly", () => {
    const html = mdToHtml("- item a\n1. step one");
    expect(html).toContain("</ul>");
    expect(html).toContain("<ol");
  });
});
