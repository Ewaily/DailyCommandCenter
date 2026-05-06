# Setup Guide

## Prerequisites

- **Node.js 20+** — check with `node --version`. Install via `brew install node@20` if missing.
- **Xcode command-line tools** — required to build `better-sqlite3`. Run `xcode-select --install` if `npm install` fails.

## First run

```bash
cd ~/Documents/DailyCommandCenter
npm install
npm run dev                # starts server + Vite on http://localhost:3000
```

No `.env` file is required to start. Everything is configured from the UI after the app is running.

---

## Branding

Settings (`,`) → **Preferences** tab → **Project name** / **Header subtitle**.

- **Project name** — replaces "Daily Command Center" in the browser tab title and the dashboard header. Leave blank to fall back to the default.
- **Header subtitle** — optional second line under the greeting (owner name, team, tenant). Leave blank to hide.

Both values are stored in the local SQLite settings table and applied on every page load.

## Time zones

Same Preferences tab → **Primary time zone** + **Secondary clocks** (up to 3).

- Primary zone drives the main clock, date, day-progress ring, schedule timestamps, and mentions formatting (both client and server side).
- Secondary clocks each take an IANA timezone and an optional short label (auto-derived from the city if blank).
- Defaults: primary `Africa/Cairo`, secondaries London/Riyadh/Winnipeg.

---

## Connecting providers

All OAuth credentials and API tokens are configured from the **Settings panel** (`,` key) — no `.env` editing needed.

> **In-app setup guides.** Every credentials form (Google, Outlook, Slack, GitHub, Jira, Notion, ClickUp) ships with a built-in **📖 View setup guide** accordion that walks through provider-side configuration step by step — including exact redirect URIs, scopes, and where to copy each value from. The summary below is a quick reference; the in-app guide is the foolproof source of truth.

> ⚠️ **Critical — OAuth redirect URI port**
>
> The app runs on **two ports at the same time**:
> - **Port 3000** — Node/Express server. Handles all `/api/` routes including OAuth callbacks. **This is the port that matters for OAuth.**
> - **Port 5173** — Vite dev server. Serves the frontend assets only. **Never use this port in a redirect URI.**
>
> When a provider (Slack, Google, Microsoft) asks for a Redirect URI / Callback URL, always enter the **port 3000** version:
>
> | Provider | Redirect URI to register |
> |---|---|
> | Google | `http://localhost:3000/api/auth/google/callback` |
> | Slack | `http://localhost:3000/api/auth/slack/callback` |
> | Microsoft / Outlook | `http://localhost:3000/api/auth/microsoft/callback` |
>
> Using port 5173 here is the #1 cause of `redirect_uri did not match` errors. If you changed the server port via `PORT=XXXX` in `.env`, substitute that port number everywhere above.

### Google Calendar

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → New project → APIs & Services → Library → enable **Google Calendar API**.
2. APIs & Services → Credentials → Create OAuth client ID (Web application).
   - Redirect URI: `http://localhost:3000/api/auth/google/callback`
3. Open the app → Settings (`,`) → **Application** tab → Google section → paste Client ID and Client Secret → Save.
4. Settings → **Workspaces** → your workspace card → **+ Connect Google Calendar ↗** to complete the OAuth flow.

### Outlook Calendar (Microsoft Graph)

1. Go to [portal.azure.com](https://portal.azure.com/) → **Azure Active Directory** → **App registrations** → New registration.
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
   - Redirect URI (Web): `http://localhost:3000/api/auth/microsoft/callback`
2. Copy the **Application (client) ID** → **Client Secret** (Certificates & secrets → New client secret).
3. **API permissions** → Microsoft Graph → Delegated → add: `Calendars.Read`, `User.Read`, `offline_access` → Grant admin consent.
4. Settings → **Application** tab → Microsoft section → paste credentials → Save.
5. Settings → **Workspaces** → workspace card → **+ Connect Outlook Calendar ↗**. Repeat for multiple accounts.

### Slack

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch.
2. OAuth & Permissions → Redirect URLs → add `http://localhost:3000/api/auth/slack/callback`.
3. Add User Token Scopes: `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `search:read`, `users:read`, `users.profile:read`.
4. Settings → **Application** tab → Slack section → paste Client ID and Client Secret → Save.
5. Settings → **Workspaces** → workspace card → **+ Connect Slack ↗**.

### GitHub, Jira, Notion

Settings (`,`) → **Identities** → + Connect Identity — paste token directly. No OAuth registration needed.

### ClickUp

ClickUp uses a personal API token — no app registration, no OAuth dance. Five-minute setup:

1. **Generate the token.** Open ClickUp → click your **avatar** (bottom-left) → **Settings** → **Apps** (left sidebar) → **API Token** section → click **Generate** (or **Regenerate** if you've issued one before). Copy the value — it starts with `pk_`. This is the only secret you need.
2. **Find your Team ID** (ClickUp calls a top-level workspace a "Team"). Open ClickUp in the browser and look at the URL: `https://app.clickup.com/<TEAM_ID>/v/...` — the digits right after `app.clickup.com/` are your Team ID. Alternative: hit `https://api.clickup.com/api/v2/team` with the token in the `Authorization` header (curl below) to list every team you can access.
   ```bash
   curl -H "Authorization: pk_xxx_your_token" https://api.clickup.com/api/v2/team
   ```
3. **(Optional) Find Space IDs.** Only needed if you want to scope tasks to specific Spaces inside the team. Open a Space in the browser; the URL contains `/s/<SPACE_ID>`. Or list them with:
   ```bash
   curl -H "Authorization: pk_xxx_your_token" https://api.clickup.com/api/v2/team/<TEAM_ID>/space
   ```
4. **Connect in the UI.** Settings (`,`) → **Workspaces** → workspace card → ClickUp section → paste:
   - **Personal API token** — the `pk_…` value from step 1
   - **Team / Workspace ID** — the digits from step 2
   - **Space IDs** — comma-separated, optional (leave blank to use the whole team)
5. Save. The connector goes green when the token + team ID are accepted.

---

## Connecting after first run

| Provider | How to connect |
|---|---|
| Google Calendar | Settings → Application → save creds → Workspaces → Connect Google Calendar ↗ |
| Outlook Calendar | Settings → Application → save creds → Workspaces → Connect Outlook Calendar ↗ |
| Slack | Settings → Application → save creds → Workspaces → Connect Slack ↗ |
| GitHub | Settings → Identities → + Connect Identity → type: github |
| Jira | Settings → Identities → + Connect Identity → type: jira |
| Notion | Settings → Identities → + Connect Identity → type: notion |
| ClickUp | Settings → Workspaces → workspace card → ClickUp → paste token + Team ID |

---

## Optional `.env` overrides

A `.env` file is **not required**. If you want to pre-seed credentials via environment variables (CI, scripted setup), copy `.env.example` and fill in values — they act as fallbacks when no DB-stored value exists.

```env
# Server (rarely changed)
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
DB_PATH=~/.daily-command-center/db.sqlite
VITE_PORT=5173

# OAuth app credentials (prefer UI — these are fallbacks only)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=http://localhost:3000/api/auth/slack/callback
SLACK_USER_TOKEN=        # optional: skip OAuth dance entirely

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=http://localhost:3000/api/auth/microsoft/callback

# API tokens (prefer UI — these are fallbacks only)
GITHUB_TOKEN=
GITHUB_USERNAME=
GITHUB_REPO=owner/repo

JIRA_BASE_URL=
JIRA_EMAIL=
JIRA_API_TOKEN=

NOTION_TOKEN=
NOTION_DATABASE_IDS=

CLICKUP_TOKEN=
CLICKUP_TEAM_ID=
CLICKUP_SPACE_IDS=    # optional, comma-separated
```

---

## Common problems

| Problem | Fix |
|---|---|
| `npm install` fails on `better-sqlite3` | `xcode-select --install` then retry |
| `redirect_uri did not match` (any provider) | You registered the wrong port. The OAuth callback runs on **port 3000**, not 5173. Fix: go to the provider's developer console and change the redirect URI to `http://localhost:3000/api/auth/{provider}/callback`. See the redirect URI table above. |
| Google OAuth `redirect_uri_mismatch` | Same root cause as above — the URI in Google Cloud Console must be `http://localhost:3000/api/auth/google/callback` exactly, including the port. |
| Slack `redirect_uri did not match any configured URIs` | Go to api.slack.com/apps → your app → OAuth & Permissions → Redirect URLs and set `http://localhost:3000/api/auth/slack/callback`. Remove any `localhost:5174` entries. |
| Slack returns `not_authed` | Re-install the Slack app to your workspace at api.slack.com |
| Port 3000 in use | `lsof -i :3000`, kill the process, or change `PORT` in `.env` (then update all redirect URIs to match the new port) |
| Module shows "Loading…" forever | Open DevTools → Network tab — the `/api/...` call shows the real error |
