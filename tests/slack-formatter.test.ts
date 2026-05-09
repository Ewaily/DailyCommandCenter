import { describe, it, expect } from "vitest";
import { formatSlackText } from "../src/server/lib/slack-formatter.js";

const ctx = {
  users: { U04T2EKA2BF: "Muhammad Ewaily", U999: "Alice" },
  subteams: { S02MWKCEPSM: "ai-guild" },
  channels: { C123: "general" },
  selfUserId: "U04T2EKA2BF",
};

describe("formatSlackText", () => {
  it("resolves <@U...> to display name", () => {
    const out = formatSlackText("hi <@U999>!", ctx);
    expect(out).toContain("@Alice");
    expect(out).not.toContain("<@U999>");
  });

  it("flags self mention", () => {
    const out = formatSlackText("ping <@U04T2EKA2BF>", ctx);
    expect(out).toContain("mention self");
    expect(out).toContain("@Muhammad Ewaily");
  });

  it("resolves <!subteam^...>", () => {
    const out = formatSlackText("cc <!subteam^S02MWKCEPSM>", ctx);
    expect(out).toContain("@ai-guild");
  });

  it("renders <URL|label> as a clickable anchor", () => {
    const out = formatSlackText("see <https://example.com/x|example.com/x>", ctx);
    expect(out).toContain('href="https://example.com/x"');
    expect(out).toContain(">example.com/x<");
  });

  it("renders bare <URL>", () => {
    const out = formatSlackText("ref <https://share.google/abc>", ctx);
    expect(out).toContain('href="https://share.google/abc"');
    expect(out).toContain("share.google/abc");
  });

  it("renders *bold* / _italic_ / ~strike~", () => {
    const out = formatSlackText("this is *bold* and _italic_ and ~old~ news", ctx);
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>italic</em>");
    expect(out).toContain("<s>old</s>");
  });

  it("renders inline `code` and ```code blocks```", () => {
    const out = formatSlackText("run `npm test` then ```multi\nline```", ctx);
    expect(out).toContain("<code>npm test</code>");
    expect(out).toContain("<pre><code>multi\nline</code></pre>");
  });

  it("converts known :emoji: to unicode and unknown to chip", () => {
    const out = formatSlackText("ship it :rocket: :super_obscure:", ctx);
    expect(out).toContain("🚀");
    expect(out).toContain('emoji-chip">:super_obscure:</span>');
  });

  it("converts newlines to <br>", () => {
    const out = formatSlackText("line one\nline two", ctx);
    expect(out).toMatch(/line one<br ?\/?>line two/);
  });

  it("renders <#C...|name> as a channel ref", () => {
    const out = formatSlackText("see <#C123|general>", ctx);
    expect(out).toContain("channel-ref");
    expect(out).toContain("#general");
  });

  it("strips dangerous HTML", () => {
    const out = formatSlackText("hi <script>alert(1)</script>", ctx);
    expect(out).not.toContain("<script");
  });

  it("does not mangle code-block contents that look like mrkdwn", () => {
    const out = formatSlackText("```*not bold* <@U999>```", ctx);
    // contents inside <pre><code> remain literal (escaped)
    expect(out).toContain("*not bold*");
    expect(out).toContain("&lt;@U999&gt;");
  });

  it("handles <!here> and <!channel>", () => {
    expect(formatSlackText("<!here> heads up", ctx)).toContain("@here");
    expect(formatSlackText("<!channel>", ctx)).toContain("@channel");
  });

  it("handles <!everyone> broadcast", () => {
    const out = formatSlackText("<!everyone> please read", ctx);
    expect(out).toContain("@everyone");
  });

  it("handles <!date^...> by using fallback text", () => {
    const out = formatSlackText("<!date^1609459200^{date}|January 1, 2021>", ctx);
    expect(out).toContain("January 1, 2021");
  });

  it("falls back to user ID when not in users map", () => {
    const out = formatSlackText("hi <@UNKNOWN>", ctx);
    expect(out).toContain("@UNKNOWN");
  });
});
