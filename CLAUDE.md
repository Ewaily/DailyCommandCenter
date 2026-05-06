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

## MANDATORY PRE-PUSH CHECKLIST — no exceptions

Before any `git push` or PR, ALL of the following must pass locally:

1. **`npx tsc --noEmit`** — zero type errors.
2. **`npm run test:coverage`** — NOT `npm test`. This is the command CI runs and it enforces coverage thresholds. `npm test` alone is insufficient.
3. **New code = new tests.** Every new function, module, or non-trivial branch added in a PR must have a corresponding unit test. "It's frontend DOM code" is not an exemption — if the code cannot be reached by the existing Node test environment, either (a) write a test using jsdom/happy-dom, or (b) get explicit sign-off from the user before accepting a threshold adjustment. Silently lowering thresholds without explaining the reason and getting approval is not acceptable.
4. **Coverage thresholds must not decrease** unless the user explicitly approves. If new code genuinely cannot be unit-tested (pure browser APIs with no jsdom path), document why in the commit message and ask the user before touching `vitest.config.ts`.
5. **Sync with `prod` before every push.** Run `git fetch origin prod && git rebase origin/prod` before pushing any branch. Resolve all conflicts locally, re-run steps 1–4, then push. A PR with a merge conflict is not ready for review.

A push that causes CI to fail or has unresolved conflicts is a broken workflow. The checklist above exists so that never happens.

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

### WIDGET UI & RESPONSIVENESS STANDARD

Every dashboard card MUST be built to withstand extreme resizing in the grid:

1. **Bulletproof Shell:** The card wrapper must be `flex flex-col h-full` — in practice this means the `.card` element (already `display:flex; flex-direction:column; overflow:hidden`) is the correct outer shell; never add a nested wrapper that breaks this.
2. **Shrink-proof Header:** `.card-header` must have `flex-shrink: 0` so the gradient header never collapses when the card is short.
3. **Scrollable Body:** The main content area (`.card-body`) must carry `flex: 1; overflow-y: auto; min-height: 0` — the `min-height: 0` is **mandatory**; without it a flex child cannot shrink below its intrinsic content height and the scrollbar never appears.
4. **Shrink-proof Chips:** Any filter chip row (`.chips`) between the header and body must have `flex-shrink: 0` so it is never squashed out of view.
5. **Sticky Actions:** Headers, Footers, and Form Action buttons (like Save/Cancel) MUST use `flex-shrink: 0` so they are never pushed out of the visible bounds when the card is shrunk. For settings panels that open inside a card, wrap the scrollable form fields in a `.dc-scroll-area` (or equivalent `flex: 1; overflow-y: auto; min-height: 0` child) and keep the action row outside that wrapper so it is always visible.
6. **Config panel isolation:** When a settings/config panel is open it should own the full space below the header — hide the regular card body with `#panel-el:not(:empty) ~ .card-body { display: none }` and give the panel itself `flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column`.
7. **Sensible minimums:** `.dashboard-item` must carry `min-width: 160px; min-height: 100px` so widgets cannot be resized to a completely broken state.
8. **Container Queries:** Use CSS `@container card (max-width: …)` queries to hide non-essential metadata (avatars, dates, secondary badges, source labels) when the widget is horizontally constrained. The container context is already set on `.dashboard-item` — do not re-declare it.

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
