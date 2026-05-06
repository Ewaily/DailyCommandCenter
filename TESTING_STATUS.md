# Testing Status

Coverage baseline: **Statements 6.23% · Branches 67.41% · Functions 45.91% · Lines 6.23%**
(updated 2026-05-06 after adding cache.ts and workspace-config.ts tests)

Legend: `[x]` Tested · `[ ]` Pending · **H** High · **M** Medium · **L** Low

---

## `src/server/lib/`

| File | Status | Priority | Notes |
|---|---|---|---|
| `cache.ts` | [x] Tested | **H** | memo TTL, stale-while-revalidate, invalidate prefix |
| `workspace-config.ts` | [x] Tested | **H** | Full CRUD: workspaces, identities, connectors, sharing model, typed getters |
| `errors.ts` | [ ] Pending | **H** | HttpError / NotConnectedError shape & inheritance |
| `app-settings.ts` | [ ] Pending | **H** | getAppSetting, setAppSetting, getAppSettings, setAppSettings, getAppSettingJSON |
| `request-context.ts` | [ ] Pending | **H** | AsyncLocalStorage workspace propagation |
| `slack-formatter.ts` | [x] Tested | **H** | Mrkdwn → HTML rendering (full suite exists) |

---

## `src/server/integrations/`

| File | Status | Priority | Notes |
|---|---|---|---|
| `github.ts` | [ ] Pending | **H** | PR fetch, pagination, notConfigured guard |
| `jira.ts` | [ ] Pending | **H** | Ticket fetch, watched-user logic, notConfigured guard |
| `slack.ts` | [ ] Pending | **H** | Channel digest, mentions, resolve users |
| `gmail.ts` | [ ] Pending | **H** | Message list, notConfigured guard |
| `google-calendar.ts` | [ ] Pending | **H** | Event list, token refresh |
| `notion.ts` | [ ] Pending | **M** | Database page fetch, notConfigured guard |
| `outlook-calendar.ts` | [ ] Pending | **M** | Event list, MS Graph token handling |
| `clickup.ts` | [ ] Pending | **M** | Task fetch, spaceIds parsing |

---

## `src/server/auth/`

| File | Status | Priority | Notes |
|---|---|---|---|
| `google.ts` | [ ] Pending | **H** | OAuth flow, token refresh, callback parsing |
| `slack.ts` | [ ] Pending | **H** | OAuth flow, callback parsing |
| `microsoft.ts` | [ ] Pending | **H** | OAuth flow, token refresh, PKCE |

---

## `src/server/routes/`

| File | Status | Priority | Notes |
|---|---|---|---|
| `workspaces.ts` | [ ] Pending | **H** | Workspace/identity/connector CRUD endpoints |
| `auth.ts` | [ ] Pending | **H** | OAuth redirect + callback routes |
| `tickets.ts` | [ ] Pending | **H** | Jira/ClickUp ticket aggregation |
| `prs.ts` | [ ] Pending | **H** | GitHub PR endpoint |
| `slack.ts` | [ ] Pending | **H** | Mentions + digest endpoints |
| `calendar.ts` | [ ] Pending | **M** | Google/Outlook calendar endpoint |
| `todos.ts` | [ ] Pending | **M** | Todo CRUD |
| `deadlines.ts` | [ ] Pending | **M** | Deadline aggregation |
| `clickup.ts` | [ ] Pending | **M** | ClickUp proxy route |
| `app-settings.ts` | [ ] Pending | **M** | App settings read/write endpoints |
| `settings.ts` | [ ] Pending | **M** | Settings page endpoint |

---

## `src/server/`

| File | Status | Priority | Notes |
|---|---|---|---|
| `config.ts` | [ ] Pending | **M** | env var parsing, ~ expansion, defaults |
| `db.ts` | [ ] Pending | **H** | migrate(), seedFromEnv(), migrateTokensToIdentities() — use in-memory DB |

---

## `src/frontend/`

| File | Status | Priority | Notes |
|---|---|---|---|
| `state.ts` | [ ] Pending | **M** | Workspace selection, localStorage persistence |
| `api.ts` | [ ] Pending | **M** | Typed fetch wrappers |
| `connectors.ts` | [ ] Pending | **M** | Connector type definitions |
| `components/brand.ts` | [ ] Pending | **M** | applyBrand, brand string helpers |
| `components/util.ts` | [ ] Pending | **M** | DOM utilities, date formatting |
| `components/widget-titles.ts` | [ ] Pending | **M** | Title inheritance, dynamic naming |
| `components/instance-card-registry.ts` | [ ] Pending | **M** | Registry lookup, capability resolution |
| `components/overview-widgets.ts` | [ ] Pending | **L** | Widget rendering pipeline |
| `components/dashboard.ts` | [ ] Pending | **L** | Dashboard orchestration |
| `components/settings.ts` | [ ] Pending | **L** | Settings panel UI |
| `components/workspace-switcher.ts` | [ ] Pending | **L** | Switcher UI |
| `components/header.ts` | [ ] Pending | **L** | Header UI |
| `components/sidebar.ts` | [ ] Pending | **L** | Sidebar UI |
| `components/prs.ts` | [ ] Pending | **L** | PR card rendering |
| `components/tickets.ts` | [ ] Pending | **L** | Ticket card rendering |
| `components/schedule.ts` | [ ] Pending | **L** | Schedule card rendering |
| `components/todo.ts` | [ ] Pending | **L** | Todo card rendering |
| `components/today.ts` | [ ] Pending | **L** | Today summary rendering |
| `components/mentions.ts` | [ ] Pending | **L** | Mentions card rendering |
| `components/channel-digest.ts` | [ ] Pending | **L** | Digest card rendering |
| `components/task-row.ts` | [ ] Pending | **L** | Task row rendering |
| `components/kpi-strip.ts` | [ ] Pending | **L** | KPI strip rendering |
| `components/palette.ts` | [ ] Pending | **L** | Color palette UI |
| `components/tab-drag.ts` | [ ] Pending | **L** | Drag-to-reorder tabs |
| `components/theme.ts` | [ ] Pending | **L** | Theme toggle |
| `components/tz.ts` | [ ] Pending | **L** | Timezone helper |
| `components/icons.ts` | [ ] Pending | **L** | Icon library |
| `components/setup-guides.ts` | [ ] Pending | **L** | OAuth setup guides |
| `components/integration-setup-guide.ts` | [ ] Pending | **L** | Setup guide component |
| `components/workspace-logo.ts` | [ ] Pending | **L** | Workspace logo rendering |
| `components/lists.ts` | [ ] Pending | **L** | List components |
| `components/card-collapse.ts` | [ ] Pending | **L** | Card collapse component |
| `components/clickup.ts` | [ ] Pending | **L** | ClickUp card rendering |
| `styles.css` | [ ] Pending | **L** | No unit tests applicable |

---

## Coverage targets (ratchet — never go below)

| Metric | Current floor |
|---|---|
| Statements | 6.23% |
| Branches | 67.41% |
| Functions | 45.91% |
| Lines | 6.23% |

Update this table after each test run where coverage increases.
