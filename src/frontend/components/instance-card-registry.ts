// Capability registry for per-instance dashboard cards.
//
// Adding a new connector type = appending ONE entry to `CAPABILITIES` below.
// Everything that drives a per-instance card — the connector types it covers,
// the static widget it replaces, default grid dims, icon, default title,
// optional tabs (fixed or dynamic from the API response), the data fetch, the
// row renderer, and the empty-state copy — lives in that single object. The
// rendering loop in overview-widgets.ts is fully cap-agnostic and iterates
// this registry, so no new switch/case branch is ever needed.
//
// The contract is intentionally narrow: a capability either has tabs or it
// doesn't, fetch returns a normalized envelope, renderItem produces a row
// fragment. If a future connector needs richer UX (chips, footer actions),
// extend the spec interface — but adding new entries should not require
// touching the renderer.

import { api, type ConnectorInstance } from "../api.js";
import { escapeHtml } from "./util.js";

export type DimSpec = { x: number; y: number; w: number; h: number; minW: number; minH: number };

export type FetchResult = {
  items: unknown[];
  counts?: Record<string, number>;
  buckets?: Array<{ id: string; label: string }>;
  notConfigured?: boolean;
  effectiveBucket?: string;
};

export type TabSpec =
  // Fixed list (e.g. github review/mine/all/closed)
  | { kind: "fixed"; entries: Array<[string, string]>; defaultBucket: string; settingKey?: string }
  // Dynamic — bucket list comes from FetchResult.buckets after first load.
  // Always seeds with [["mine","Mine"], ...connector.config.watchedUsers].
  | { kind: "dynamic"; defaultBucket: string; settingKey?: string };

export interface CapabilitySpec {
  cap: string;                            // e.g. "github"
  matchTypes: string[];                   // connector.type values
  staticWidgetId: string;                 // dataset key on the static card to hide & inherit titles from
  defaultDims: DimSpec;                   // initial grid placement hint
  icon: string;                           // data-icon name
  defaultTitle: string;                   // shown when no custom title is set
  tabs?: TabSpec;                         // omit for tab-less cards (calendar, slack mentions)
  fetch: (connectorId: string, bucket: string | null) => Promise<FetchResult>;
  renderItem: (item: unknown) => string;
  empty: (bucket: string) => { emoji: string; title: string };
}

// ────────────────────────────────────────────────────────────────────
// Helpers used by multiple specs.
// ────────────────────────────────────────────────────────────────────

function row(opts: { left?: string; title: string; href?: string; meta?: string }): string {
  const { left, title, href, meta } = opts;
  const titleEl = href
    ? `<a href="${escapeHtml(href)}" target="_blank" class="schedule-title">${escapeHtml(title)}</a>`
    : `<div class="schedule-title">${escapeHtml(title)}</div>`;
  return `<div class="schedule-item">
    ${left ? `<div class="schedule-time item-key">${escapeHtml(left)}</div>` : ""}
    <div class="schedule-content">
      ${titleEl}
      ${meta ? `<div class="schedule-meta">${escapeHtml(meta)}</div>` : ""}
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────────────
// Capability specs
// ────────────────────────────────────────────────────────────────────

export const CAPABILITIES: CapabilitySpec[] = [
  {
    cap: "github",
    matchTypes: ["github"],
    staticWidgetId: "prs",
    defaultDims: { x: 9, y: 0, w: 3, h: 5, minW: 2, minH: 4 },
    icon: "gitPr",
    defaultTitle: "Pull Requests",
    tabs: {
      kind: "fixed",
      entries: [["review", "Needs Review"], ["mine", "My PRs"], ["all", "All Open"], ["closed", "Closed"]],
      defaultBucket: "review",
      settingKey: "prTab",
    },
    async fetch(connectorId, bucket) {
      const b = (bucket || "review") as "review" | "mine" | "all" | "closed";
      const resp = await api.prs(b, connectorId);
      return { items: resp.data ?? [], counts: resp.counts, notConfigured: resp.notConfigured };
    },
    renderItem(item) {
      const p = item as { number: number | string; title: string; url: string; repo: string; ageHuman: string };
      return row({ left: `#${p.number}`, title: p.title, href: p.url, meta: `${p.repo} · ${p.ageHuman}` });
    },
    empty(bucket) {
      switch (bucket) {
        case "mine":   return { emoji: "🚀", title: "No open PRs" };
        case "all":    return { emoji: "🏖️", title: "Repo is quiet" };
        case "closed": return { emoji: "🗄️", title: "No recently closed PRs" };
        default:       return { emoji: "✨", title: "Review queue is clear" };
      }
    },
  },

  {
    cap: "jira",
    matchTypes: ["jira"],
    staticWidgetId: "tickets",
    defaultDims: { x: 9, y: 5, w: 3, h: 5, minW: 2, minH: 4 },
    icon: "ticket",
    defaultTitle: "Tickets",
    tabs: { kind: "dynamic", defaultBucket: "mine", settingKey: "jiraTab" },
    async fetch(connectorId, bucket) {
      const resp = await api.ticketsMine(bucket || "mine", connectorId);
      return {
        items: resp.data ?? [],
        counts: resp.counts as Record<string, number> | undefined,
        buckets: Array.isArray(resp.buckets) ? resp.buckets.map(b => ({ id: b.id, label: b.label })) : undefined,
        notConfigured: resp.notConfigured,
        effectiveBucket: resp.bucket,
      };
    },
    renderItem(item) {
      const t = item as { key: string; title: string; url: string; status: string };
      return row({ left: t.key, title: t.title, href: t.url, meta: t.status });
    },
    empty(bucket) {
      return { emoji: bucket === "mine" ? "🎉" : "✅", title: bucket === "mine" ? "No tickets assigned to you" : "No tickets in this view" };
    },
  },

  {
    cap: "clickup",
    matchTypes: ["clickup"],
    staticWidgetId: "clickup",
    defaultDims: { x: 9, y: 10, w: 3, h: 5, minW: 2, minH: 4 },
    icon: "check",
    defaultTitle: "Tasks",
    tabs: { kind: "dynamic", defaultBucket: "mine", settingKey: "clickupTab" },
    async fetch(connectorId, bucket) {
      const resp = await api.clickupTasks(bucket || "mine", connectorId);
      return {
        items: resp.data ?? [],
        counts: resp.counts as Record<string, number> | undefined,
        buckets: Array.isArray(resp.buckets) ? resp.buckets.map(b => ({ id: b.id, label: b.label })) : undefined,
        notConfigured: resp.notConfigured,
        effectiveBucket: resp.bucket,
      };
    },
    renderItem(item) {
      const t = item as { title: string; url: string; status: string };
      return row({ title: t.title, href: t.url, meta: t.status });
    },
    empty(bucket) {
      return { emoji: "✅", title: bucket === "mine" ? "No tasks assigned to you" : "No tasks in this view" };
    },
  },

  {
    cap: "calendar",
    matchTypes: ["gcal", "outlook"],
    staticWidgetId: "schedule",
    defaultDims: { x: 0, y: 0, w: 5, h: 15, minW: 3, minH: 6 },
    icon: "calendar",
    defaultTitle: "Schedule",
    async fetch(connectorId) {
      const start = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
      const end   = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();
      const resp = await api.calendarEvents(start, end, connectorId);
      return { items: resp.data ?? [], notConfigured: resp.notConfigured };
    },
    renderItem(item) {
      const ev = item as { start: string; title: string };
      const t = new Date(ev.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return row({ left: t, title: ev.title });
    },
    empty() { return { emoji: "📅", title: "Nothing today" }; },
  },

  {
    cap: "slack",
    matchTypes: ["slack"],
    staticWidgetId: "mentions",
    defaultDims: { x: 5, y: 0, w: 4, h: 15, minW: 3, minH: 6 },
    icon: "bell",
    defaultTitle: "Mentions",
    async fetch(connectorId) {
      const resp = await api.mentions(7, false, connectorId);
      return { items: (resp.data ?? []).slice(0, 10), notConfigured: resp.notConfigured };
    },
    renderItem(item) {
      const m = item as { text: string; channelName: string; authorName: string };
      return row({ title: m.text.slice(0, 120), meta: `${m.channelName} · ${m.authorName}` });
    },
    empty() { return { emoji: "🎉", title: "No mentions" }; },
  },
];

// ────────────────────────────────────────────────────────────────────
// Lookup helpers
// ────────────────────────────────────────────────────────────────────

const BY_TYPE = new Map<string, CapabilitySpec>();
const BY_CAP  = new Map<string, CapabilitySpec>();
for (const spec of CAPABILITIES) {
  BY_CAP.set(spec.cap, spec);
  for (const t of spec.matchTypes) BY_TYPE.set(t, spec);
}

export function specForType(type: string): CapabilitySpec | undefined { return BY_TYPE.get(type); }
export function specForCap(cap: string):  CapabilitySpec | undefined { return BY_CAP.get(cap); }

// Read the watchedUsers list a connector saved in its config — used to seed
// dynamic tabs at first paint, before the first API response arrives.
export function readWatchedUsers(conn: ConnectorInstance): Array<{ id: string; label: string }> {
  const cfg = conn.config as { watchedUsers?: Array<{ id: string; label: string }> } | undefined;
  return Array.isArray(cfg?.watchedUsers) ? cfg!.watchedUsers : [];
}
