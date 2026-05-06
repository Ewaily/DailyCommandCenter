# Claude Code — Project Instructions

## Mandatory doc maintenance — AUTOMATIC, NO PROMPTING NEEDED

> **READ THIS FIRST.** Whenever a code change in this repo would make `SETUP.md` or `FEATURES.md` even slightly inaccurate, you **must** update those files in the same response — without being asked, without confirmation, without waiting for a follow-up. Treat the doc update as part of the task itself, not as a separate optional step. A task is **not complete** until the docs match reality.
>
> The user should never have to remind you to "also update the docs" or "make sure FEATURES.md is current". If they have to say it, you've already failed the rule.

### SETUP.md
Update whenever:
- A new environment variable is added, renamed, or removed.
- A new provider/integration changes how it authenticates (OAuth vs API key).
- A prerequisite changes (Node version, system dependency, etc.).
- The startup command or DB path changes.
- A "how to connect" step changes.

### FEATURES.md
Update whenever:
- A new feature, module, KPI, card, or sidebar section is added — add it to the relevant section.
- A feature, control, button, toggle, or setting is removed or renamed (e.g. "Toggle density" being deleted means the row in the shortcut table goes away in the same commit).
- A keyboard shortcut is added, changed, or removed.
- An integration is added or dropped from a module.
- Header / Settings / Preferences gain or lose a control, tab, or pref-card.
- Something moves from "Not yet implemented" to done — remove it from that list.
- Something is deferred that was previously working — add it to "Not yet implemented".

### Self-check before ending the turn
Before you say "done", scan: did this change touch any user-facing control, env var, route, shortcut, integration, setting, or section? If yes, open SETUP.md and FEATURES.md and confirm both still describe the project accurately. If not, fix them now — in the same response.

---

## Project overview

A personal productivity dashboard running locally on Mac. Node + TypeScript backend, Vite + TypeScript frontend, SQLite for all persistence. No cloud, no external hosting. The project name shown in the header / browser tab is configurable via Settings → Preferences (`brand.name` / `brand.subtitle` in the `settings` table). Do not hardcode "Daily Command Center" or any owner name in new user-facing strings — route them through `applyBrand` (frontend) or `getAppSetting("brand.name", …)` (server).

- Server entry: `src/server/index.ts`
- Frontend entry: `src/frontend/main.ts`
- Styles: `src/frontend/styles.css`
- DB: `src/server/db.ts` — all migrations inline in `migrate()`, seed from `.env` in `seedFromEnv()`
- Config: `src/server/config.ts` — reads `.env` via dotenv

## Key architecture decisions

- **Multi-workspace model**: workspaces → connector_instances → identities in SQLite. `effective()` in each integration reads DB first, falls back to `.env` config.
- **Request context**: active workspace propagated via AsyncLocalStorage (`src/server/lib/request-context.ts`), set from `?workspace=` query param.
- **Auth**: Google + Slack use OAuth flows (`src/server/auth/`), tokens stored in `tokens` table. GitHub/Jira/Linear/Notion use API keys stored in `identities` table, manageable via Settings UI.
- **Cache**: `src/server/lib/cache.ts` — SQLite-backed, TTL per key. Wrap expensive API calls with `cached()`.
- **Frontend state**: workspace selection in `localStorage` key `dcc-active-workspace`. Settings/preferences in `localStorage` key `dcc-settings`.

## INSTANCE-CARD REGISTRY — single source of truth for per-instance widgets

When adding a new connector type that should appear as a dashboard card (PRs, tickets, schedule, etc.), you **must** register it via one `CapabilitySpec` entry in `src/frontend/components/instance-card-registry.ts`. Do **not** introduce a new `if (cap === "...")` branch in `overview-widgets.ts` — the renderer is cap-agnostic by design and adding scattered branches breaks the guarantee that future connectors auto-inherit batch placement, tab state isolation, source labels, title inheritance, count syncing, and CSS isolation. One spec covers: matching `connector.type` values, the static widget id it replaces, default grid dims, icon, default title, optional tabs (fixed list or dynamic from API response), data fetcher, row renderer, and empty-state copy. Once an entry is added, multi-instance rendering, the `Workspace · account` source label, owner-workspace title inheritance, per-card tab state, count badges, and the workspace-mode "owned + shared" parallel rendering all work automatically.

### COMPONENT PARITY (WORKSPACE VS OVERVIEW)

A widget **MUST** look and function exactly the same in Overview mode as it does in Workspace mode.

- **Never** build a "lite" or separate rendering shell for the Overview.
- **Never** strip out filters, pagination, or header controls in multi-instance views.
- Reuse the primary widget component by calling its `instantiate*(container, connectorId, opts)` factory. The factory renders the full card HTML (header controls, filter chips, tabs, day navigation, body) into the supplied container and scopes all data fetches to the given `connectorId`.
- The `MOUNTERS` map in `src/frontend/components/overview-widgets.ts` is the coupling point: every capability registered in the registry **must** have a corresponding entry in `MOUNTERS` pointing to its `instantiate*` factory.
- Any new connector added to the registry must ship its own `instantiate*` factory in its widget module and be wired into `MOUNTERS` — failing to do so means Overview cards for that connector will silently render nothing.
- Any new connector added to the registry must guarantee 100% UI parity across all views.

## OAUTH REDIRECT URI RULE — never get this wrong

The Node server listens on **port 3000** (`src/server/config.ts` default, overridable via `PORT` env var). Vite dev server runs on **port 5173** (overridable via `VITE_PORT`). These are **not** the same.

**Every OAuth redirect URI in the entire codebase — in code, docs, setup guides, and any text shown to the user — MUST use port 3000**, because it is the Node server that handles `/api/auth/*/callback` routes, not Vite.

The canonical redirect URIs are:
- Google: `http://localhost:3000/api/auth/google/callback`
- Slack: `http://localhost:3000/api/auth/slack/callback`
- Microsoft: `http://localhost:3000/api/auth/microsoft/callback`

The in-app setup guides live in `src/frontend/components/setup-guides.ts`. If you add or edit a guide, double-check the redirect URI port is 3000, not 5173. The error a user will see if this is wrong is: **`redirect_uri did not match any configured URIs`** from the OAuth provider.

If the user runs the app on a custom port (via `PORT=XXXX` in `.env`), the redirect URIs must match that port — but 3000 is the safe default to document.

## CONNECTOR STANDARD — enforced on every connector task

Whenever creating or updating an integration connector, every user-facing input field **must** include:

- **`placeholder`**: a concrete real-world example value (e.g. `ghp_xxxxxxxxxxxxxxxxxxxx`, `acme.atlassian.net`), never a generic hint like "Enter token".
- **`helperText`**: one or two sentences explaining exactly what the value is, where to find it, and what format it must be in.
- **`stripUrl: true`** on any field where a user might accidentally paste a full URL instead of a slug or ID (repo, baseUrl, teamId, databaseIds, etc.) — the paste handler will auto-strip.

A connector field with no `helperText` is incomplete. Never leave a user guessing the expected format.

**Workspace isolation is absolute.** No workspace ever sees, references, or is told about another workspace's secrets, tokens, or credentials. The only thing that crosses workspace boundaries is the rendered data/UI component of a connector that its owner has explicitly shared — never any key, token, or credential value. UI copy must never suggest that credentials "came from another workspace" or are "shared across workspaces". Each workspace's credential form stands alone.

## Code conventions

- No comments unless the WHY is non-obvious. Never describe what the code does.
- No error handling for impossible cases. Trust internal guarantees.
- Server routes return `{ data: T }` on success, `{ error: string }` on failure.
- Integrations return `{ notConfigured: true }` (via HttpError or early return) when their connector lacks an identity — frontend renders a "not connected" state, never a crash.
- All frontend API calls go through `src/frontend/api.ts` — never raw `fetch` in components.
- TypeScript strict throughout — `npx tsc --noEmit` must be clean before any task is done.
