// Settings panel — 2 tabs: Workspaces (all connectors inline) + Preferences.
import { api, type Workspace, type ConnectorInstance, type AppCreds } from "../api.js";
import { escapeHtml } from "./util.js";

// ── Curated accent palette ────────────────────────────────────────────────────
// Every color satisfies WCAG AA (≥ 4.5:1) against white text.
// Amber is the borderline case (4.7:1) but still passes.
export const ACCENT_PALETTE: { hex: string; name: string }[] = [
  { hex: "#0066CC", name: "Royal Blue"   },
  { hex: "#2563EB", name: "Indigo"       },
  { hex: "#0369A1", name: "Ocean"        },
  { hex: "#0E7490", name: "Cyan"         },
  { hex: "#2A9D8F", name: "Teal"         },
  { hex: "#15803D", name: "Emerald"      },
  { hex: "#A16207", name: "Amber"        },
  { hex: "#C2410C", name: "Burnt Orange" },
  { hex: "#DC2626", name: "Crimson"      },
  { hex: "#BE185D", name: "Rose"         },
  { hex: "#7C3AED", name: "Violet"       },
  { hex: "#334155", name: "Slate"        },
];
const PALETTE_HEXES = new Set(ACCENT_PALETTE.map(p => p.hex.toLowerCase()));
import { refreshActiveWorkspace } from "./workspace-switcher.js";
import { getSetting, saveSetting } from "../state.js";
import { applyBrand, DEFAULT_BRAND_NAME } from "./brand.js";
import { applyTheme } from "./theme.js";
import { setTimezones } from "./header.js";
import { paintIcons } from "./icons.js";
import { domainFromUrl, buildLogoCandidates, monogramDataUrl, renderWorkspaceBadge } from "./workspace-logo.js";
import { renderSetupGuide } from "./integration-setup-guide.js";
import {
  OUTLOOK_SETUP_GUIDE,
  SLACK_SETUP_GUIDE,
  GITHUB_SETUP_GUIDE,
  GOOGLE_SETUP_GUIDE,
  JIRA_SETUP_GUIDE,
  NOTION_SETUP_GUIDE,
  CLICKUP_SETUP_GUIDE,
} from "./setup-guides.js";

type Tab = "workspaces" | "preferences";
let activeTab: Tab = "workspaces";

// ---------- collapse state — in-memory, resets every time the modal opens ----------
// Using a module-level Set (not localStorage) so every openSettings() call starts
// with everything collapsed. State accumulates as the user interacts within a
// single modal session, then is wiped clean on the next open.

const openSections = new Set<string>();

function setOpenSection(key: string, isOpenNow: boolean) {
  if (isOpenNow) openSections.add(key); else openSections.delete(key);
}
function isOpen(key: string): boolean {
  return openSections.has(key);
}

function deriveTzLabel(tz: string): string {
  const city = tz.trim().split("/").pop() || "";
  return city.replace(/_/g, "").slice(0, 3).toUpperCase() || "—";
}

function modal() { return document.getElementById("settings-modal"); }
function body()  { return document.getElementById("settings-body"); }

// ---------- open / close ----------

export function isSettingsOpen() { return !!modal()?.classList.contains("open"); }

export function openSettings() {
  openSections.clear();
  modal()?.classList.add("open");
  syncTabButtons();
  render();
}

export function closeSettings() { modal()?.classList.remove("open"); }

export function toggleSettings() {
  if (isSettingsOpen()) closeSettings(); else openSettings();
}

// Open settings to the Workspaces tab and immediately trigger the "new
// workspace" form. The form is injected by an async render, so we watch the
// modal DOM for the button and click it as soon as it appears.
export function openToNewWorkspace() {
  activeTab = "workspaces";
  openSettings();
  const m = modal();
  if (!m) return;
  const obs = new MutationObserver(() => {
    const btn = m.querySelector<HTMLElement>('[data-action="ws-new"]');
    if (btn) { obs.disconnect(); btn.click(); }
  });
  obs.observe(m, { childList: true, subtree: true });
  // Safety: disconnect after 3 s so the observer can't leak.
  setTimeout(() => obs.disconnect(), 3000);
}

function syncTabButtons() {
  document.querySelectorAll<HTMLElement>("[data-settings-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.settingsTab === activeTab);
  });
}

export function bindSettings() {
  modal()?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  document.querySelectorAll<HTMLElement>("[data-settings-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.settingsTab as Tab;
      syncTabButtons();
      render();
    });
  });

  body()?.addEventListener("click",  onSettingsClick);
  body()?.addEventListener("submit", onSettingsSubmit);
  body()?.addEventListener("change", onSettingsChange);
  body()?.addEventListener("input",  onSettingsInput);
  body()?.addEventListener("paste",  onSettingsPaste as EventListener);
}

// ---------- render ----------

function wireCollapseListeners(el: HTMLElement) {
  // Persist open/close state for all keyed details so re-renders restore them.
  el.querySelectorAll<HTMLDetailsElement>("details[data-collapse-key]").forEach(d => {
    d.addEventListener("toggle", () => setOpenSection(d.dataset.collapseKey!, d.open));
  });

  // Prevent buttons and links inside a <summary> from toggling the parent
  // <details> as a side-effect. We use preventDefault() on the summary's own
  // click — not stopPropagation on the button — so the event still bubbles to
  // the body's delegated onSettingsClick handler and the action runs normally.
  el.querySelectorAll<HTMLElement>("details > summary").forEach(summary => {
    summary.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button, a")) {
        e.preventDefault();
      }
    });
  });
}

async function render() {
  const el = body();
  if (!el) return;
  el.innerHTML = `<div class="loading">Loading</div>`;
  try {
    if (activeTab === "workspaces") el.innerHTML = await renderWorkspaces();
    else                            el.innerHTML = await renderPreferences();
    paintIcons(el);
    wireCollapseListeners(el);
  } catch (err: any) {
    el.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

// ============================================================
// WORKSPACES TAB
// ============================================================

async function renderWorkspaces(): Promise<string> {
  const [wsRes, appRes] = await Promise.all([api.workspaces(), api.appSettingsGet()]);
  const wss      = wsRes.data.workspaces;
  const appCreds = appRes.data;

  const detailsArr = await Promise.all(wss.map(ws => api.workspace(ws.id)));

  // Pre-fetch Jira project lists per-connector so the clone config dropdowns are populated.
  const allConnectors = detailsArr.flatMap(d => d.data.connectors);
  const jiraConns     = allConnectors.filter(c => c.type === "jira" && c.enabled && c.identity?.hasToken);
  const jiraProjectMap = new Map<string, import("../api.js").JiraProject[]>();
  await Promise.all(jiraConns.map(async c => {
    try {
      const pRes = await api.jiraProjects(c.id);
      if (!pRes.notConfigured) jiraProjectMap.set(c.id, pRes.data ?? []);
    } catch { /* connector unreachable — leave map empty for this id */ }
  }));
  // Flat de-duped project list for ClickUp connectors (they clone into any Jira project).
  const allJiraProjects = [...new Map(
    jiraConns.flatMap(c => jiraProjectMap.get(c.id) ?? []).map(p => [p.key, p]),
  ).values()];

  const sections = wss.map((ws, i) =>
    wsSection(ws, detailsArr[i].data.connectors, ws.id === wsRes.data.defaultWorkspaceId, appCreds, jiraProjectMap, allJiraProjects),
  );

  return `
    <div class="ws-toolbar">
      <div class="ws-toolbar-info">
        <strong>${wss.length} workspace${wss.length === 1 ? "" : "s"}</strong>
        <span class="muted"> · each workspace keeps its own connectors</span>
      </div>
      <button type="button" class="btn-primary btn-with-icon" data-action="ws-new">
        <span data-icon="plus" class="btn-icon"></span>Add workspace
      </button>
    </div>
    <div data-slot="ws-form"></div>
    ${sections.join("") || `
      <div class="empty empty-card">
        <span class="empty-icon" data-icon="inbox"></span>
        <div class="empty-title">No workspaces yet</div>
        <div class="empty-hint">Click <em>Add workspace</em> to create your first one. Each workspace keeps its own set of connector accounts.</div>
      </div>
    `}
  `;
}

// Every connector type MUST declare `setupGuideMarkdown`. The IntegrationSetupGuide
// accordion auto-renders it inside every credentials form for that connector.
// New connector? Author the markdown in setup-guides.ts and reference it here —
// TypeScript won't compile until you do.
type ConnectorTypeBase = { setupGuideMarkdown: string };
type ConnectorTypeDef = ConnectorTypeBase & (
  | { type: "gcal" | "slack"; title: string; color: string; kind: "oauth"; provider: "google" | "slack"; providerCreds: OAuthProviderCreds }
  | { type: "outlook"; title: string; color: string; kind: "outlook"; providerCreds: AppCreds["microsoft"] }
  | { type: "github" | "jira" | "notion" | "clickup"; title: string; color: string; kind: "apikey"; fields: FieldDef[] }
);

function typeDefs(appCreds: AppCreds): ConnectorTypeDef[] {
  return [
    { type: "gcal",    title: "Google Calendar", color: "#4285F4", kind: "oauth",   provider: "google", providerCreds: appCreds.google,    setupGuideMarkdown: GOOGLE_SETUP_GUIDE },
    { type: "outlook", title: "Outlook Calendar", color: "#0078D4", kind: "outlook", providerCreds: appCreds.microsoft, setupGuideMarkdown: OUTLOOK_SETUP_GUIDE },
    { type: "slack",   title: "Slack",           color: "#4A154B", kind: "oauth",   provider: "slack",  providerCreds: appCreds.slack,     setupGuideMarkdown: SLACK_SETUP_GUIDE },
    { type: "github",  title: "GitHub",          color: "#24292e", kind: "apikey", setupGuideMarkdown: GITHUB_SETUP_GUIDE,  fields: [
      { name: "token",    label: "Personal access token", type: "password", configKey: null,
        placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
        helperText: "Generate at github.com → Settings → Developer Settings → Personal access tokens. Needs repo and read:user scopes." },
      { name: "username", label: "Username / Org",        type: "text",     configKey: "username",
        placeholder: "octocat",
        helperText: "Your GitHub username or organization login (e.g. TrianglZ). Found in your profile URL: github.com/{username}." },
      { name: "repo",     label: "Repository",            type: "text",     configKey: "repo",
        placeholder: "owner/repo-name",
        helperText: "Full slug in owner/repo format (e.g. TrianglZ/expense-point-ios). No URL — paste one and it'll be stripped automatically.",
        stripUrl: true },
    ]},
    { type: "jira",    title: "Jira",            color: "#0052cc", kind: "apikey", setupGuideMarkdown: JIRA_SETUP_GUIDE, fields: [
      { name: "token",   label: "API token", type: "password", configKey: null,
        placeholder: "ATATT3xFfGF0...",
        helperText: "Generate at id.atlassian.com → Security → API tokens. This is not your account password." },
      { name: "account", label: "Email",     type: "text",     configKey: "email",
        placeholder: "you@company.com",
        helperText: "The email address you use to log in to Jira." },
      { name: "baseUrl", label: "Base URL",  type: "text",     configKey: "baseUrl",
        placeholder: "yourcompany.atlassian.net",
        helperText: "Hostname only — no https:// and no trailing slash (e.g. acme.atlassian.net). Paste the full URL and it'll be stripped.",
        stripUrl: true },
    ]},
    { type: "notion",  title: "Notion",          color: "#000000", kind: "apikey", setupGuideMarkdown: NOTION_SETUP_GUIDE, fields: [
      { name: "token",       label: "Integration token", type: "password", configKey: null,
        placeholder: "secret_xxxxxxxxxxxxxxxx",
        helperText: "Create an Internal Integration at notion.so/my-integrations. Token starts with secret_. Remember to share each database with the integration." },
      { name: "databaseIds", label: "Database IDs",      type: "text",     configKey: "databaseIds",
        placeholder: "a1b2c3d4e5f6..., f6e5d4c3b2a1...",
        helperText: "Comma-separated IDs. Found in the database page URL: notion.so/.../{DATABASE_ID}?v=... Paste URLs and they'll be stripped to IDs.",
        stripUrl: true },
    ]},
    { type: "clickup", title: "ClickUp",         color: "#7B68EE", kind: "apikey", setupGuideMarkdown: CLICKUP_SETUP_GUIDE, fields: [
      { name: "token",    label: "Personal API token",  type: "password", configKey: null,
        placeholder: "pk_12345678_XXXXXXXXXXXXXXXXXXXXXXXXXX",
        helperText: "Found at app.clickup.com → Your Avatar → Settings → Apps → API Token." },
      { name: "teamId",   label: "Workspace ID",        type: "text",     configKey: "teamId",
        placeholder: "12345678",
        helperText: "Numeric Workspace ID. Found in any ClickUp URL: app.clickup.com/{ID}/... or via Settings → Workspace Settings. Paste the URL and it'll extract the ID.",
        stripUrl: true },
      { name: "spaceIds", label: "Space IDs (optional)", type: "text",    configKey: "spaceIds",
        placeholder: "87654321, 11223344",
        helperText: "Optional. Comma-separated Space IDs to narrow scope. Leave blank to include all spaces. Found in the URL when inside a Space." },
    ]},
  ];
}

function wsSection(ws: Workspace, connectors: ConnectorInstance[], isDefault: boolean, appCreds: AppCreds, jiraProjectMap: Map<string, import("../api.js").JiraProject[]>, allJiraProjects: import("../api.js").JiraProject[]): string {
  const color = ws.color || "var(--accent)";
  const def   = isDefault ? `<span class="settings-chip">default</span>` : "";

  const ownedActive = connectors.filter(c =>
    (c.source ?? (c.workspaceId === ws.id ? "owned" : "shared")) === "owned" && c.identity?.hasToken,
  ).length;
  const sharedActive = connectors.filter(c =>
    (c.source ?? (c.workspaceId === ws.id ? "owned" : "shared")) === "shared" && c.enabledForThisWorkspace === true,
  ).length;

  const summary = (ownedActive + sharedActive) === 0
    ? `<span class="ws-section-summary muted">No connectors yet</span>`
    : `<span class="ws-section-summary">${ownedActive} owned${sharedActive ? `, ${sharedActive} shared` : ""}</span>`;

  return `
    <details class="ws-section" data-ws-id="${escapeHtml(ws.id)}" data-collapse-key="ws-${escapeHtml(ws.id)}" ${isOpen(`ws-${ws.id}`) ? "open" : ""}>
      <summary class="ws-section-head" style="--ws-color:${color}">
        <span class="ws-chevron">▸</span>
        <span class="ws-section-icon">${renderWorkspaceBadge(ws, 26, { title: false })}</span>
        <span class="ws-section-name">${escapeHtml(ws.name)}${ws.website ? `<span class="ws-section-domain muted">${escapeHtml(ws.website)}</span>` : ""}</span>
        ${def}
        ${summary}
        <span class="ws-section-actions">
          <button class="btn-ghost btn-sm" data-action="ws-edit" data-id="${escapeHtml(ws.id)}" aria-label="Edit workspace ${escapeHtml(ws.name)}">
            <span data-icon="edit" class="btn-icon"></span>Edit
          </button>
          ${isDefault ? "" : `<button class="btn-ghost btn-sm" data-action="ws-default" data-id="${escapeHtml(ws.id)}">Set default</button>`}
          <button class="btn-danger btn-sm" data-action="ws-delete" data-id="${escapeHtml(ws.id)}" aria-label="Delete workspace ${escapeHtml(ws.name)}">
            <span data-icon="trash" class="btn-icon"></span>Delete
          </button>
        </span>
      </summary>
      <div data-slot="ws-form-${escapeHtml(ws.id)}"></div>
      <div class="ws-section-connectors">
        ${typeDefs(appCreds).map(td => connectorTypeGroup(ws, td, connectors, jiraProjectMap, allJiraProjects)).join("")}
      </div>
    </details>
  `;
}

// Types whose routes fan-out across all visible accounts (slack/calendars merge
// data from every active account). Other types use a "first owned wins, else
// first opted-in shared" precedence — copy reflects this so users aren't surprised.
const FANOUT_TYPES = new Set<string>(["slack", "gcal", "outlook"]);

function behaviorHint(type: string): string {
  return FANOUT_TYPES.has(type)
    ? "Data merges from every active account in this workspace."
    : "Your own account takes priority. The shared account is used only when you haven't connected your own.";
}

// Renders one connector type as a single block with three clearly-separated
// regions: shared-from-others (with prominent ON/OFF toggle), owned (with
// credentials + share toggle), and a "Connect another" footer.
function connectorTypeGroup(ws: Workspace, td: ConnectorTypeDef, allConnectors: ConnectorInstance[], jiraProjectMap: Map<string, import("../api.js").JiraProject[]>, allJiraProjects: import("../api.js").JiraProject[]): string {
  const ofType = allConnectors.filter(c => c.type === td.type);
  const owned  = ofType.filter(c => (c.source ?? (c.workspaceId === ws.id ? "owned" : "shared")) === "owned");
  const shared = ofType.filter(c => (c.source ?? (c.workspaceId === ws.id ? "owned" : "shared")) === "shared");

  const ownedConnected = owned.filter(c => c.identity?.hasToken);
  const sharedActive   = shared.filter(c => c.enabledForThisWorkspace === true);
  const sharedOff      = shared.filter(c => !c.enabledForThisWorkspace);

  // "Resolved state" — what this workspace will actually use right now.
  let summaryStatus: string;
  let summaryClass: "ok" | "warn" | "muted";
  if (ownedConnected.length === 0 && sharedActive.length === 0) {
    summaryStatus = "Not connected";
    summaryClass  = "muted";
  } else {
    const parts: string[] = [];
    if (ownedConnected.length) parts.push(`${ownedConnected.length} personal`);
    if (sharedActive.length)   parts.push(`${sharedActive.length} shared`);
    summaryStatus = `Active · ${parts.join(" + ")}`;
    summaryClass  = "ok";
  }

  const sharedCards = shared.map(c => renderSharedFromOtherInstance(ws, td, c, ownedConnected.length > 0)).join("");
  const ownedCards  = owned.map(c => {
    const cloneProjects = td.type === "jira"    ? (jiraProjectMap.get(c.id) ?? [])
                        : td.type === "clickup" ? allJiraProjects
                        : [];
    return renderOwnedInstance(ws, td, c, cloneProjects);
  }).join("");
  const addAnother  = renderAddAnother(ws, td, owned);

  const hasAnything = shared.length > 0 || owned.length > 0;
  const behaviorBanner = hasAnything ? `
    <p class="connector-behavior-hint">${escapeHtml(behaviorHint(td.type))}</p>
  ` : "";

  const sharedSection = shared.length ? `
    <div class="connector-region connector-region--shared">
      <div class="connector-region-label">🔗 Shared from other workspaces</div>
      ${sharedCards}
    </div>
  ` : "";

  const ownedSection = owned.length ? `
    <div class="connector-region connector-region--owned">
      <div class="connector-region-label">
        ${escapeHtml(ws.icon || "🏠")} ${escapeHtml(ws.name)}'s ${escapeHtml(td.title)} ${owned.length === 1 ? "account" : "accounts"}
      </div>
      ${ownedCards}
    </div>
  ` : "";

  const body = `
    ${behaviorBanner}
    ${sharedSection}
    ${ownedSection}
    ${addAnother}
  `;
  return connectorBlock(td.title, td.color, body, summaryStatus, summaryClass, `conn-${ws.id}-${td.type}`);
}

function renderOwnedInstance(ws: Workspace, td: ConnectorTypeDef, c: ConnectorInstance, cloneProjects: import("../api.js").JiraProject[] = []): string {
  const connected = !!c.identity?.hasToken;
  const account   = c.identity?.account || c.identity?.label || td.title;

  // Count of other workspaces opted in to this shared connector — surfaced to
  // the owner so they know the impact of toggling Share off / disconnecting.
  const enrolledList = Array.isArray((c.config as any)?.enabledWorkspaces)
    ? ((c.config as any).enabledWorkspaces as string[]).filter(id => id !== ws.id)
    : [];
  const enrolledCount = enrolledList.length;
  const shareNote = c.shared
    ? `<span class="muted">Visible to every workspace · ${enrolledCount} ${enrolledCount === 1 ? "is" : "are"} actively using it.</span>`
    : `<span class="muted">Only this workspace can see this account.</span>`;

  const overviewNote = c.shareWithOverview
    ? `<span class="muted">Surfaces in Overview alongside every other shared connector.</span>`
    : `<span class="muted">Hidden from Overview — flip on to include it in the unified view.</span>`;

  const shareToggle = `
    <div class="connector-share-block">
      <label class="connector-share-toggle ${c.shared ? "is-on" : ""}" title="When on, this connector appears in every other workspace's Settings — they choose whether to opt in.">
        <input type="checkbox" data-action="instance-share-toggle" data-ci="${escapeHtml(c.id)}" ${c.shared ? "checked" : ""} />
        <span class="connector-share-toggle-label">Share with other workspaces</span>
        ${shareNote}
      </label>
      <label class="connector-share-toggle connector-share-overview ${c.shareWithOverview ? "is-on" : ""}" title="When on, this connector's data appears in the cross-workspace Overview view.">
        <input type="checkbox" data-action="instance-overview-toggle" data-ci="${escapeHtml(c.id)}" ${c.shareWithOverview ? "checked" : ""} />
        <span class="connector-share-toggle-label">Show in Overview <span class="overview-glyph" aria-hidden="true">✦</span></span>
        ${overviewNote}
      </label>
    </div>
  `;

  if (td.kind === "oauth" || td.kind === "outlook") {
    if (!connected) {
      return `<div class="connector-instance owned">${renderOAuthEmptyConnect(ws, td)}</div>`;
    }
    const provider = td.kind === "oauth" ? td.provider : "microsoft";
    const updateCredsForm = td.kind === "outlook"
      ? renderMicrosoftCredsForm(td.providerCreds, td.setupGuideMarkdown)
      : renderOAuthCredsForm(td as Extract<ConnectorTypeDef, { kind: "oauth" }>);
    return `
      <div class="connector-instance owned">
        <div class="connector-instance-head">
          <span class="settings-status ok">Connected · ${escapeHtml(account)}</span>
          <span class="connector-instance-actions">
            <a class="link-btn" href="/api/auth/${provider}/start?workspaceId=${encodeURIComponent(ws.id)}&connectorId=${encodeURIComponent(c.id)}" target="_blank">Reconnect ↗</a>
            <button class="link-btn danger" data-action="instance-disconnect" data-ci="${escapeHtml(c.id)}">Disconnect</button>
          </span>
        </div>
        ${shareToggle}
        <details class="connector-creds-update">
          <summary class="link-btn muted">Update app credentials</summary>
          ${updateCredsForm}
        </details>
      </div>
    `;
  }

  // API-key instance.
  const cloneEditor = (td.type === "jira" || td.type === "clickup") && c.identity?.hasToken
    ? renderConnectorCloneEditor(c, cloneProjects, td.type === "clickup")
    : "";
  const extras = (td.type === "jira"    ? renderJiraWatchedUsersEditor(c)
    : td.type === "clickup" ? renderClickUpWatchedUsersEditor(c)
    : "") + cloneEditor;
  return `
    <div class="connector-instance owned">
      <div class="connector-instance-head">
        ${connected
          ? `<span class="settings-status ok">Connected${account ? ` · ${escapeHtml(account)}` : ""}</span>`
          : `<span class="muted">Not connected</span>`}
        ${connected ? `
          <span class="connector-instance-actions">
            <button type="button" class="link-btn danger" data-action="instance-disconnect" data-ci="${escapeHtml(c.id)}">Disconnect</button>
          </span>` : ""}
      </div>
      <form class="connector-apikey-form" data-form="apikey-connect"
            data-ws="${escapeHtml(ws.id)}" data-type="${td.type}" data-ci="${escapeHtml(c.id)}">
        ${renderSetupGuide({ key: `${td.type}-${c.id}-creds`, title: td.title, markdown: td.setupGuideMarkdown })}
        ${td.fields.map(f => renderApiKeyInput(f, c)).join("")}
        <div class="connector-form-actions">
          <button type="submit" class="header-btn primary">${connected ? "Update" : "Connect"}</button>
        </div>
      </form>
      ${shareToggle}
      ${extras}
    </div>
  `;
}

// ============================================================
// Jira: per-connector "watched users" editor
// Each entry becomes a tab in the Tickets card. The user can add/remove
// any number of entries — no hardcoded names anywhere.
// ============================================================

type StoredWatchedUser = { id: string; label: string; query: string; status?: string; hideClosed?: boolean };

function readWatchedUsers(c: ConnectorInstance): StoredWatchedUser[] {
  const raw = (c.config || {}).watchedUsers;
  return Array.isArray(raw) ? raw as StoredWatchedUser[] : [];
}

function slugifyLabel(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || `user-${Math.random().toString(36).slice(2, 7)}`;
}

function watchedUserRow(u: StoredWatchedUser, idx: number, ciId: string, includeStatus: boolean): string {
  const hideClosedChecked = u.hideClosed !== false ? "checked" : "";
  const statusField = includeStatus
    ? `<input class="watched-input watched-input--narrow" name="status" placeholder="Status filter (opt.)" value="${escapeHtml(u.status || "")}" />`
    : "";
  return `
    <div class="watched-user-row" data-watched-idx="${idx}">
      <input class="watched-input" name="label" placeholder="Tab label" value="${escapeHtml(u.label || "")}" />
      <input class="watched-input" name="query" placeholder="Name, email, or ID" value="${escapeHtml(u.query || "")}" />
      ${statusField}
      <label class="watched-hide-closed" title="When checked, closed / done tickets are excluded from this tab">
        <input type="checkbox" name="hideClosed" ${hideClosedChecked} />
        <span>Hide closed</span>
      </label>
      <button type="button" class="link-btn danger" data-action="watched-remove" data-ci="${escapeHtml(ciId)}" data-idx="${idx}" title="Remove">✕</button>
    </div>
  `;
}

function renderWatchedUsersEditor(c: ConnectorInstance, title: string, hint: string, includeStatus: boolean): string {
  if (!c.identity?.hasToken) return "";
  const users = readWatchedUsers(c);
  const rows = users.map((u, idx) => watchedUserRow(u, idx, c.id, includeStatus)).join("");
  const empty = users.length === 0
    ? `<p class="muted watched-empty">No teammates watched yet. Add one to see their tab in the card.</p>`
    : "";
  return `
    <div class="watched-users-editor">
      <div class="watched-users-head">
        <span class="watched-users-title">${escapeHtml(title)}</span>
        <span class="muted">${escapeHtml(hint)}</span>
      </div>
      ${empty}
      <form class="watched-users-list" data-form="watched-users-save" data-ci="${escapeHtml(c.id)}" data-include-status="${includeStatus}">
        ${rows}
        <div class="watched-users-actions">
          <button type="submit" class="header-btn primary">Save</button>
          <button type="button" class="link-btn" data-action="watched-add" data-ci="${escapeHtml(c.id)}" data-include-status="${includeStatus}">+ Add teammate</button>
        </div>
      </form>
    </div>
  `;
}

function renderJiraWatchedUsersEditor(c: ConnectorInstance): string {
  return renderWatchedUsersEditor(
    c,
    "Watched teammates",
    `Each row becomes a tab in the Tickets card. The "Mine" tab is always shown.`,
    true,
  );
}

function renderClickUpWatchedUsersEditor(c: ConnectorInstance): string {
  return renderWatchedUsersEditor(
    c,
    "Watched teammates",
    `Each row becomes a tab in the Tasks card. The "Mine" tab is always shown.`,
    false,
  );
}

export function renderConnectorCloneEditor(c: ConnectorInstance, projects: import("../api.js").JiraProject[], isClickUp: boolean): string {
  const cfg = c.config as { cloningEnabled?: boolean; defaultTargetProject?: string };
  const enabled = !!cfg.cloningEnabled;
  const current = cfg.defaultTargetProject || "";
  const sourceLabel = isClickUp ? "ClickUp tasks" : "Jira tickets";

  const projectControl = projects.length
    ? `<select name="defaultTargetProject" class="pref-input pref-select">
        <option value="">— select a project —</option>
        ${projects.map(p => `<option value="${escapeHtml(p.key)}" ${p.key === current ? "selected" : ""}>${escapeHtml(p.name)} (${escapeHtml(p.key)})</option>`).join("")}
       </select>`
    : `<input name="defaultTargetProject" class="pref-input" type="text"
         placeholder="e.g. PROJ"
         value="${escapeHtml(current)}"
         title="Enter the Jira project key. Connect a Jira account in this workspace to get a dropdown." />`;

  return `
    <div class="watched-users-editor">
      <div class="watched-users-head">
        <span class="watched-users-title">1-Click Cloning to Jira</span>
        <span class="muted">Clone ${escapeHtml(sourceLabel)} into a Jira project in one click — no dialog needed.</span>
      </div>
      <form class="watched-users-list" data-form="connector-clone-save" data-ci="${escapeHtml(c.id)}">
        <div class="settings-pref-row" style="padding:0 0 8px">
          <label class="settings-toggle-label">
            <input type="checkbox" name="cloningEnabled" ${enabled ? "checked" : ""} />
            <span>${enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
        <div class="settings-pref-row" style="padding:0 0 8px">
          <label class="connector-field-label">Target Jira project
            ${projectControl}
            <span class="form-help">Cloned tickets land here. ${projects.length ? "" : "No Jira connector active in this workspace — type the project key directly."}</span>
          </label>
        </div>
        <div class="watched-users-actions">
          <button type="submit" class="header-btn primary">Save cloning settings</button>
        </div>
      </form>
    </div>
  `;
}

function renderApiKeyInput(f: FieldDef, c: ConnectorInstance | undefined): string {
  const cfg = c?.config || {};
  const connected = !!c?.identity?.hasToken;
  let val = "";
  if (f.configKey && cfg[f.configKey] != null) {
    const raw = cfg[f.configKey];
    val = Array.isArray(raw) ? raw.join(",") : String(raw);
  } else if (f.name === "token" && c?.identity?.accessToken) {
    val = c.identity.accessToken;
  } else if (f.name === "account" && c?.identity?.account) {
    val = c.identity.account;
  }
  const placeholder = f.type === "password"
    ? (connected ? "leave blank to keep current" : (f.placeholder || "enter token"))
    : (f.placeholder || "");
  const inputEl = `<input name="${f.name}" type="${f.type}"
             placeholder="${escapeHtml(placeholder)}"
             value="${escapeHtml(val)}"${f.stripUrl ? ` data-strip-url` : ""} />`;
  const field = f.type === "password"
    ? `<div class="pw-wrap">${inputEl}<button type="button" class="pw-toggle" data-action="pw-toggle" title="Show/hide">👁</button></div>`
    : inputEl;
  const helper = f.helperText
    ? `<span class="form-help">${escapeHtml(f.helperText)}</span>`
    : "";
  return `<label class="connector-field-label">${escapeHtml(f.label)}${field}${helper}</label>`;
}

// Shared-from-other card. The "useMyOwnHint" flag adds a subtle "you already
// have your own — opting into shared too will merge data" callout when the
// workspace has connected its own account of the same type.
function renderSharedFromOtherInstance(ws: Workspace, td: ConnectorTypeDef, c: ConnectorInstance, hasOwnedConnected: boolean): string {
  const enabled = c.enabledForThisWorkspace === true;
  const account = c.identity?.account || c.identity?.label || td.title;
  const ownerName = c.ownerWorkspace?.name || "another workspace";
  const ownerIcon = c.ownerWorkspace?.icon || "🔗";

  const stateClass = enabled ? "is-on" : "is-off";
  const stateBadge = enabled
    ? `<span class="settings-status ok">Active here</span>`
    : `<span class="settings-status muted">Off in this workspace</span>`;

  const conflictHint = (enabled && hasOwnedConnected && FANOUT_TYPES.has(td.type))
    ? `<p class="connector-conflict-hint">You also have your own ${escapeHtml(td.title)} below — both will be queried and results merged.</p>`
    : "";
  const offCta = !enabled
    ? `<p class="connector-off-cta muted">Toggle on to use it — or scroll down to <strong>Connect another ${escapeHtml(td.title)} account</strong> to use your own credentials instead.</p>`
    : "";

  return `
    <div class="connector-instance shared ${stateClass}">
      <div class="connector-instance-head">
        <span class="connector-shared-owner" title="Owned by ${escapeHtml(ownerName)} — only that workspace can edit credentials.">
          <span class="connector-shared-owner-icon">${escapeHtml(ownerIcon)}</span>
          From <strong>${escapeHtml(ownerName)}</strong>${account ? ` · ${escapeHtml(account)}` : ""}
        </span>
        ${stateBadge}
      </div>
      <label class="connector-enroll connector-enroll--prominent">
        <input type="checkbox" data-action="shared-enroll-toggle" data-ws="${escapeHtml(ws.id)}" data-ci="${escapeHtml(c.id)}" ${enabled ? "checked" : ""} />
        <span><strong>Use this ${escapeHtml(td.title)} in ${escapeHtml(ws.name)}</strong>
          <span class="muted"> · read-only — only ${escapeHtml(ownerName)} can edit credentials</span>
        </span>
      </label>
      ${conflictHint}
      ${offCta}
    </div>
  `;
}

function renderOAuthEmptyConnect(ws: Workspace, td: Extract<ConnectorTypeDef, { kind: "oauth" | "outlook" }>): string {
  if (td.kind === "outlook") {
    const hasCreds = !!(td.providerCreds.clientId && (td.providerCreds as any).hasSecret);
    if (!hasCreds) return renderMicrosoftCredsForm(td.providerCreds, td.setupGuideMarkdown);
    return `
      <div class="connector-connected">
        <span class="muted">Not connected in this workspace</span>
        <a class="link-btn" href="/api/auth/microsoft/start?workspaceId=${encodeURIComponent(ws.id)}" target="_blank">Connect Outlook ↗</a>
      </div>
      <details class="connector-creds-update">
        <summary class="link-btn muted">Configure app credentials</summary>
        ${renderMicrosoftCredsForm(td.providerCreds, td.setupGuideMarkdown)}
      </details>
    `;
  }
  // OAuth (gcal/slack)
  const oauthTd = td as Extract<ConnectorTypeDef, { kind: "oauth" }>;
  const hasCreds = !!(oauthTd.providerCreds.clientId && oauthTd.providerCreds.hasSecret);
  if (!hasCreds) return renderOAuthCredsForm(oauthTd);
  return `
    <div class="connector-connected">
      <span class="muted">Not connected in this workspace</span>
      <a class="link-btn" href="/api/auth/${oauthTd.provider}/start?workspaceId=${encodeURIComponent(ws.id)}" target="_blank">Connect ${escapeHtml(td.title)} ↗</a>
    </div>
    <details class="connector-creds-update">
      <summary class="link-btn muted">Configure app credentials</summary>
      ${renderOAuthCredsForm(oauthTd)}
    </details>
  `;
}

function renderOAuthCredsForm(td: Extract<ConnectorTypeDef, { kind: "oauth" }>): string {
  const provider = td.provider;
  const [clientIdHint, clientSecretHint] = provider === "google"
    ? [
        "Found in Google Cloud Console → APIs &amp; Services → Credentials → your OAuth 2.0 Client ID.",
        "The client secret string (not a display name). Found on the same credentials detail page in Google Cloud Console.",
      ]
    : [
        "Found at api.slack.com/apps → your app → Basic Information → App Credentials.",
        "Found at api.slack.com/apps → your app → Basic Information → App Credentials, just below the Client ID.",
      ];
  return `
    <form class="connector-creds-form" data-form="app-creds-inline" data-provider="${provider}">
      ${renderSetupGuide({ key: `${provider}-creds`, title: td.title, markdown: td.setupGuideMarkdown })}
      <label class="connector-field-label">Client ID
        <input name="${provider}.clientId" placeholder="xxxxxxxxxxxx.apps.googleusercontent.com" value="${escapeHtml(td.providerCreds.clientId || "")}" />
        <span class="form-help">${clientIdHint}</span>
      </label>
      <label class="connector-field-label">Client secret
        <div class="pw-wrap">
          <input name="${provider}.clientSecret"
                 placeholder="GOCSPX-..."
                 value="${escapeHtml(td.providerCreds.clientSecret || "")}"
                 type="password" />
          <button type="button" class="pw-toggle" data-action="pw-toggle" title="Show/hide">👁</button>
        </div>
        <span class="form-help">${clientSecretHint}</span>
      </label>
      <button type="submit" class="header-btn primary">Save credentials</button>
    </form>
  `;
}

function renderMicrosoftCredsForm(creds: AppCreds["microsoft"], setupGuideMarkdown: string = OUTLOOK_SETUP_GUIDE): string {
  return `
    <form class="connector-creds-form" data-form="app-creds-inline" data-provider="microsoft">
      ${renderSetupGuide({ key: "microsoft-creds", title: "Outlook Calendar", markdown: setupGuideMarkdown })}
      <label class="connector-field-label">Application (client) ID
        <input name="microsoft.clientId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${escapeHtml(creds.clientId || "")}" />
        <span class="form-help">Found on the Overview page of your app registration in Azure Portal (portal.azure.com → App registrations → your app).</span>
      </label>
      <label class="connector-field-label">Client secret <strong>value</strong>
        <div class="pw-wrap">
          <input name="microsoft.clientSecret"
                 placeholder="abc123~Xyz..."
                 value="${escapeHtml(creds.clientSecret || "")}"
                 type="password" />
          <button type="button" class="pw-toggle" data-action="pw-toggle" title="Show/hide">👁</button>
        </div>
        <span class="form-help">⚠️ Paste the <strong>Value</strong> column, not the Secret ID (GUID). Found at App registrations → your app → Certificates &amp; secrets → Client secrets. The value is only shown once at creation time.</span>
      </label>
      <label class="connector-field-label">Tenant ID <span class="muted">(optional)</span>
        <input name="microsoft.tenantId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value="${escapeHtml(creds.tenantId || "")}" />
        <span class="form-help">Leave blank to use the common endpoint (works for personal and work accounts). Set to your directory (tenant) ID for single-tenant apps.</span>
      </label>
      <button type="submit" class="header-btn primary">Save credentials</button>
    </form>
  `;
}

function renderAddAnother(ws: Workspace, td: ConnectorTypeDef, owned: ConnectorInstance[]): string {
  const hasOwned = owned.some(c => c.identity?.hasToken);
  // Copy adapts: nothing owned yet → "Connect your own"; otherwise → "Add another".
  const verb = hasOwned ? "Add another" : "Connect your own";

  if (td.kind === "oauth") {
    const hasCreds = !!(td.providerCreds.clientId && td.providerCreds.hasSecret);
    // No app credentials saved yet → render the creds form inline so the user
    // can finish setup without bouncing between sections.
    if (!hasCreds) {
      return `
        <details class="connector-add-row">
          <summary class="link-btn connector-add-cta">+ ${verb} ${escapeHtml(td.title)} account</summary>
          <p class="connector-hint" style="margin-top:8px;">
            To connect ${escapeHtml(td.title)}, enter your OAuth app credentials below first.
          </p>
          ${renderOAuthCredsForm(td)}
        </details>
      `;
    }
    return `
      <div class="connector-add-row">
        <a class="link-btn connector-add-cta" href="/api/auth/${td.provider}/start?workspaceId=${encodeURIComponent(ws.id)}&addAnother=1" target="_blank">
          + ${verb} ${escapeHtml(td.title)} account ↗
        </a>
        <details class="connector-creds-update">
          <summary class="link-btn muted">Configure app credentials</summary>
          ${renderOAuthCredsForm(td)}
        </details>
      </div>
    `;
  }

  if (td.kind === "outlook") {
    const hasCreds = !!(td.providerCreds.clientId && (td.providerCreds as any).hasSecret);
    if (!hasCreds) {
      return `
        <details class="connector-add-row">
          <summary class="link-btn connector-add-cta">+ ${verb} Outlook account</summary>
          <p class="connector-hint" style="margin-top:8px;">
            To connect Outlook, enter your Azure app credentials below first.
          </p>
          ${renderMicrosoftCredsForm(td.providerCreds, td.setupGuideMarkdown)}
        </details>
      `;
    }
    return `
      <div class="connector-add-row">
        <a class="link-btn connector-add-cta" href="/api/auth/microsoft/start?workspaceId=${encodeURIComponent(ws.id)}&addAnother=1" target="_blank">
          + ${verb} Outlook account ↗
        </a>
        <details class="connector-creds-update">
          <summary class="link-btn muted">Configure app credentials</summary>
          ${renderMicrosoftCredsForm(td.providerCreds, td.setupGuideMarkdown)}
        </details>
      </div>
    `;
  }

  // API-key — always show the inline form. Collapsed by default; user clicks to connect.
  return `
    <details class="connector-add-row">
      <summary class="link-btn connector-add-cta">+ ${verb} ${escapeHtml(td.title)}</summary>
      <form class="connector-apikey-form connector-add-form" data-form="apikey-connect"
            data-ws="${escapeHtml(ws.id)}" data-type="${td.type}" data-add-another="1">
        ${renderSetupGuide({ key: `${td.type}-add-creds`, title: td.title, markdown: td.setupGuideMarkdown })}
        ${td.fields.map(f => renderApiKeyInput(f, undefined)).join("")}
        <div class="connector-form-actions">
          <button type="submit" class="header-btn primary">Add ${escapeHtml(td.title)}</button>
        </div>
      </form>
    </details>
  `;
}

type OAuthProviderCreds = { clientId: string | null; clientSecret: string | null; hasSecret: boolean; redirectUri: string | null };
type FieldDef = {
  name: string;
  label: string;
  type: "text" | "password";
  configKey: string | null;
  placeholder?: string;
  helperText?: string;
  /** When true, pasting a full URL auto-strips it to the relevant slug or ID. */
  stripUrl?: boolean;
};

function connectorBlock(
  title: string,
  color: string,
  content: string,
  statusSummary: string,
  summaryClass: "ok" | "warn" | "muted" = "muted",
  collapseKey = "",
): string {
  const open = collapseKey ? isOpen(collapseKey) : false;
  const keyAttr = collapseKey ? ` data-collapse-key="${escapeHtml(collapseKey)}"` : "";
  return `
    <details class="connector-block"${keyAttr} ${open ? "open" : ""}>
      <summary class="connector-block-head">
        <span class="connector-dot" style="background:${color}"></span>
        <span class="connector-block-title">${escapeHtml(title)}</span>
        <span class="connector-summary-status ${summaryClass}">${escapeHtml(statusSummary)}</span>
        <span class="connector-chevron">▸</span>
      </summary>
      <div class="connector-block-body">${content}</div>
    </details>
  `;
}

// ---------- Workspace form ----------

function wsForm(initial?: Workspace): string {
  const isEdit = !!initial;
  // Normalize stored color against the palette; fall back to Teal default.
  const rawColor = initial?.color || "#2A9D8F";
  const initialColor = PALETTE_HEXES.has(rawColor.toLowerCase()) ? rawColor : "#2A9D8F";
  const initialName  = initial?.name || "";
  const initialWeb   = initial?.website || "";
  const initialLogo  = initial?.logoUrl || "";
  return `
    <form class="settings-form ws-form-smart" data-form="${isEdit ? "ws-edit" : "ws-new"}"
          ${isEdit ? `data-id="${escapeHtml(initial!.id)}"` : ""}
          data-ws-name="${escapeHtml(initialName)}"
          data-ws-color="${escapeHtml(initialColor)}">
      <div class="ws-form-grid">
        <div class="ws-form-fields">
          <label>
            <span class="form-label-text">Name</span>
            <input name="name" required value="${escapeHtml(initialName)}" placeholder="e.g. Personal, Work, Acme Inc." data-ws-input="name" />
            <span class="form-help">Shown in the workspace switcher and as the section header below.</span>
          </label>
          <label>
            <span class="form-label-text">Company / project website <span class="muted">(optional)</span></span>
            <input name="website" type="url" value="${escapeHtml(initialWeb)}" placeholder="e.g. expensepoint.com" data-ws-input="website" autocomplete="off" />
            <span class="form-help">We'll auto-fetch the official logo. Leave blank for a clean monogram fallback.</span>
          </label>
          <label>
            <span class="form-label-text">Icon <span class="muted">(optional)</span></span>
            <input name="icon" maxlength="4" value="${initial?.icon ? escapeHtml(initial.icon) : ""}" placeholder="🚀" />
            <span class="form-help">Short emoji shown when no logo is available.</span>
          </label>
          <div class="form-field">
            <span class="form-label-text">Accent color</span>
            <input name="color" type="hidden" value="${initialColor}" data-ws-input="color" />
            <div class="swatch-grid" role="radiogroup" aria-label="Accent color" data-ws-swatch-grid>
              ${ACCENT_PALETTE.map(p => `
                <button
                  type="button"
                  class="swatch ${p.hex.toLowerCase() === initialColor.toLowerCase() ? "is-selected" : ""}"
                  role="radio"
                  aria-checked="${p.hex.toLowerCase() === initialColor.toLowerCase() ? "true" : "false"}"
                  aria-label="${escapeHtml(p.name)}"
                  title="${escapeHtml(p.name)}"
                  data-ws-swatch="${escapeHtml(p.hex)}"
                  style="--swatch:${escapeHtml(p.hex)}"
                ></button>
              `).join("")}
            </div>
            <span class="form-help">Drives the monogram fallback and the workspace's accent stripe.</span>
          </div>
        </div>
        <div class="ws-logo-preview-card" data-ws-logo-preview>
          <div class="ws-logo-preview-frame" data-ws-logo-frame>
            <span class="ws-logo-preview-spinner" hidden></span>
            <img class="ws-logo-preview-img" alt="Logo preview" data-ws-logo-img />
          </div>
          <div class="ws-logo-preview-meta">
            <span class="ws-logo-preview-source muted" data-ws-logo-source>Monogram fallback</span>
            <button type="button" class="link-btn" data-ws-logo-action="toggle">Use monogram instead</button>
          </div>
          <input type="hidden" name="logoUrl" value="${escapeHtml(initialLogo)}" data-ws-input="logoUrl" />
          <input type="hidden" name="forceMonogram" value="${initial && initial.website && !initial.logoUrl ? "1" : ""}" data-ws-input="forceMonogram" />
        </div>
      </div>
      ${isEdit ? "" : `
        <label class="settings-checkbox">
          <input name="isDefault" type="checkbox">
          <span>Set as default workspace</span>
        </label>
      `}
      <div class="settings-form-actions">
        <button type="submit" class="btn-primary">${isEdit ? "Save changes" : "Create workspace"}</button>
        <button type="button" class="btn-ghost" data-action="form-cancel">Cancel</button>
      </div>
    </form>
  `;
}

// Wires the live logo preview inside a workspace form. Debounced fetch of the
// website field; cycles through Clearbit → Google favicons → monogram. The
// resolved URL (or empty for monogram) is written to the hidden `logoUrl` input
// so submit just reads form values.
function bindLogoPreview(form: HTMLFormElement): void {
  const nameInput  = form.querySelector<HTMLInputElement>('[data-ws-input="name"]')!;
  const webInput   = form.querySelector<HTMLInputElement>('[data-ws-input="website"]')!;
  const colorInput = form.querySelector<HTMLInputElement>('[data-ws-input="color"]')!;
  const logoHidden = form.querySelector<HTMLInputElement>('[data-ws-input="logoUrl"]')!;
  const forceFlag  = form.querySelector<HTMLInputElement>('[data-ws-input="forceMonogram"]')!;
  const frame      = form.querySelector<HTMLElement>('[data-ws-logo-frame]')!;
  const img        = form.querySelector<HTMLImageElement>('[data-ws-logo-img]')!;
  const spinner    = form.querySelector<HTMLElement>('.ws-logo-preview-spinner')!;
  const sourceLbl  = form.querySelector<HTMLElement>('[data-ws-logo-source]')!;
  const toggleBtn  = form.querySelector<HTMLElement>('[data-ws-logo-action="toggle"]')!;

  let timer: number | null = null;
  let probeId = 0;

  function showMonogram(reason: string) {
    const mono = monogramDataUrl(nameInput.value || "Workspace", colorInput.value || null, 128);
    img.src = mono;
    img.classList.add("is-monogram");
    logoHidden.value = ""; // empty → app uses monogram everywhere.
    sourceLbl.textContent = reason;
    spinner.setAttribute("hidden", "");
    toggleBtn.textContent = forceFlag.value === "1" ? "Try fetching logo" : "Use monogram instead";
  }

  function showFetched(url: string, label: string) {
    img.src = url;
    img.classList.remove("is-monogram");
    logoHidden.value = url;
    sourceLbl.textContent = label;
    spinner.setAttribute("hidden", "");
    toggleBtn.textContent = "Use monogram instead";
  }

  // Probe the candidate list; first one whose <img> loads wins. Falls back to
  // monogram when none succeeds.
  function probe(domain: string) {
    const myProbe = ++probeId;
    spinner.removeAttribute("hidden");
    sourceLbl.textContent = `Looking up ${domain}…`;
    const candidates = buildLogoCandidates(domain);
    let i = 0;
    const tryNext = () => {
      if (myProbe !== probeId) return; // a newer probe started; abandon.
      if (i >= candidates.length) { showMonogram("No logo found — using monogram"); return; }
      const url = candidates[i++];
      const test = new Image();
      test.onload = () => {
        if (myProbe !== probeId) return;
        const isClearbit = url.startsWith("https://logo.clearbit.com/");
        showFetched(url, isClearbit ? `Logo · clearbit.com` : `Favicon · google.com`);
      };
      test.onerror = tryNext;
      test.src = url;
    };
    tryNext();
  }

  function refresh() {
    if (forceFlag.value === "1") { showMonogram("Monogram (manual override)"); return; }
    const dom = domainFromUrl(webInput.value);
    if (!dom) { showMonogram("Monogram fallback"); return; }
    probe(dom);
  }

  // Initial paint — preserves saved logo when editing.
  if (logoHidden.value && forceFlag.value !== "1") {
    showFetched(logoHidden.value, "Saved logo");
  } else {
    refresh();
  }

  webInput.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    forceFlag.value = "";
    timer = window.setTimeout(refresh, 350);
  });
  nameInput.addEventListener("input",  () => { if (forceFlag.value === "1" || !logoHidden.value) refresh(); });
  const swatchGrid = form.querySelector<HTMLElement>('[data-ws-swatch-grid]');
  swatchGrid?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ws-swatch]');
    if (!btn) return;
    const hex = btn.dataset.wsSwatch || "";
    if (!hex) return;
    colorInput.value = hex;
    swatchGrid.querySelectorAll<HTMLElement>('[data-ws-swatch]').forEach(s => {
      const on = s === btn;
      s.classList.toggle("is-selected", on);
      s.setAttribute("aria-checked", on ? "true" : "false");
    });
    if (forceFlag.value === "1" || !logoHidden.value) refresh();
  });
  toggleBtn.addEventListener("click", () => {
    if (forceFlag.value === "1") {
      forceFlag.value = "";
      refresh();
    } else {
      forceFlag.value = "1";
      showMonogram("Monogram (manual override)");
    }
  });
}

// ============================================================
// PREFERENCES TAB
// ============================================================

async function renderPreferences(): Promise<string> {
  const theme    = (document.documentElement.getAttribute("data-theme") || "light") as "light" | "dark";
  const interval = (getSetting<number>("autoRefreshMs") || 5 * 60 * 1000) / 1000 / 60;

  let brandName = "", brandSubtitle = "";
  let primaryTz = "Africa/Cairo";
  let secondaryTzs: { tz: string; label: string }[] = [];
  try {
    const app = await api.appSettingsGet();
    brandName     = app.data.brand?.name     ?? "";
    brandSubtitle = app.data.brand?.subtitle ?? "";
    primaryTz     = app.data.prefs?.primaryTz ?? primaryTz;
    secondaryTzs  = app.data.prefs?.secondaryTzs ?? [];
  } catch { /* fall through with defaults */ }

  const secondaryRows = [0, 1, 2].map(i => {
    const cur = secondaryTzs[i];
    const tz  = cur?.tz || "";
    return `
      <div class="settings-tz-row">
        <input name="tz" class="pref-input" type="text" placeholder="e.g. Asia/Riyadh" value="${escapeHtml(tz)}" data-tz-input aria-label="Time zone ${i + 1}" />
        <span class="settings-tz-preview" data-tz-preview aria-label="Auto-derived label">${escapeHtml(deriveTzLabel(tz))}</span>
      </div>
    `;
  }).join("");

  const ianaHelp = `
    <div class="iana-help">
      <strong>What's an IANA name?</strong> A time zone identifier in the form
      <code>Region/City</code> — e.g. <code>Asia/Riyadh</code>, <code>Europe/London</code>,
      <code>America/New_York</code>. It's the standard the whole world uses and handles
      daylight saving automatically.<br>
      <strong>How to find one:</strong> search "<em>IANA timezone &lt;your city&gt;</em>" or
      check <code>en.wikipedia.org/wiki/List_of_tz_database_time_zones</code>.
    </div>
  `;

  return `
    <div class="settings-prefs">

      <details class="pref-group" data-collapse-key="pref-branding" ${isOpen("pref-branding") ? "open" : ""}>
        <summary class="pref-group-head">
          <span class="pref-group-chevron">▸</span>
          <span class="pref-group-icon" data-icon="sparkles"></span>
          <div>
            <h3 class="pref-group-title">Branding</h3>
            <p class="pref-group-desc">Customize how the dashboard identifies itself in the browser tab and header.</p>
          </div>
        </summary>
        <div class="pref-group-body">

          <div class="settings-pref-row">
            <div class="settings-pref-label">
              <label for="pref-brand-name">Project name</label>
              <span class="muted">Shown in the browser tab and the dashboard header. Leave blank to use the default.</span>
            </div>
            <div class="settings-pref-control">
              <form data-form="brand-update" class="pref-inline-form">
                <input id="pref-brand-name" class="pref-input" name="brand.name" type="text" value="${escapeHtml(brandName)}" placeholder="${escapeHtml(DEFAULT_BRAND_NAME)}" />
                <button type="submit" class="btn-primary">Save</button>
              </form>
            </div>
          </div>

          <div class="settings-pref-row">
            <div class="settings-pref-label">
              <label for="pref-brand-subtitle">Header subtitle</label>
              <span class="muted">Optional second line under the greeting — owner name, team, tenant, etc.</span>
            </div>
            <div class="settings-pref-control">
              <form data-form="brand-update" class="pref-inline-form">
                <input id="pref-brand-subtitle" class="pref-input" name="brand.subtitle" type="text" value="${escapeHtml(brandSubtitle)}" placeholder="(none)" />
                <button type="submit" class="btn-primary">Save</button>
              </form>
            </div>
          </div>

        </div>
      </details>

      <details class="pref-group" data-collapse-key="pref-timezones" ${isOpen("pref-timezones") ? "open" : ""}>
        <summary class="pref-group-head">
          <span class="pref-group-chevron">▸</span>
          <span class="pref-group-icon" data-icon="clock"></span>
          <div>
            <h3 class="pref-group-title">Time zones</h3>
            <p class="pref-group-desc">Set your primary time zone and add up to three world clocks for teammates abroad.</p>
          </div>
        </summary>
        <div class="pref-group-body">

          <div class="settings-pref-row">
            <div class="settings-pref-label">
              <label for="pref-primary-tz">Primary time zone</label>
              <span class="muted">Drives the main clock, header date, and timestamp formatting.</span>
            </div>
            <div class="settings-pref-control">
              <form data-form="primary-tz-update" class="pref-inline-form">
                <input id="pref-primary-tz" class="pref-input" name="prefs.primaryTz" type="text" value="${escapeHtml(primaryTz)}" placeholder="Africa/Cairo" />
                <button type="submit" class="btn-primary">Save</button>
              </form>
            </div>
          </div>

          <div class="settings-pref-row pref-row--stacked">
            <div class="settings-pref-label">
              <span>Secondary clocks</span>
              <span class="muted">Up to 3 small clocks shown to the right of the main clock. Leave a row blank to drop it.</span>
            </div>
            <div class="settings-pref-control pref-control--stacked">
              <form data-form="secondary-tzs-update" class="pref-stacked-form">
                ${secondaryRows}
                <div class="pref-stacked-actions">
                  <button type="submit" class="btn-primary">Save secondary clocks</button>
                  <span class="muted pref-hint-inline">3-letter label is auto-derived from the IANA name.</span>
                </div>
                ${ianaHelp}
              </form>
            </div>
          </div>

        </div>
      </details>

      <details class="pref-group" data-collapse-key="pref-display" ${isOpen("pref-display") ? "open" : ""}>
        <summary class="pref-group-head">
          <span class="pref-group-chevron">▸</span>
          <span class="pref-group-icon" data-icon="palette"></span>
          <div>
            <h3 class="pref-group-title">Display</h3>
            <p class="pref-group-desc">Tune the look and feel. Changes apply instantly — no save required.</p>
          </div>
        </summary>
        <div class="pref-group-body">

          <div class="settings-pref-row">
            <div class="settings-pref-label">
              <span>Theme</span>
              <span class="muted">Light is for daytime focus; dark reduces eye strain in low light. Follows system if you've never picked one.</span>
            </div>
            <div class="settings-pref-control">
              <div class="pref-segmented" role="radiogroup" aria-label="Theme">
                <button class="pref-toggle ${theme === "light" ? "active" : ""}" data-pref="theme" data-value="light"  role="radio" aria-checked="${theme === "light"}">Light</button>
                <button class="pref-toggle ${theme === "dark"  ? "active" : ""}" data-pref="theme" data-value="dark"   role="radio" aria-checked="${theme === "dark"}">Dark</button>
              </div>
            </div>
          </div>

        </div>
      </details>

      <details class="pref-group" data-collapse-key="pref-sync" ${isOpen("pref-sync") ? "open" : ""}>
        <summary class="pref-group-head">
          <span class="pref-group-chevron">▸</span>
          <span class="pref-group-icon" data-icon="refresh"></span>
          <div>
            <h3 class="pref-group-title">Sync</h3>
            <p class="pref-group-desc">Background refresh keeps cards fresh without you lifting a finger.</p>
          </div>
        </summary>
        <div class="pref-group-body">

          <div class="settings-pref-row">
            <div class="settings-pref-label">
              <label for="pref-autorefresh">Auto-refresh interval</label>
              <span class="muted">Shorter intervals stay current but use more API quota. 5 minutes is a sensible default.</span>
            </div>
            <div class="settings-pref-control">
              <select id="pref-autorefresh" class="pref-input pref-select" data-pref="autoRefreshMs" data-unit="ms-from-min">
                <option value="1"  ${interval === 1  ? "selected" : ""}>1 minute</option>
                <option value="5"  ${interval === 5  ? "selected" : ""}>5 minutes</option>
                <option value="10" ${interval === 10 ? "selected" : ""}>10 minutes</option>
                <option value="15" ${interval === 15 ? "selected" : ""}>15 minutes</option>
                <option value="30" ${interval === 30 ? "selected" : ""}>30 minutes</option>
              </select>
            </div>
          </div>

        </div>
      </details>

    </div>
  `;
}

// ============================================================
// EVENT HANDLERS
// ============================================================

async function onSettingsClick(e: Event) {
  const t = e.target as HTMLElement;

  // Preference segmented buttons (theme). They have no data-action,
  // so handle them BEFORE the data-action guard below.
  const prefBtn = t.closest<HTMLElement>("[data-pref][data-value]");
  if (prefBtn) {
    e.preventDefault();
    const pref  = prefBtn.dataset.pref!;
    const value = prefBtn.dataset.value!;
    applyPref(pref, value);
    return;
  }

  const btn    = t.closest<HTMLElement>("[data-action]");
  const action = btn?.dataset.action;
  if (!action) return;

  // Checkbox/radio toggles use data-action too (instance-share-toggle,
  // shared-enroll-toggle). They're handled by onSettingsChange — bail out so
  // we don't preventDefault the click and freeze the input in place.
  if (btn instanceof HTMLInputElement && (btn.type === "checkbox" || btn.type === "radio")) {
    return;
  }

  e.preventDefault();

  const id = btn?.dataset.id;

  if (action === "copy-code") {
    const pre = btn?.closest("pre");
    const code = pre?.querySelector("code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(code);
      const original = btn!.textContent;
      btn!.textContent = "✓";
      setTimeout(() => { if (btn) btn.textContent = original ?? "⧉"; }, 1200);
    } catch {
      // Clipboard unavailable — silent. Users can still select-and-copy manually.
    }
    return;
  }

  if (action === "pw-toggle") {
    const wrap  = btn?.closest(".pw-wrap");
    const input = wrap?.querySelector<HTMLInputElement>("input");
    if (input) {
      input.type      = input.type === "password" ? "text" : "password";
      btn!.textContent = input.type === "password" ? "👁" : "🙈";
    }
    return;
  }

  try {
    switch (action) {
      case "ws-new": {
        const slot = document.querySelector<Element>('[data-slot="ws-form"]');
        if (slot) { slot.innerHTML = wsForm(); bindLogoPreview(slot.querySelector<HTMLFormElement>("form")!); }
        break;
      }
      case "ws-edit": {
        if (!id) return;
        const list = await api.workspaces();
        const ws   = list.data.workspaces.find(w => w.id === id);
        if (!ws) return;
        const card = document.querySelector<HTMLDetailsElement>(`details[data-ws-id="${id}"]`);
        const slot = card?.querySelector<Element>(`[data-slot="ws-form-${id}"]`);
        if (slot) { slot.innerHTML = wsForm(ws); bindLogoPreview(slot.querySelector<HTMLFormElement>("form")!); }
        if (card && !card.open) card.open = true;
        // Bring the form into view so the user sees it land instead of guessing where it went.
        requestAnimationFrame(() => {
          const form = slot?.querySelector<HTMLElement>("form");
          form?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          form?.querySelector<HTMLInputElement>('[data-ws-input="name"]')?.focus({ preventScroll: true });
        });
        break;
      }
      case "ws-default": {
        if (!id) return;
        await api.workspaceUpdate(id, { isDefault: true });
        await refreshActiveWorkspace();
        await render();
        break;
      }
      case "ws-delete": {
        if (!id) return;
        if (!confirm("Delete this workspace and all its connectors?")) return;
        await api.workspaceDelete(id);
        await refreshActiveWorkspace();
        await render();
        break;
      }
      case "form-cancel": {
        t.closest("form, .settings-form-wrap")?.remove();
        break;
      }

      case "instance-disconnect": {
        const ciId = btn?.dataset.ci;
        if (!ciId) return;
        // Find live state to (a) shape the confirm prompt with sharing impact,
        // and (b) decide between unlink-identity (slack/gcal — keep the slot)
        // vs delete-row (outlook/apikey — every row IS one account).
        const all = await api.connectors();
        const cur = all.data.find(c => c.id === ciId);
        const enrolledList = Array.isArray((cur?.config as any)?.enabledWorkspaces)
          ? ((cur!.config as any).enabledWorkspaces as string[])
          : [];
        const otherEnrolled = cur ? enrolledList.filter(id => id !== cur.workspaceId).length : 0;
        const msg = cur?.shared && otherEnrolled
          ? `Disconnect this account?\n\nIt's currently shared with ${otherEnrolled} other workspace${otherEnrolled === 1 ? "" : "s"} — they'll lose access too.`
          : "Disconnect this account?";
        if (!confirm(msg)) return;
        // Outlook + API-key types: each connector row is one account → delete.
        // Slack/gcal: a row can be reconnected to a different identity → unlink.
        const deleteRow = cur && (cur.type === "outlook" || ["github", "jira", "notion", "clickup"].includes(cur.type));
        if (deleteRow) await api.connectorDelete(ciId);
        else           await api.connectorUpdate(ciId, { identityId: null });
        await render();
        window.dispatchEvent(new CustomEvent("workspace-changed"));
        return;
      }

      case "watched-add": {
        // Insert a blank row into the editor form (in-DOM only; saved on submit).
        const ciId = btn?.dataset.ci;
        if (!ciId) return;
        const includeStatus = btn?.dataset.includeStatus === "true";
        const form = document.querySelector<HTMLFormElement>(`form[data-form="watched-users-save"][data-ci="${CSS.escape(ciId)}"]`);
        if (!form) return;
        const actions = form.querySelector(".watched-users-actions");
        const row = document.createElement("div");
        row.className = "watched-user-row";
        const newIdx = form.querySelectorAll(".watched-user-row").length;
        row.dataset.watchedIdx = String(newIdx);
        const statusField = includeStatus
          ? `<input class="watched-input watched-input--narrow" name="status" placeholder="Status filter (opt.)" value="" />`
          : "";
        row.innerHTML = `
          <input class="watched-input" name="label" placeholder="Tab label" value="" />
          <input class="watched-input" name="query" placeholder="Name, email, or ID" value="" />
          ${statusField}
          <label class="watched-hide-closed" title="When checked, closed / done tickets are excluded from this tab">
            <input type="checkbox" name="hideClosed" checked />
            <span>Hide closed</span>
          </label>
          <button type="button" class="link-btn danger" data-action="watched-remove" data-ci="${escapeHtml(ciId)}" data-idx="${newIdx}" title="Remove">✕</button>
        `;
        if (actions) form.insertBefore(row, actions); else form.appendChild(row);
        form.parentElement?.querySelector<HTMLElement>(".watched-empty")?.remove();
        row.querySelector<HTMLInputElement>('input[name="label"]')?.focus();
        break;
      }

      case "watched-remove": {
        // Remove a row from the editor (in-DOM only; saved on submit).
        const ciId = btn?.dataset.ci;
        if (!ciId) return;
        const row = btn?.closest<HTMLElement>(".watched-user-row");
        row?.remove();
        break;
      }
    }
  } catch (err: any) {
    alert(`Failed: ${err.message || err}`);
  }
}

async function onSettingsSubmit(e: Event) {
  const form = e.target as HTMLFormElement;
  if (!form.matches("form[data-form]")) return;
  e.preventDefault();
  const kind = form.dataset.form!;
  const fd   = new FormData(form);
  const id   = form.dataset.id;

  try {
    switch (kind) {
      case "ws-new":
        await api.workspaceCreate({
          name:      String(fd.get("name") || ""),
          icon:      (fd.get("icon") as string) || null,
          color:     (fd.get("color") as string) || null,
          website:   ((fd.get("website") as string) || "").trim() || null,
          logoUrl:   ((fd.get("logoUrl") as string) || "").trim() || null,
          isDefault: fd.get("isDefault") === "on",
        });
        await refreshActiveWorkspace();
        break;

      case "ws-edit":
        if (!id) return;
        await api.workspaceUpdate(id, {
          name:    String(fd.get("name") || ""),
          icon:    (fd.get("icon") as string) || null,
          color:   (fd.get("color") as string) || null,
          website: ((fd.get("website") as string) || "").trim() || null,
          logoUrl: ((fd.get("logoUrl") as string) || "").trim() || null,
        });
        await refreshActiveWorkspace();
        break;

      case "primary-tz-update": {
        const tz = String(fd.get("prefs.primaryTz") || "").trim();
        if (!tz) { alert("Time zone is required."); return; }
        const res = await api.appSettingsPut({ "prefs.primaryTz": tz });
        setTimezones(res.data.prefs.primaryTz, res.data.prefs.secondaryTzs);
        break;
      }

      case "secondary-tzs-update": {
        const tzs   = fd.getAll("tz").map(x => String(x).trim());
        const items = tzs.filter(Boolean).map(tz => ({ tz, label: "" }));
        const res = await api.appSettingsPut({ "prefs.secondaryTzs": items });
        setTimezones(res.data.prefs.primaryTz, res.data.prefs.secondaryTzs);
        await render();
        return;
      }

      case "brand-update": {
        const patch: Record<string, string> = {};
        for (const [k, v] of fd.entries()) {
          if ((k === "brand.name" || k === "brand.subtitle") && typeof v === "string") patch[k] = v;
        }
        const res = await api.appSettingsPut(patch);
        applyBrand(res.data.brand);
        break;
      }

      case "app-creds-inline": {
        const patch: Record<string, string> = {};
        for (const [k, v] of fd.entries()) {
          if (typeof v === "string" && v !== "") patch[k] = v;
        }
        await api.appSettingsPut(patch);
        break;
      }

      case "apikey-connect": {
        const wsId       = form.dataset.ws;
        const type       = form.dataset.type;
        const connectorId = form.dataset.ci || undefined;
        const addAnother  = form.dataset.addAnother === "1";
        if (!wsId || !type) return;

        const token   = String(fd.get("token") || "");
        const account = (fd.get("account") as string) || undefined;

        // Build config object from remaining fields.
        const config: Record<string, unknown> = {};
        const SPECIAL = new Set(["token", "account"]);
        for (const [k, v] of fd.entries()) {
          if (!SPECIAL.has(k) && typeof v === "string" && v !== "") {
            config[k] = (k === "databaseIds" || k === "spaceIds")
              ? v.split(",").map(s => s.trim()).filter(Boolean)
              : v;
          }
        }

        if (token) {
          await api.workspaceConnect(wsId, { type, token, account, config, connectorId, addAnother });
        } else if (connectorId && Object.keys(config).length) {
          await api.connectorUpdate(connectorId, { config });
        } else if (!connectorId && Object.keys(config).length) {
          const wsList = await api.workspace(wsId);
          const existing = wsList.data.connectors.find(c => c.type === type && c.source !== "shared");
          if (existing) await api.connectorUpdate(existing.id, { config });
        }
        // Notify the rest of the app so connector visibility refreshes.
        window.dispatchEvent(new CustomEvent("workspace-changed", { detail: { workspaceId: wsId } }));
        break;
      }

      case "connector-clone-save": {
        const ciId = form.dataset.ci;
        if (!ciId) return;
        const cloningEnabled       = fd.get("cloningEnabled") === "on";
        const defaultTargetProject = String(fd.get("defaultTargetProject") || "");
        const allConns = await api.connectors();
        const cur = allConns.data.find(c => c.id === ciId);
        if (!cur) return;
        const newConfig = { ...cur.config, cloningEnabled, defaultTargetProject };
        await api.connectorUpdate(ciId, { config: newConfig });
        window.dispatchEvent(new CustomEvent("workspace-changed"));
        break;
      }

      case "watched-users-save": {
        const ciId = form.dataset.ci;
        if (!ciId) return;
        // Look up the live connector so we can merge into its existing config.
        const all = await api.connectors();
        const cur = all.data.find(c => c.id === ciId);
        if (!cur) return;

        const watchedUsers: StoredWatchedUser[] = [];
        const seenIds = new Set<string>();
        const existingUsers = Array.isArray((cur.config as any).watchedUsers)
          ? (cur.config as any).watchedUsers as StoredWatchedUser[]
          : [];

        form.querySelectorAll<HTMLElement>(".watched-user-row").forEach((row, idx) => {
          const label      = (row.querySelector<HTMLInputElement>('input[name="label"]')?.value || "").trim();
          const query      = (row.querySelector<HTMLInputElement>('input[name="query"]')?.value || "").trim();
          const status     = (row.querySelector<HTMLInputElement>('input[name="status"]')?.value || "").trim();
          const hideClosed = row.querySelector<HTMLInputElement>('input[name="hideClosed"]')?.checked ?? true;
          if (!label || !query) return;
          let id = existingUsers[idx]?.id || slugifyLabel(label);
          if (seenIds.has(id)) id = `${id}-${idx}`;
          seenIds.add(id);
          const entry: StoredWatchedUser = { id, label, query, hideClosed };
          if (status) entry.status = status;
          watchedUsers.push(entry);
        });

        const merged = { ...(cur.config || {}), watchedUsers };
        await api.connectorUpdate(ciId, { config: merged });
        // Tickets card listens to workspace-changed → refetches and rebuilds tabs.
        window.dispatchEvent(new CustomEvent("workspace-changed"));
        break;
      }
    }
    await render();
  } catch (err: any) {
    alert(`Failed: ${err.message || err}`);
  }
}

async function onSettingsChange(e: Event) {
  const el = e.target as HTMLInputElement;

  // Per-instance "Share with other workspaces" toggle (owned connector).
  if (el.dataset.action === "instance-share-toggle") {
    const ciId = el.dataset.ci;
    if (!ciId) return;

    // Surface the consequence of disabling sharing: ALL current enrollments
    // are dropped, and they will NOT be auto-restored if sharing is re-enabled
    // later — every workspace has to opt back in. We confirm only when the
    // user is turning sharing OFF and at least one workspace is actively
    // enrolled, so the silent on→off→on round-trip can't surprise them.
    if (!el.checked) {
      const cur = (await api.connectors()).data.find(c => c.id === ciId);
      const enrolled = Array.isArray((cur?.config as any)?.enabledWorkspaces)
        ? ((cur!.config as any).enabledWorkspaces as string[]).filter(id => id !== cur!.workspaceId)
        : [];
      if (enrolled.length > 0) {
        const msg = `Turning off sharing now will disconnect ${enrolled.length} workspace${enrolled.length === 1 ? "" : "s"} that are using this connector.\n\nIf you turn sharing back on later, those workspaces will NOT be auto-restored — each will have to opt in again.\n\nContinue?`;
        if (!confirm(msg)) {
          el.checked = true;
          return;
        }
      }
    }

    try {
      await api.connectorUpdate(ciId, { shared: el.checked });
      await render();
      // Sharing flipped — every workspace's effective connector list just
      // changed. Force the active dashboard to reload connectors, re-evaluate
      // visibility, and re-render per-instance cards. Without this, a card
      // surfaced via the just-revoked share keeps showing on screen until the
      // user manually switches workspaces or reloads the page.
      const { getActiveWorkspaceId } = await import("./workspace-switcher.js");
      window.dispatchEvent(new CustomEvent("workspace-changed", { detail: { workspaceId: getActiveWorkspaceId() } }));
    } catch (err: any) {
      alert(`Failed: ${err.message || err}`);
      el.checked = !el.checked;
    }
    return;
  }

  // Per-instance "Show in Overview" toggle (owned connector).
  if (el.dataset.action === "instance-overview-toggle") {
    const ciId = el.dataset.ci;
    if (!ciId) return;
    try {
      await api.connectorUpdate(ciId, { shareWithOverview: el.checked });
      await render();
      // Overview surfaces this connector now/no longer — refresh the dashboard if Overview is active.
      window.dispatchEvent(new CustomEvent("workspace-changed", { detail: { workspaceId: null } }));
    } catch (err: any) {
      alert(`Failed: ${err.message || err}`);
      el.checked = !el.checked;
    }
    return;
  }

  // Shared-connector enrollment toggle.
  if (el.dataset.action === "shared-enroll-toggle") {
    const ws = el.dataset.ws;
    const ci = el.dataset.ci;
    if (!ws || !ci) return;
    try {
      await api.workspaceSharedEnrollment(ws, ci, el.checked);
      await render();
      window.dispatchEvent(new CustomEvent("workspace-changed", { detail: { workspaceId: ws } }));
    } catch (err: any) {
      alert(`Failed: ${err.message || err}`);
      el.checked = !el.checked;
    }
    return;
  }

  const sel  = el as unknown as HTMLSelectElement;
  const pref = el.closest<HTMLElement>("[data-pref]")?.dataset.pref;
  const unit = el.closest<HTMLElement>("[data-unit]")?.dataset.unit;
  if (!pref) return;
  let value: string | number = sel.value;
  if (unit === "ms-from-min") value = Number(sel.value) * 60 * 1000;
  applyPref(pref, value);
}

function onSettingsPaste(e: ClipboardEvent) {
  const el = e.target as HTMLInputElement;
  if (!(el instanceof HTMLInputElement) || !el.dataset.stripUrl) return;
  const text = (e.clipboardData?.getData("text") || "").trim();
  if (!text.includes("/") && !text.startsWith("http")) return;

  let cleaned = text;
  try {
    const url = new URL(text.startsWith("http") ? text : `https://${text}`);
    const name = el.getAttribute("name");
    if (name === "repo") {
      // github.com/owner/repo → owner/repo
      const parts = url.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
      cleaned = parts.slice(0, 2).join("/");
    } else if (name === "baseUrl") {
      // https://acme.atlassian.net/... → acme.atlassian.net
      cleaned = url.hostname;
    } else if (name === "teamId") {
      // https://app.clickup.com/12345678/... → 12345678
      const parts = url.pathname.replace(/^\//, "").split("/");
      cleaned = parts[0] || text;
    } else if (name === "databaseIds") {
      // https://notion.so/workspace/Title-XXXXXXXXXXXXXXXX?v=... → XXXXXXXXXXXXXXXX
      const parts = url.pathname.replace(/^\//, "").split("/");
      const last = parts[parts.length - 1] || "";
      const idMatch = last.match(/([a-f0-9]{32})$/i) || last.match(/[a-f0-9-]{36}$/i);
      cleaned = idMatch ? idMatch[0] : last;
    } else {
      // Generic: strip protocol and trailing slash
      cleaned = url.hostname + url.pathname.replace(/\/$/, "");
    }
  } catch {
    cleaned = text.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }

  if (cleaned === text) return; // nothing to strip — let paste proceed normally
  e.preventDefault();
  el.value = cleaned;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function onSettingsInput(e: Event) {
  const el = e.target as HTMLInputElement;
  if (!el.matches?.("input[data-tz-input]")) return;
  const row = el.closest(".settings-tz-row");
  const preview = row?.querySelector<HTMLElement>("[data-tz-preview]");
  if (preview) preview.textContent = deriveTzLabel(el.value);
}

function applyPref(pref: string, value: string | number) {
  if (pref === "theme") {
    applyTheme(String(value) as "light" | "dark");
  } else if (pref === "autoRefreshMs") {
    saveSetting("autoRefreshMs", Number(value));
  }
  if (activeTab === "preferences") render();
}
