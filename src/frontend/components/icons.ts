// Lucide-style inline SVG icons. 16x16, stroke 1.75, currentColor.
// Kept as strings so they can be injected into innerHTML without a framework.

const SVG = (paths: string, extra = ""): string =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${paths}</svg>`;

export const icons = {
  refresh:  SVG(`<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/>`),
  moon:     SVG(`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
  sun:      SVG(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>`),
  rows3:    SVG(`<rect x="3" y="4"  width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="18" height="4" rx="1"/>`),
  rows2:    SVG(`<rect x="3" y="4"  width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/>`),
  settings: SVG(`<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`),
  help:     SVG(`<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>`),
  command:  SVG(`<path d="M18 3a3 3 0 1 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3z"/>`),
  chevronLeft:  SVG(`<path d="M15 18l-6-6 6-6"/>`),
  chevronRight: SVG(`<path d="M9 18l6-6-6-6"/>`),
  chevronDown:  SVG(`<path d="M6 9l6 6 6-6"/>`),
  plus:     SVG(`<path d="M12 5v14M5 12h14"/>`),
  x:        SVG(`<path d="M18 6L6 18M6 6l12 12"/>`),
  trash:    SVG(`<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>`),
  edit:     SVG(`<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>`),
  check:    SVG(`<path d="M20 6L9 17l-5-5"/>`),
  plug:     SVG(`<path d="M9 2v6"/><path d="M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>`),
  calendar: SVG(`<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>`),
  bell:     SVG(`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>`),
  sparkles: SVG(`<path d="M12 3l1.9 4.1L18 9l-4.1 1.9L12 15l-1.9-4.1L6 9l4.1-1.9z"/><path d="M19 14l.8 1.7L21.5 17l-1.7.8L19 19.5l-.8-1.7L16.5 17l1.7-.8z"/>`),
  inbox:    SVG(`<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`),
  clock:    SVG(`<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>`),
  palette:  SVG(`<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 22a10 10 0 1 1 0-20 8 8 0 0 1 8 8c0 3-2 4-3 4h-2a2 2 0 0 0-2 2 2 2 0 0 1-1 6z"/>`),
  gauge:    SVG(`<path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>`),
  ticket:   SVG(`<path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z"/><path d="M13 5v14"/>`),
  gitPr:    SVG(`<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v9"/><path d="M11 6h4a3 3 0 0 1 3 3v6"/>`),
  slack:    SVG(`<path d="M14 2a2 2 0 0 1 2 2v6a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2z"/><path d="M20 14a2 2 0 0 1-2 2h-6a2 2 0 0 1 0-4h6a2 2 0 0 1 2 2z"/><path d="M10 22a2 2 0 0 1-2-2v-6a2 2 0 0 1 4 0v6a2 2 0 0 1-2 2z"/><path d="M4 10a2 2 0 0 1 2-2h6a2 2 0 0 1 0 4H6a2 2 0 0 1-2-2z"/>`),
};

export type IconName = keyof typeof icons;

/** Walk a subtree and replace any element marked with `data-icon="name"` with that SVG. */
export function paintIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-icon]").forEach(el => {
    const name = el.dataset.icon as IconName;
    const svg  = icons[name];
    if (!svg) return;
    if (el.dataset.iconPainted === name) return;
    el.innerHTML = svg;
    el.dataset.iconPainted = name;
  });
}

/** Watch the whole document for newly-inserted [data-icon] elements and paint them automatically. */
export function startIconAutoPaint(): void {
  paintIcons(document);
  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        const el = n as HTMLElement;
        if (el.matches?.("[data-icon]")) paintIcons(el.parentElement || document);
        else paintIcons(el);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
