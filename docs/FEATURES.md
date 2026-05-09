# Features

> Complete reference for every feature, card, shortcut, and setting in Daily Command Center.

---

## Dashboard cards

<details>
<summary><strong>📅 Schedule</strong> — Google Calendar + Outlook unified timeline</summary>

- Events merged from Google Calendar and any connected Outlook accounts in a single scrollable timeline, sorted by start time.
- Multiple calendar accounts per workspace supported, each with its own source color stripe.
- Filter chips: **All · Mine (accepted) · Needs response · Hide focus.**
- Day navigation (← Today →) to browse past/future days.
- **NOW indicator** line shows current time position.
- Badges: NEW today · Respond · Tentative · Declined · Focus.
- Meet/Teams/Zoom link extracted and shown inline.
- Powered by: **Google Calendar** + **Microsoft Outlook (Graph API)**.

</details>

<details>
<summary><strong>💬 Channel Digest</strong> — Slack channels at a glance</summary>

- Latest 5 messages from a configurable list of Slack channels.
- Full Slack rich-text rendered (mentions, links, bold/italic/code, emoji).
- Powered by: **Slack**.

</details>

<details>
<summary><strong>🔔 Mentions & DMs</strong> — Everything addressed to you</summary>

- All messages where you were @-mentioned or DM'd in the past N days.
- Urgent flag on direct messages.
- Grouped by day.
- Powered by: **Slack**.

</details>

<details>
<summary><strong>🎫 Tickets</strong> — Jira board with teammate tabs</summary>

- Your assigned tickets from Jira.
- Status buckets: todo · in progress · in review · blocked · done.
- Priority badges: urgent · high · medium · low.
- **Dynamic watched-teammate tabs**: "Mine" is always shown; every other tab is configured per-connector in Settings → Workspaces → Jira → Watched teammates. Each entry takes a tab label, a Jira identifier (display name, email, or accountId), an optional status filter, and a **Hide closed** toggle.
- **Result limit**: fetches all matching tickets from Jira, paginated 100 per API call, ordered by last-updated descending.
- Rows show: issue key · assignee avatar · project pill · status chip (tinted with Jira's `statusCategory` color) · priority badge · due date.
- **1-Click Clone to Jira**: when cloning is enabled on the Jira connector (Settings → Workspaces → expand the Jira connector card → "1-Click Cloning to Jira"), hovering a row reveals a clone icon. Clicking immediately creates a copy in the connector's configured default Jira project, shows a pending toast, then a success toast with a clickable link to the new issue. No dialog required.
- Powered by: **Jira**.

</details>

<details>
<summary><strong>✅ Tasks</strong> — ClickUp board with teammate tabs</summary>

- Same model as Tickets: Mine tab always shown, plus per-workspace watched-teammate tabs.
- Rows show: task id (custom_id when set) · assignee avatars · list · status chip (ClickUp's own status color) · priority badge · due date.
- Watched-teammate tabs respect the **Hide closed** toggle per entry.
- Fetched via `/api/clickup/tasks`, scoped to the connector's Team ID.
- **1-Click Clone to Jira**: same hover-icon mechanic as the Tickets widget. Enable on the ClickUp connector itself (Settings → Workspaces → expand the ClickUp connector card → "1-Click Cloning to Jira"); clicking clones the ClickUp task into the configured default Jira project for that connector.
- Powered by: **ClickUp**.

</details>

<details>
<summary><strong>🔀 Pull Requests</strong> — GitHub command center</summary>

- Four tabs with live count badges:
  - **Needs Review** — PRs where you're a requested reviewer
  - **My PRs** — open PRs you authored
  - **All Open** — every open PR in the repo
  - **Closed** — recently closed and merged PRs
- Per-PR: status, age, "waiting on you" flag.
- Powered by: **GitHub**.

</details>

---

## KPI strip

Four at-a-glance tiles at the top. Click to jump to the corresponding section.

| Tile | Source |
|---|---|
| Meetings today | Google Calendar (accepted, non-focus events) |
| Mentions | Slack (past 7 days) |
| Open tickets | Jira |
| PRs to review | GitHub |

---

## Workspaces

<details>
<summary><strong>Core workspace model</strong></summary>

- **Create / edit / delete** workspaces from Settings (`,` → Workspaces). The `+ Add workspace` button is fixed at the top.
- Each workspace card is collapsible; all open by default so shared connectors are visible.
- Each workspace specifies which identity to use for GitHub, Jira, Notion, ClickUp, and Calendar.
- **Auto-select**: with exactly one workspace, the dashboard always opens scoped to it. **Overview** mode appears only when two or more workspaces exist.
- **Empty by default**: new workspaces start with zero connectors — no inheritance from existing workspaces.

</details>

<details>
<summary><strong>Overview mode (✦)</strong></summary>

- Visible when no specific workspace is selected (requires 2+ workspaces). The header switcher labels it `✦ Overview`.
- **Opt-in by connector**: Overview only sees connectors whose owner flipped **Show in Overview ✦** in Settings. Nothing leaks across workspaces by default.
- **Per-instance strict isolation**: when N connectors of the same type are usable, the dashboard renders N separate cards — one per connector instance — each loading only its own data via `?connectorId=` scoping.
- Each card's source label combines `Workspace · account` (e.g. `Vennre · @ewaily`) so two connectors with the same owner remain distinguishable.
- Per-instance card titles inherit any custom title set in the connector's owning workspace.
- **Full feature parity per instance**: each card carries the same tab UI as the static workspace card — GitHub gets `Needs Review · My PRs · All Open · Closed`, Jira/ClickUp render `Mine` plus connector's watched-user tabs.
- **Capability registry**: every per-instance card behavior is declared in one `CapabilitySpec` entry in `src/frontend/components/instance-card-registry.ts`. Adding a new connector is one append — rendering, placement, tabs, and source labels all auto-inherit.
- **Empty state**: when zero connectors are shared with Overview, a dedicated card explains how to flip on Show in Overview.
- **Context banner**: `OVERVIEW — A unified view of every connector you've explicitly shared with Overview.`

</details>

<details>
<summary><strong>Sharing semantics</strong></summary>

Every connector has two independent toggles:

1. **Share with other workspaces** — the connector appears in every other workspace's Settings as opt-in. Toggling off-then-on wipes `enabledWorkspaces` to `[]`; each workspace must opt in again. A confirmation dialog warns when turning sharing off while workspaces are actively enrolled.
2. **Show in Overview ✦** — the connector's data is pulled into the Overview view. Independent from cross-workspace sharing.

The seeded Slack row is owned by the default workspace, pre-shared, and pre-marked Show-in-Overview.

</details>

<details>
<summary><strong>Per-type connector group UI</strong></summary>

Inside each workspace's Settings section, every connector type renders as one collapsible block with three regions:

1. **Behavior banner** — reminds how data resolves: fan-out (Slack/Calendar merge data from every active account) vs first-wins (GitHub/Jira/Notion/ClickUp use the workspace's own account, falling back to a shared one).
2. **Shared from other workspaces** — each shared instance is its own card with a "Use this in \<workspace\>" toggle, an owner badge (read-only), a conflict hint, and an off-state CTA.
3. **\<Workspace\>'s accounts** — owned instances with credential editing, two stacked per-instance toggles (**Share** and **Show in Overview ✦**), and a Disconnect action.

Below both regions: a single **+ Connect your own / Add another \<Type\>** action.

</details>

<details>
<summary><strong>Connector field standards</strong></summary>

Every API-key connector input shows:
- A concrete **placeholder** (e.g. `ghp_xxxxxxxxxxxxxxxxxxxx`, `acme.atlassian.net`)
- A **helper-text** line explaining exactly what the value is and where to find it
- **URL-stripping paste handlers** — pasting `https://github.com/Ewaily/my-repo` fills in `Ewaily/my-repo`

Every credentials form ships with an inline **📖 Need help finding these? View setup guide** disclosure that expands into a full step-by-step walkthrough. The `ConnectorTypeDef` schema requires `setupGuideMarkdown` — TypeScript fails the build if a connector is added without one.

</details>

---

## Header & global controls

| Control | Shortcut | What it does |
|---|---|---|
| Workspace switcher | — | Scopes dashboard to a workspace or to **Overview** |
| Command palette | `⌘K` | Dynamic command hub — see below |
| Refresh all | `R` | Re-fetches every module |
| Toggle theme | `T` | Light ↔ Dark |
| Settings | `,` | Manage workspaces, identities, connectors, preferences, application credentials |
| Customize layout | `E` | Toggle dashboard edit mode (drag/resize widgets, drag-reorder tabs) |

<details>
<summary><strong>Command palette (`⌘K`)</strong></summary>

A fully dynamic command hub rebuilt fresh on every open. Four sections:

| Section | Contents |
|---|---|
| **System** | Refresh all · Toggle dark/light · Open Settings · Create new workspace · Show shortcuts |
| **Workspaces** | One entry per workspace; Overview entry when 2+ exist. Active workspace marked `✓`. |
| **Navigation** | Jump commands for each mounted widget — only shown if the widget is visible in the active workspace |
| **Content** | Today's calendar events · Open Jira tickets · Open PRs · Slack channels — scraped from the live DOM |

Fuzzy search covers all four sections simultaneously.

</details>

<details>
<summary><strong>Smart workspace logos</strong></summary>

Each workspace can store a company/project website. From that URL the dashboard auto-fetches an official logo (Clearbit Logo API → Google Favicons fallback) and falls back to a generated monogram badge from the workspace's initials over its accent color. The resolved URL is persisted (`workspaces.logo_url` + `workspaces.website`) and renders everywhere:

- **Workspace creation form**: live preview while typing.
- **Header switcher**: 26 px circular badge in the workspace pill and dropdown.
- **Settings sections**: each workspace's collapsible head leads with the badge + domain.
- **Overview mode**: each card-header shows an overlapped cluster of contributing workspace logos.

Fetching is purely client-side — no API key, no PII beyond the domain name.

</details>

---

## Customizable dashboard layout

<details>
<summary><strong>Edit mode details</strong></summary>

Press **Customize** in the header (or `E`) to enter edit mode:

- **Move**: drag a card by its header to a new grid cell.
- **Resize**: drag the right/bottom/left edges or the bottom-right corner handle.
- **Reorder tabs**: in edit mode, drag any tab pill horizontally to reorder. Applies to GitHub PRs, Jira/ClickUp teammate tabs, and Mentions filters. Outside edit mode tabs are plain buttons — clicking always switches buckets.
- **Collision-free drop**: dropping on top of another card pushes it to the next free slot via top-to-bottom, left-to-right packing — no widget ever sits hidden behind another.
- **Smart auto-placement**: when a connector is activated mid-session, its widget appears in the next free slot; existing cards stay put.
- **Per-workspace layout**: each workspace (and Overview) has its own independent layout.
- **Reset**: the toolbar's *Reset layout* button restores the default arrangement (current scope only).
- **Persistence**: layouts stored in `localStorage` under `dcc-dashboard-layout-v2` as `{ "<workspaceId>" | "__overview__": layout }`. No server round-trip.
- **Fluid widgets**: CSS container queries compact text, labels, and tab pills gracefully as cards shrink. Minimum width/height clamps prevent broken layouts.

</details>

---

## Quick Rail (sidebar)

Toggled with `]`. Persists open/closed across page loads.

- **Next up**: next 3 events from Google Calendar (respects source color).
- **Recent mentions**: last 5 Slack mentions, linked to thread.

---

## Settings

<details>
<summary><strong>Application tab</strong></summary>

Store OAuth app credentials (Client ID / Client Secret / Redirect URI) in the local DB. Values set here take precedence over any `.env` equivalents. Secrets are write-only and never returned to the browser.

</details>

<details>
<summary><strong>Identities tab</strong></summary>

Reusable credentials shared across workspaces.

- **API-key types** (GitHub PAT, Jira API token, Notion token, ClickUp personal token): add/edit/delete via Settings UI — no `.env` required.
- **OAuth types** (Google, Slack, Microsoft): connected per-workspace via the Workspaces tab connect buttons.

</details>

<details>
<summary><strong>Per-connector 1-Click Cloning (Workspaces tab)</strong></summary>

Each Jira and ClickUp connector instance owns its own cloning config — including the destination Jira's full credentials — so a clone can land in ANY Jira instance, even one in a different workspace. Open the connector's card in the Workspaces tab and configure:

- **Enable 1-Click Cloning to Jira** — per-connector toggle that shows/hides the clone icon on rows from this specific connector.
- **Target Base URL** — full base URL of the destination Jira (e.g. `https://target.atlassian.net`).
- **Target Email** — Atlassian account email whose API token authorizes the clone.
- **Target API Token** — created at id.atlassian.com → Security → API tokens. Stored in this workspace's database alongside the connector's other config; never sent in list-response envelopes.
- **Target Jira Project Key** — dropdown populated from the workspace's Jira connector(s) when one is connected (so you can pick from a list); falls back to a free-text input if not — useful when the destination Jira isn't a connected source-connector here.

Cloning rules (V1):
1. Title is copied exactly.
2. Description is prefixed with `> 🔄 Cloned from [Source]({originalLink})`.
3. Issue type is `Task`; status defaults to the destination project's backlog default.
4. Attachments are not copied.

The form refuses to save an "enabled" config without all four fields filled in. The backend `POST /api/jira/clone-ticket` route looks up the source connector by id, reads its stored target credentials, and calls Jira's REST API directly with those credentials — never falling back to the host workspace's primary Jira creds. Settings are stored on the connector instance as `config.cloningEnabled` / `config.cloneTargetUrl` / `config.cloneTargetEmail` / `config.cloneTargetToken` / `config.cloneTargetProject` inside the `connector_instances.config` JSON.

</details>

<details>
<summary><strong>Preferences tab — Branding</strong></summary>

Rename the project for this install:

- **Project name** — drives the browser tab title and the dashboard header `<h1>`. Default: "Daily Command Center".
- **Header subtitle** — optional secondary line beside the project name in the top bar. **Also doubles as the greeting name** in the cinematic context strip — set it to your first name and the greeting becomes "Good morning, *Name*." Hidden in the top bar when blank.

Stored as `brand.name` / `brand.subtitle` in the `settings` table. Applied on page load and immediately after Save.

</details>

<details>
<summary><strong>Preferences tab — Time zones</strong></summary>

- **Primary time zone** — drives the main clock, AM/PM badge, header date, schedule "Now" line, and mention/Slack timestamp formatting (frontend and server). Stored as `prefs.primaryTz` (IANA name).
- **Secondary clocks** — up to three smaller clocks. Each row is a single IANA timezone input; the 3-letter label is auto-derived from the city. Stored as `prefs.secondaryTzs`.

Both apply immediately on save. Invalid IANA names are silently rejected.

</details>

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘K` / `Ctrl K` | Open the command palette |
| `R` | Refresh every module |
| `T` | Toggle light/dark theme |
| `,` | Open Settings |
| `E` | Toggle layout edit mode |
| `]` | Toggle Quick Rail |
| `?` | Show keyboard shortcut sheet |
| `G` then `S` | Jump to Schedule |
| `G` then `C` | Jump to Channel Digest |
| `G` then `M` | Jump to Mentions |

---

## Data persistence

All data is local — nothing leaves your Mac except API calls to the configured providers.

- **SQLite** at `~/.daily-command-center/db.sqlite`
- **Tables**: `tokens`, `todos`, `scratchpad`, `settings`, `cache`, `oauth_state`, `workspaces`, `identities`, `connector_instances`
- **Cache**: API responses cached per-key with a configurable TTL (default 60 s for most providers).
- **Auto-refresh**: every 5 minutes while the tab is visible.

---

## Not yet implemented

- Token encryption at rest (`identities.access_token` is plaintext in SQLite).
- Per-workspace branding override (project name is currently install-wide).
- Per-workspace overview layout with reordered cards.
