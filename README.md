# Daily Command Center

A local-first, multi-workspace dashboard that pulls Google Calendar, Outlook, Slack, Jira, ClickUp, GitHub, and Notion into a single, customizable grid. Runs entirely on your laptop — no cloud, no telemetry, no account.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)
[![CI](https://img.shields.io/github/actions/workflow/status/Ewaily/DailyCommandCenter/ci.yml?branch=prod&label=CI)](https://github.com/Ewaily/DailyCommandCenter/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-43853d?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)](https://vitejs.dev)
[![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)](https://expressjs.com)
[![SQLite](https://img.shields.io/badge/SQLite-local-003b57?logo=sqlite&logoColor=white)](https://www.sqlite.org/)

---

## Why this exists

Most knowledge workers wake up to twelve open tabs: a calendar, a Slack window per workspace, two ticketing tools, GitHub, a docs app, and at least one notification panel. The information they actually need — *what's on today, who needs me, what's blocked, what's waiting on review* — is scattered across all of them.

Daily Command Center is the opposite of that. One tab. One grid. Six providers. Everything stays on your machine.

---

## Table of contents

- [What it does](#what-it-does)
- [Feature highlights](#feature-highlights)
- [Supported integrations](#supported-integrations)
- [Architecture at a glance](#architecture-at-a-glance)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [npm scripts](#npm-scripts)
- [Project layout](#project-layout)
- [Data, privacy, and security](#data-privacy-and-security)
- [Contributing](#contributing)
- [License](#license)

---

## What it does

Open one URL on `localhost`. The dashboard composes itself from whichever tools you've connected:

- **Schedule** — today's events from Google Calendar and any number of Outlook accounts, merged into one timeline with a live "Now" indicator, conflict detection, focus-time hiding, and inline meeting links.
- **Channel Digest** — the latest messages from a configurable list of Slack channels, with full Slack rich-text rendering (mentions, links, code, emoji).
- **Mentions & DMs** — every place you were @-mentioned or DM'd in the last *N* days, grouped by day.
- **Tickets (Jira)** — assigned to you, plus per-workspace **watched-teammate tabs** you configure in Settings.
- **Tasks (ClickUp)** — same model: your tasks plus arbitrary watched-teammate tabs.
- **Pull Requests (GitHub)** — Needs Review · My PRs · All Open · Closed.
- **KPI strip** — at-a-glance counts: meetings today · unread mentions · open tickets · PRs to review.

Cards you don't have credentials for are simply not rendered. The dashboard never shows a skeleton it can't fill.

---

## Feature highlights

- **Customizable grid** — drag, drop, resize, and re-tab any card. Layouts persist per workspace.
- **Multi-workspace model** — run "Personal" and "Work" side by side. Each workspace owns its own connectors, identities, and layout. Credentials never cross workspace boundaries.
- **Overview (cross-workspace) mode** — a top-level view that fans out to every workspace at once, so a single Slack KPI surfaces unreads from all of them.
- **Watched-teammate tabs** — for both Jira and ClickUp, add any number of dynamic tabs scoped to a teammate (by display name, email, or account ID), with optional status filter and hide-closed toggle. Nothing is hardcoded.
- **Command palette (`⌘K`)** — fuzzy-jump to any card, action, integration, setting, or workspace.
- **Quick Rail (`]`)** — a slide-in sidebar with the next three events and recent mentions, no matter where you are on the dashboard.
- **Inline integration setup guides** — every credentials form ships with a "Need help finding these?" disclosure that expands into a step-by-step walkthrough with copy-buttoned code blocks. Adding a new connector without a setup guide fails the TypeScript build.
- **Foolproof connector inputs** — every field has a real-world placeholder, helper text explaining where to find the value, and URL-stripping paste handlers (pasting `https://github.com/Ewaily/DailyCommandCenter` autofills `Ewaily/DailyCommandCenter`).
- **White-label branding** — change the project name, subtitle, and accent in Settings → Preferences. Smart workspace logos auto-derive from initials, with optional custom upload.
- **Time-zone aware** — calendars render in each event's source time zone, with a selectable display zone.
- **Smart caching** — every external API call is wrapped in a SQLite-backed TTL cache. Friendly to provider rate limits.
- **Keyboard-first** — every primary action has a shortcut. The mouse is optional.

A complete, exhaustive feature list lives in [FEATURES.md](./FEATURES.md).

---

## Supported integrations

| Provider | Auth | What it powers | Resolution model |
|---|---|---|---|
| **Google Calendar** | OAuth | Schedule, KPIs, Quick Rail | Fan-out (merge across all connected accounts) |
| **Microsoft Outlook** | OAuth | Schedule, KPIs, Quick Rail | Fan-out (merge across all connected accounts) |
| **Slack** | OAuth or User Token | Channel Digest, Mentions & DMs, KPIs | Fan-out (merge across all connected accounts) |
| **Jira** | API token | Tickets card, KPIs | First-wins (workspace's own → shared fallback) |
| **ClickUp** | Personal token | Tasks card | First-wins |
| **GitHub** | Personal access token | Pull Requests card, KPIs | First-wins |
| **Notion** | Internal integration token | Pinned databases | First-wins |

Every integration is **optional**. The dashboard renders gracefully with zero credentials.

---

## Architecture at a glance

```
                            ┌────────────────────────────┐
                            │  Browser (Vite, TS strict) │
                            │  - drag-and-drop grid      │
                            │  - command palette         │
                            │  - per-workspace layout    │
                            └──────────────┬─────────────┘
                                           │ /api/*  (workspace via ?workspace=)
                            ┌──────────────▼─────────────┐
                            │  Node + Express server     │
                            │  - request-context (ALS)   │
                            │  - OAuth flows             │
                            │  - integration adapters    │
                            │  - TTL cache               │
                            └──────────────┬─────────────┘
                                           │
                            ┌──────────────▼─────────────┐
                            │  SQLite  (better-sqlite3)  │
                            │  - workspaces · connectors │
                            │  - identities · tokens     │
                            │  - cache · settings        │
                            └────────────────────────────┘
```

- **Active workspace** travels through the request via AsyncLocalStorage, set from a `?workspace=` query parameter. Every integration adapter calls `effective()` to resolve the right identity.
- **Inputs are validated** at every API boundary with Zod schemas.
- **Outputs are sanitized** — any third-party HTML is run through `sanitize-html` before reaching the DOM.
- **No comments unless the *why* is non-obvious.** No defensive error handling for impossible cases. Strict TypeScript across the board.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | TypeScript (strict) · Vite 5 · vanilla DOM components · CSS variables for theming |
| Backend | Node ≥ 20 · Express 4 · TypeScript (strict) · `tsx` (dev) · `tsc` (prod) |
| Persistence | SQLite via `better-sqlite3`, single-file DB, inline migrations |
| Auth | OAuth (Google · Slack · Microsoft) + API-key identities (GitHub · Jira · ClickUp · Notion) |
| State | Server: SQLite + AsyncLocalStorage workspace context. Client: `localStorage` for layout & preferences. |
| Validation | Zod at every API boundary |
| Logging | Pino + pino-pretty |
| HTML safety | `sanitize-html` for third-party content |
| Testing | Vitest |
| CI | GitHub Actions — typecheck + tests + build on Node 20 and 22 |

No frontend framework. No state library. No CSS framework. Everything is small, explicit, and cheap to read.

---

## Getting started

### Prerequisites

- Node.js **≥ 20**
- macOS, Linux, or Windows (developed on macOS; cross-platform)
- Optional: a developer account on any provider you want to enable

### 1. Clone

```bash
git clone https://github.com/Ewaily/DailyCommandCenter.git
cd DailyCommandCenter
```

### 2. Install

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in **only** the integrations you want to use. The dashboard works with zero credentials — every connector is opt-in. See [SETUP.md](./SETUP.md) for per-provider walkthroughs (the same content the in-app setup guides display).

> **OAuth note.** All redirect URIs must point to the **Node** server on port `3000`, not the Vite dev server. The canonical URIs are:
> - `http://localhost:3000/api/auth/google/callback`
> - `http://localhost:3000/api/auth/slack/callback`
> - `http://localhost:3000/api/auth/microsoft/callback`

### 4. Run in development

```bash
npm run dev
```

Then open **http://localhost:3000**. The Node server proxies Vite's HMR for you, so you only need one tab.

### 5. Build for production

```bash
npm run build
npm start
```

---

## Configuration

| Variable | Required? | Purpose |
|---|---|---|
| `PORT` | no (defaults `3000`) | Node/Express port. Must match OAuth redirect URIs. |
| `VITE_PORT` | no (defaults `5173`) | Vite dev server, proxied by Node in dev. |
| `DB_PATH` | no | Override the SQLite file location. Default: `~/.daily-command-center/db.sqlite`. |
| `LOG_LEVEL` | no (defaults `info`) | Pino level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | for Google Calendar | OAuth client. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_REDIRECT_URI` | for Slack OAuth | Slack app credentials. |
| `SLACK_USER_TOKEN` / `SLACK_USER_ID` | as a Slack OAuth shortcut | Skip the OAuth flow by pasting a `xoxp-…` token directly. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_REDIRECT_URI` | for Outlook | Azure AD app registration. |
| `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` | for Jira | API token + Atlassian Cloud URL. |
| `GITHUB_TOKEN` / `GITHUB_USERNAME` | for GitHub | Personal access token. |
| `NOTION_TOKEN` / `NOTION_DATABASE_IDS` | for Notion | Internal integration token + comma-separated database IDs. |

API-key connectors (GitHub, Jira, ClickUp, Notion) can also be added, edited, and deleted entirely from the **Settings UI** — no `.env` editing required. The `.env` only seeds defaults on first launch.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `⌘K` / `Ctrl K` | Open the command palette |
| `R` | Refresh every module |
| `T` | Toggle light/dark theme |
| `,` | Open Settings |
| `E` | Toggle layout edit mode (drag, resize, re-tab) |
| `]` | Toggle the Quick Rail (next events + recent mentions) |
| `?` | Show the keyboard shortcut sheet |
| `G` then `S` | Jump to Schedule |
| `G` then `C` | Jump to Channel Digest |
| `G` then `M` | Jump to Mentions |

The full mapping (and the modules each shortcut targets) is in [FEATURES.md](./FEATURES.md).

---

## npm scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the Node server and Vite together with hot reload. |
| `npm run dev:server` | Server-only dev with `tsx watch`. |
| `npm run dev:vite` | Vite-only dev. |
| `npm run build` | Build the frontend bundle and compile the server to `dist/`. |
| `npm start` | Run the compiled production server. |
| `npm test` | Run the Vitest suite once. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:coverage` | Run Vitest with V8 coverage and enforce the global thresholds defined in [vitest.config.ts](./vitest.config.ts). Required to pass before any PR can merge. |
| `npm run typecheck` | Strict-mode typecheck across client and server. |
| `npm run reset-db` | Wipe the local SQLite DB and reseed from `.env`. |

---

## Project layout

```
src/
  server/
    index.ts                     Express entry point
    config.ts                    .env loader
    db.ts                        Migrations and seed
    auth/                        OAuth flows (google, slack, microsoft)
    routes/                      REST endpoints (calendar, slack, tickets, prs, …)
    integrations/                Provider adapters (gmail, jira, github, clickup, …)
    lib/                         request-context, cache, errors, slack-formatter
  frontend/
    main.ts                      Vite entry point
    api.ts                       Single fetch surface for the client
    styles.css                   Theme variables and layout
    components/                  Cards, palette, settings, registry, theme
scripts/
  reset-db.ts
tests/
  slack-formatter.test.ts
.github/
  workflows/ci.yml               Typecheck + test + build matrix
  ISSUE_TEMPLATE/                Bug, feature, security routing
  PULL_REQUEST_TEMPLATE.md
  CODEOWNERS
  dependabot.yml
```

---

## Data, privacy, and security

- **Local-only.** Every byte the app stores lives in a single SQLite file on your machine (default: `~/.daily-command-center/db.sqlite`). Delete the file to wipe state. No telemetry. No analytics. No phone-home.
- **No cloud component.** The server runs on `localhost`. There is no backend service, no managed database, no shared identity.
- **Workspace isolation is absolute.** No workspace ever sees another workspace's tokens or credentials. UI copy never implies otherwise.
- **`.env` is gitignored.** The repo's `.gitignore` blocks every variant of `.env*`, every form of `*.db` / `*.sqlite`, layout config, and OS junk. CI never sees secrets.
- **Vulnerability reports** go through GitHub's private security advisories — see [SECURITY.md](./SECURITY.md). Please do not open public issues for security findings.

This app is single-user, single-machine by design. If you expose port `3000` to a network without an authenticating reverse proxy, you are publishing your unread Slack messages to that network. Don't do that.

---

## Contributing

PRs welcome. The full contributor guide is in [CONTRIBUTING.md](./CONTRIBUTING.md). Quick version:

1. Open an issue (or claim one) before non-trivial work.
2. Branch off `prod`: `git checkout -b feat/short-description`.
3. Code, test, **update docs in the same PR** — `README.md`, `FEATURES.md`, and `SETUP.md` must reflect reality before merge. CI typechecks and tests on Node 20 and 22.
4. Open the PR against `prod`. The [PR template](./.github/PULL_REQUEST_TEMPLATE.md) walks you through what's required. We squash-merge.

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

### Adding a connector

This is a first-class contribution path. Read the **CONNECTOR STANDARD** and **INSTANCE-CARD REGISTRY** sections in [CLAUDE.md](./CLAUDE.md) before starting:

- Every input field needs `placeholder`, `helperText`, and `stripUrl: true` where users might paste a URL.
- Register dashboard cards via `CapabilitySpec` in `src/frontend/components/instance-card-registry.ts` — never add `if (cap === "...")` branches in `overview-widgets.ts`.
- Authoring a `setupGuideMarkdown` is required by the type system; the build will fail without it.

---

## License

[MIT](./LICENSE) © Muhammad Ewaily
