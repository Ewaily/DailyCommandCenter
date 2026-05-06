# Features

## Dashboard modules

### Schedule
- Events merged from Google Calendar and any connected Outlook accounts in a single scrollable timeline, sorted by start time.
- Multiple calendar accounts per workspace supported (Google + one or more Outlook accounts), each with its own source color stripe.
- Filter chips: All · Mine (accepted) · Needs response · Hide focus.
- Day navigation (← Today →) to browse past/future days.
- NOW indicator line shows current time position.
- Badges: NEW today · Respond · Tentative · Declined · Focus.
- Left-stripe color per source identity — different colors per calendar account.
- Meet/Teams/Zoom link extracted and shown inline.
- Powered by: **Google Calendar** + **Microsoft Outlook (Graph API)**.

### Channel Digest
- Latest 5 messages from a configurable list of Slack channels.
- Slack rich-text rendered (mentions, links, bold/italic/code, emoji).
- Powered by: **Slack**.

### Mentions & DMs
- All messages where you were @-mentioned or DM'd in the past N days.
- Urgent flag on direct messages.
- Powered by: **Slack**.

### Tickets
- Your assigned tickets from Jira.
- Status buckets: todo · in progress · in review · blocked · done.
- Priority badges: urgent · high · medium · low.
- **Dynamic watched-teammate tabs**: the "Mine" tab is always shown; every other tab is configured per-Jira-connector per-workspace from Settings → Workspaces → Jira → Watched teammates. Each entry takes a tab label, a Jira identifier (display name, email, or accountId), an optional status filter, and a **Hide closed** toggle. Add or remove any number of teammates — nothing is hardcoded. The active tab persists; if a teammate is removed, the view falls back to "Mine".
- **Result limit**: each tab fetches **all matching tickets** from Jira, paginated 100 per API call. Tickets are ordered by last-updated descending.
- Powered by: **Jira**.

### Pull Requests
- PR command center with four tabs: **Needs Review** (PRs where you're a requested reviewer) · **My PRs** (open PRs you authored) · **All Open** (every open PR in the repo, regardless of author) · **Closed** (recently closed and merged PRs). Each tab shows a live count badge.
- Per-PR status, age, and "waiting on you" flag.
- Powered by: **GitHub**.

---

## Workspaces

Multiple named workspaces, each with its own connector bindings. Switch via the header dropdown or the quick-rail.

- **Create / edit / delete** workspaces from Settings (`,` key → Workspaces). The `+ Add workspace` button is fixed at the top of the tab.
- Each workspace card is collapsible (click the header) so a long list stays scannable. All workspace cards open by default so shared connectors are visible in every workspace.
- Each workspace specifies which identity to use for GitHub, Jira, Notion, ClickUp, and Calendar.
- **Auto-select**: with exactly one workspace, the dashboard always opens scoped to it. **Overview** mode appears only when two or more workspaces exist.
- **Overview view** (active workspace = none): a unified dashboard built from connectors that have been *explicitly* shared with Overview by their owner. The header dropdown surfaces it as a featured entry (`✦ Overview`) above a divider, with the byline "Shared connectors across every workspace". When nothing is shared with Overview, the dashboard renders a dedicated empty state explaining how to opt connectors in.
- **Empty by default**: brand-new workspaces start with zero connectors — no inheritance from existing workspaces. Shared connectors from other workspaces appear in every workspace's settings as opt-in (**unchecked by default — zero-trust**). Legacy rows without an `enabledWorkspaces` list default to *not enrolled*, not enrolled-everywhere.
- **Sharing semantics**: every shared connector has an owning workspace (the one that connected it). Two independent toggles per owned connector:
  - **Share with other workspaces** — when on, the connector appears in every other workspace's Settings as opt-in (their enrollment list starts empty). **Toggling this off-then-on never auto-restores prior enrollments**: every share-state change wipes `enabledWorkspaces` to `[]` server-side, so each workspace must explicitly opt in again after the share is re-enabled. Turning sharing off while workspaces are actively enrolled triggers a confirmation dialog warning that those workspaces will be disconnected and won't be auto-restored. The toggle handler also dispatches a `workspace-changed` event so any active dashboard re-evaluates its connector list immediately — a per-instance card surfaced via a now-revoked share disappears without a page reload.
  - **Show in Overview** — when on, the connector's data is pulled into the Overview view. Independent from cross-workspace sharing — a connector can appear in Overview without being visible to any other workspace, and vice versa.
  The seeded Slack row is owned by the default workspace, pre-shared, and pre-marked Show-in-Overview. Legacy "no-owner" rows from older installs are migrated to the default workspace on boot. Existing `shared = 1` connectors are auto-backfilled to `share_with_overview = 1` on first boot of this version so historical Overview behavior is preserved.
- **Per-type connector group UI**: inside each workspace's Settings section, every connector type (Slack, Calendar, GitHub, etc.) renders as one collapsible block with three regions:
  1. **Behavior banner** — reminds the user how data resolves: fan-out (Slack/Google Calendar/Outlook merge data from every active account) vs first-wins (GitHub/Jira/Notion/ClickUp use the workspace's own account when present, falling back to a shared one).
  2. **Shared from other workspaces** — each shared instance is its own card with a prominent "Use this in <workspace>" toggle, an owner badge (read-only — only the owner edits credentials), a conflict hint when the workspace already has its own + this is a fan-out type, and an off-state CTA pointing at "Connect another" when the user wants to break off and use their own.
  3. **<Workspace>'s accounts** — owned instances with credential editing, two stacked per-instance toggles (**Share with other workspaces** and **Show in Overview ✦**, each with its own status note), and a Disconnect action whose confirmation prompt warns when other workspaces depend on the shared connection.
  Below both regions, a single **+ Connect your own / Add another <Type>** action (auto-relabeled based on whether the workspace already has one) creates an additional instance via OAuth `addAnother=1` or an inline API-key form.
- **Connector field micro-copy**: every API-key connector input (GitHub, Jira, Notion, ClickUp) shows a concrete placeholder (e.g. `ghp_xxxxxxxxxxxxxxxxxxxx`, `acme.atlassian.net`) and a helper-text line explaining exactly what the value is and where to find it. Fields that accept slugs or IDs (repo, baseUrl, teamId, databaseIds) auto-strip full URLs on paste — pasting `https://github.com/TrianglZ/my-repo` fills in `TrianglZ/my-repo`.
- **Integration setup guide accordion**: every credentials form (OAuth — Google, Slack, Microsoft; API-key — GitHub, Jira, Notion, ClickUp) now ships with an inline "📖 Need help finding these? View setup guide" disclosure that expands into a full step-by-step walkthrough. Each guide is authored Markdown rendered by [src/frontend/components/integration-setup-guide.ts](src/frontend/components/integration-setup-guide.ts) (headings, ordered/unordered lists, fenced code blocks with one-click copy buttons, links opening in a new tab, blockquotes for warnings). Guides for all seven connectors live in [src/frontend/components/setup-guides.ts](src/frontend/components/setup-guides.ts). The `ConnectorTypeDef` schema in [src/frontend/components/settings.ts](src/frontend/components/settings.ts) requires a `setupGuideMarkdown` property — TypeScript fails the build if a future connector is added without one.
- **Disconnect smart-routing**: API-key and Outlook connectors delete the connector row on disconnect (each row IS one account); Slack/Google Calendar slots only unlink the identity (the slot is reusable).
- **Strict isolation when drilled in**: when a specific workspace is selected in the header, every dashboard card (Schedule, Mentions, Channel digest, Tickets, PRs) only shows that workspace's data. Cards with no connector for the active workspace render a "not configured for this workspace" placeholder instead of falling back to default/`.env` data.
- **Fully connector-driven UI**: the entire dashboard is dynamically composed from the active workspace's connected tools. Every card, KPI tile, and sidebar section is hidden until its connector is present and has a valid identity. A fresh workspace shows a "No tools connected yet" empty state with a direct link into Settings. No skeleton loaders, no placeholder cards, no API calls fire for disconnected tools. Connecting or disconnecting a tool from Settings immediately re-evaluates visibility without a page reload.
- **Card auto-collapse**: cards (PRs, Tickets) are hidden for the active workspace if the required connector is not bound or has no identity.
- **Calendar left-stripe**: schedule rows show a color stripe matching the workspace's Google Calendar connector color.

### Identities

Reusable credentials shared across workspaces. Managed entirely from Settings → Identities.

- **API-key types** (GitHub PAT, Jira API token, Notion token, ClickUp personal token): add/edit/delete via Settings UI — no `.env` required.
- **OAuth types** (Google, Slack, Microsoft): connected per-workspace via the Workspaces tab connect buttons.

### Application settings

Settings → **Application** tab — store OAuth app credentials (Client ID / Client Secret / Redirect URI) in the local DB. Values set here take precedence over any `.env` equivalents. Secrets are write-only and never returned to the browser.

### Time zones

Settings → **Preferences** tab — grouped into four pref-cards (Branding, Time zones, Display, Sync). Each pref-card has an icon, a title, and a short description.

- **Primary time zone** — drives the main clock, AM/PM badge, header date, schedule "Now" line, mention/Slack timestamp formatting (frontend and server). Stored as `prefs.primaryTz` (IANA name).
- **Secondary clocks** — up to three smaller clocks shown to the right of the main clock. Each row is a single IANA timezone input (e.g. `Asia/Riyadh`); the 3-letter label (e.g. `RUH`) is derived from the city on the fly and shown live as a non-editable preview. Stored as `prefs.secondaryTzs`. Leave a row blank to drop it. The Preferences tab includes a short inline explanation of what an IANA name is and how to find one.

Both apply immediately on save (no reload). Invalid IANA names are silently rejected by the API.

### Branding (white-label)

Settings → **Preferences** tab — rename the project for this install:

- **Project name** — drives the browser tab title and the dashboard header `<h1>`. Default: "Daily Command Center".
- **Header subtitle** — optional secondary line under the greeting (owner name, team, tenant). Hidden when blank.

Stored as `brand.name` / `brand.subtitle` keys in the `settings` table via the `/api/app-settings` endpoint. Applied on page load (`applyBrand` in [src/frontend/components/brand.ts](src/frontend/components/brand.ts)) and immediately after a Save in the Preferences tab. The HTML ships with the default name as a fallback if the API call fails.

---

## Header & global controls

| Control | Shortcut | What it does |
|---|---|---|
| Workspace switcher | — | Scopes dashboard to a specific workspace or to **Overview** (cross-workspace) |
| Command palette | `⌘K` | Dynamic, context-aware command hub — see below |
| Refresh all | `R` | Re-fetches every module |
| Toggle theme | `T` | Light ↔ Dark |
| Settings | `,` | Manage workspaces, identities, connectors, preferences, application credentials |
| Customize layout | `E` | Toggle dashboard edit mode (drag/resize widgets, drag-reorder tabs) |

### Smart workspace logos

Each workspace can store a **company / project website**. From that URL, the dashboard auto-fetches an official logo (Clearbit's free Logo API → Google Favicons fallback) and falls back to a generated **monogram badge** built from the workspace's initials over its accent color when nothing's found. The resolved URL is persisted (`workspaces.logo_url` + `workspaces.website` in SQLite) so it travels everywhere the workspace renders:

- **Workspace creation form**: live preview while typing the URL, with a *Use monogram instead* override.
- **Header switcher**: the workspace pill (and dropdown items) shows the logo as a 26 px circular badge in the global header.
- **Settings sections**: each workspace's collapsible head leads with the badge + domain.
- **Overview mode**: every dashboard card-header shows a discreet overlapped cluster of the workspaces contributing data to that card, so mixed feeds stay instantly attributable.

Fetching is purely client-side — no third-party API key, no PII leaves the browser beyond the domain name typed in the form.

### Command palette (`⌘K`)

A fully dynamic command hub rebuilt fresh on every open. Four sections:

| Section | Contents | Reactivity |
|---|---|---|
| **System** | Refresh all · Toggle dark/light · Open Settings · Create new workspace · Show shortcuts | Always shown |
| **Workspaces** | One entry per workspace; Overview entry when 2+ workspaces exist. Active workspace/scope shown with `✓` and "current" meta (visually muted — not re-selectable) | Reads `listWorkspaces()` at open time — instantly reflects workspace creation / deletion without a page reload |
| **Navigation** | Jump commands for each mounted widget (Schedule, Mentions, PRs, Tickets, ClickUp, Channels) | Only appears if the widget is currently visible in the active workspace — if Jira is not connected, "Jump to Tickets" is absent |
| **Content** | Today's calendar events · Open Jira tickets · Open PRs · Slack channels | Scraped from the live DOM at open time |

"Create new workspace" opens Settings to the Workspaces tab and automatically triggers the new-workspace form. Fuzzy search covers all four sections simultaneously.

| Quick Rail | `]` | Slide-in sidebar: next 3 events, recent mentions |
| Help | `?` | Keyboard shortcut reference |
| Jump to Schedule | `G` then `S` | Smooth-scroll |
| Jump to Channels | `G` then `C` | Smooth-scroll |
| Jump to Mentions | `G` then `M` | Smooth-scroll |

### Customizable dashboard layout

The main content area below the header is a single 12-column grid of widgets (Schedule, Mentions & DMs, Pull Requests, Tickets, ClickUp, Channel Digest). Press **Customize** in the header (or `E`) to enter edit mode:

- **Move**: drag a card by its header to a new grid cell.
- **Resize**: drag the right/bottom/left edges or the bottom-right corner handle.
- **Reorder tabs**: drag any tab pill horizontally to reorder it (works outside edit mode too — clicks under 5 px still switch tabs). Applies to GitHub PRs (`Needs Review` / `My PRs` / `All Open` / `Closed`), Jira and ClickUp teammate tabs, and the Mentions filters.
- **Collision-free drop**: dropping a card on top of another pushes the underlying card to the next free slot via top-to-bottom, left-to-right packing — no widget can ever sit hidden behind another.
- **Smart auto-placement**: when a connector is activated mid-session, its widget appears in the next free slot rather than overlapping an existing widget; the workspace's other cards stay where the user left them.
- **Per-workspace layout**: each workspace (and Overview) has its own independent layout — resizing the GitHub card in workspace A never affects workspace B. Switching workspaces unmounts the old layout and remounts the new one.
- **Reset**: the toolbar's *Reset layout* button restores the default arrangement (current scope only) and resets tab order.
- **Persistence**: layouts are stored in `localStorage` under `dcc-dashboard-layout-v2` as a `{ "<workspaceId>" | "__overview__": layout }` map; tab order in `dcc-tab-order-v1`. Pre-v2 single-blob layouts are migrated into the active scope on first load. No server round-trip.
- **Fluid widgets**: each card uses CSS container queries — text, labels, and tab pills compact gracefully as a card is shrunk, and minimum width/height clamps prevent broken layouts. The 16 px grid gap is enforced by CSS Grid; cards cannot bleed into the gutter.

---

## Overview mode

Visible when no specific workspace is selected (requires 2+ workspaces). The header switcher labels it `✦ Overview` and accents the active pill with the brand purple so it never blends in with a workspace pick.

- **Opt-in by connector**: Overview only sees connectors whose owner flipped on **Show in Overview ✦** in Settings. Nothing leaks across workspaces by default.
- **Per-instance strict isolation**: when N > 1 connectors of the same type (e.g. two GitHub connectors from different workspaces, or two GitHub accounts inside the same workspace) are usable in the active scope, the dashboard renders N separate widget cards — one per connector instance — instead of one merged card. This applies in **both** Overview and workspace mode (so a workspace's owned GitHub plus a shared GitHub from another workspace render as two distinct cards). Each card carries the unique `ov-${connectorId}` as its DOM/layout/store key and loads only its own data via `?connectorId=` scoping; cards are placed in a single batch pass against a fresh layout snapshot to guarantee no two cards ever land in the same grid cell. Each card's source label combines `Workspace · account` (e.g. `Vennre · @ewaily`) so two connectors with the same owner remain distinguishable. Per-instance card titles inherit any custom title set in the connector's owning workspace.
- **Full feature parity per instance**: each per-instance card carries the same tab UI as the static workspace card — GitHub gets `Needs Review · My PRs · All Open · Closed` with live counts; Jira and ClickUp render `Mine` plus the connector's watched-user tabs (read directly from the connector's `config.watchedUsers`, so each card shows the watched users from its OWNING workspace, not the active scope's). Each card maintains its OWN active tab state (independent of sibling cards and of the global static-card setting), defaulting on first paint to whatever the user last picked in the static card. Tab counts come from the same per-connector API response that drives the body, so they always agree with the data shown. All five data routes (calendar, slack mentions/digest, prs, tickets, clickup) support `?connectorId` filtering.
- **Capability registry — single source of truth**: every per-instance card behavior (which `connector.type` values map to it, which static widget it replaces, default grid dims, icon, default title, optional tabs (fixed or dynamic from API response), the data fetcher, the row renderer, and the empty-state copy) is declared in **one** `CapabilitySpec` entry in [src/frontend/components/instance-card-registry.ts](src/frontend/components/instance-card-registry.ts). The renderer in `overview-widgets.ts` is fully cap-agnostic and iterates the registry. **Adding a new connector type to the per-instance system is one append to that file** — the rendering pipeline, title inheritance, source labels, batch placement, collision avoidance, isolation CSS, and tab plumbing are all picked up automatically.
- **Merged fan-out** (single-connector case): when exactly one connector of a type is shared with Overview, the existing merged card behavior is preserved.
- **Watched-teammate union**: Jira and ClickUp tabs in Overview union the watched-user lists from every contributing connector (de-duped by id).
- **Empty state**: when zero connectors are shared with Overview, the dashboard renders a dedicated card (`✦ Overview is empty`) explaining how to flip on Show in Overview from any workspace.
- **Context banner**: reads `OVERVIEW — A unified view of every connector you've explicitly shared with Overview.`
- **Mentions & DMs**: still promoted to full-width when in Overview (highest-signal row).

---

## Quick Rail (sidebar)

Toggled with `]`. Persists open/closed across page loads.

- **Next up**: next 3 events from Google Calendar (respects source color).
- **Recent mentions**: last 5 Slack mentions, linked to thread.

---

## KPI strip

Four at-a-glance tiles at the top. Click to jump to the corresponding section.

| Tile | Source |
|---|---|
| Meetings today | Google Calendar (accepted, non-focus) |
| Mentions | Slack (past 7 days) |
| Open tickets | Jira |
| PRs to review | GitHub |

---

## Dashboard cards

| Card | Source | What it shows |
|---|---|---|
| Schedule | Google / Outlook Calendar | Today's events, prev/next-day nav, "Now" line |
| Mentions & DMs | Slack | Mentions and DMs grouped by day |
| Pull Requests | GitHub | Needs Review · My PRs · All Open · Closed |
| Tickets | Jira | Mine + per-workspace watched teammates (configurable in Settings); rows show issue key, assignee avatar, project pill, status chip tinted with Jira's `statusCategory` color, priority badge, and due date |
| Tasks | ClickUp | Mine + per-workspace watched teammates (configurable in Settings); rows show task id (custom_id when set), assignee avatars, list, status chip colored by ClickUp's own status color, priority badge, and due date |

Both cards render through a single `renderTaskRow` helper ([src/frontend/components/task-row.ts](src/frontend/components/task-row.ts)) so visual updates stay consistent between Jira and ClickUp.
| Channel Digest | Slack | Per-channel collapsed previews |

ClickUp tasks are fetched via the `/api/clickup/tasks` route, scoped to the active workspace's connector and the team ID configured on it. Both Jira and ClickUp paginate in chunks of 100 per API call with no artificial cap — all matching tasks are returned. Watched-teammate tabs respect the **Hide closed** toggle per entry; when enabled, tasks with ClickUp `status.type` of `done` or `closed` are excluded after fetch (since ClickUp's `include_closed` flag only suppresses archived tasks, not finished ones).

---

## Data persistence

All data is local — nothing leaves your Mac except API calls to the configured providers.

- **SQLite** at `~/.daily-command-center/db.sqlite`
- **Tables**: `tokens`, `todos`, `scratchpad`, `settings`, `cache`, `oauth_state`, `workspaces`, `identities`, `connector_instances`
- **Cache**: API responses cached per-key with a configurable TTL (default 60 s for most providers).
- **Auto-refresh**: every 5 minutes while the tab is visible.

---

## Not yet implemented

- Cross-workspace ticket/PR aggregation in overview mode.
- (none currently — ClickUp card now ships open tasks for the active workspace.)
- Token encryption at rest (`identities.access_token` is plaintext in SQLite).
- Per-workspace overview layout with reordered cards.
- Settings → Preferences editor (theme/refresh interval — currently localStorage only).
- Per-workspace branding override (project name is currently install-wide, not per-workspace).
