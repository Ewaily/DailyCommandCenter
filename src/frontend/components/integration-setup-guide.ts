// IntegrationSetupGuide — collapsible accordion that renders a connector's
// setup walkthrough as Markdown directly inside the credentials form. Keeps
// the default form view uncluttered while putting expert guidance one click
// away from the inputs that need it.
//
// Markdown subset supported (intentionally tiny — no third-party dep):
//   #, ##, ###      headings
//   **bold**        bold (used for UI elements the user must click)
//   `code`          inline code
//   ```code```      fenced code block (rendered with a one-click copy button)
//   1. / -          ordered + unordered lists (single-level)
//   [text](url)     links (rendered with target=_blank rel=noopener)
//   > quote         blockquote
//
// Every value is HTML-escaped before any markdown transform runs, so user-
// supplied content (or future remote-loaded guides) cannot inject HTML.

import { escapeHtml } from "./util";

export interface IntegrationSetupGuideProps {
  /** Stable id used for the <details data-collapse-key=…> so open state is preserved. */
  key: string;
  /** Connector display name, e.g. "Outlook Calendar". */
  title: string;
  /** Markdown body. Must be authored in the project — never user input. */
  markdown: string;
}

export function renderSetupGuide(props: IntegrationSetupGuideProps): string {
  const html = mdToHtml(props.markdown);
  return `
    <details class="setup-guide" data-collapse-key="setup-${escapeHtml(props.key)}">
      <summary class="setup-guide-summary">
        <span class="setup-guide-icon" aria-hidden="true">📖</span>
        <span class="setup-guide-summary-text">
          Need help finding these? <strong>View ${escapeHtml(props.title)} setup guide</strong>
        </span>
        <span class="setup-guide-chev" aria-hidden="true">▾</span>
      </summary>
      <div class="setup-guide-body">${html}</div>
    </details>
  `;
}

// ============================================================
// Minimal markdown → HTML renderer
// ============================================================

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];

  let i = 0;
  let inList: "ul" | "ol" | null = null;

  const closeList = () => {
    if (inList) { out.push(`</${inList}>`); inList = null; }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      const code = escapeHtml(buf.join("\n"));
      out.push(`<pre class="setup-guide-pre"><button type="button" class="setup-guide-copy" data-action="copy-code" title="Copy">⧉</button><code>${code}</code></pre>`);
      continue;
    }

    // Headings.
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level + 2} class="setup-guide-h${level}">${inline(h[2])}</h${level + 2}>`);
      i++;
      continue;
    }

    // Blockquote.
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      closeList();
      const buf: string[] = [bq[1]];
      i++;
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote class="setup-guide-quote">${inline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Ordered list.
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) {
      if (inList !== "ol") { closeList(); out.push(`<ol class="setup-guide-ol">`); inList = "ol"; }
      out.push(`<li>${inline(ol[1])}</li>`);
      i++;
      continue;
    }

    // Unordered list.
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (inList !== "ul") { closeList(); out.push(`<ul class="setup-guide-ul">`); inList = "ul"; }
      out.push(`<li>${inline(ul[1])}</li>`);
      i++;
      continue;
    }

    // Indented continuation under the previous list item.
    if (inList && /^\s{2,}\S/.test(line)) {
      const last = out.length - 1;
      if (last >= 0 && out[last].startsWith("<li>")) {
        out[last] = out[last].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
      }
      i++;
      continue;
    }

    // Blank line.
    if (line.trim() === "") {
      closeList();
      i++;
      continue;
    }

    // Paragraph.
    closeList();
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3}\s|>\s|```|\s*\d+\.\s|\s*[-*]\s)/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }

  closeList();
  return out.join("\n");
}

// Inline transforms run on already-escaped text. Order matters: code spans
// first so their contents aren't re-processed for bold/links.
function inline(raw: string): string {
  let s = escapeHtml(raw);

  // Inline code: `foo`
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code class="setup-guide-code">${code}</code>`);

  // Links: [text](url) — only http(s) URLs allowed.
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );

  // Bold: **foo**
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`);

  return s;
}
